/**
 * Agent API Route
 *
 * Orchestrates the conversation flow:
 * 1. Receives user message
 * 2. Calls the best available AI provider (OpenAI, Anthropic, Gemini, Grok)
 * 3. Handles tool calls (workspace browse, file read, command exec, git)
 * 4. Returns response with rendered components
 */

import { NextRequest, NextResponse } from "next/server";
import { basename, resolve, isAbsolute, normalize, relative } from "path";
import { realpathSync } from "fs";
import {
  createChatWithFallback,
  type ToolDef,
  type FunctionResult,
} from "@/lib/ai-providers";
import {
  workspaceList,
  workspaceRead,
  requestApproval,
  gitStatus,
  gitDiff,
} from "@/lib/mcp-tools";

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

function detectWorkspaceRoot(): string {
  const override = process.env.WORKSPACE_ROOT;
  if (override && override.trim()) return resolve(override);
  const cwd = process.cwd();
  if (process.env.NODE_ENV !== "production" && basename(cwd) === "web") {
    return resolve(cwd, "..");
  }
  return cwd;
}

const DEFAULT_WORKSPACE = detectWorkspaceRoot();
const WORKSPACE_ROOT_REAL = normalize(realpathSync(resolve(DEFAULT_WORKSPACE)));

if (process.env.DEBUG_AGENT === "1") {
  console.log("[agent] Workspace root:", DEFAULT_WORKSPACE);
}

function isOutsideWorkspace(absolutePath: string): boolean {
  const rel = relative(WORKSPACE_ROOT_REAL, normalize(absolutePath));
  if (!rel) return false;
  if (isAbsolute(rel)) return true;
  const normalized = rel.replace(/\\/g, "/");
  return normalized === ".." || normalized.startsWith("../");
}

function toWorkspaceRelativePath(absolutePath: string): string {
  return relative(WORKSPACE_ROOT_REAL, absolutePath) || ".";
}

function resolveWorkspacePath(
  maybePath: unknown,
  { allowDefaultRoot = true }: { allowDefaultRoot?: boolean } = {}
): string {
  if (typeof maybePath !== "string" || !maybePath.trim()) {
    if (!allowDefaultRoot) throw new Error("A non-empty workspace-relative path is required.");
    return WORKSPACE_ROOT_REAL;
  }
  const inputPath = maybePath.trim();
  if (inputPath === "." || inputPath === "./" || inputPath === ".\\") {
    if (!allowDefaultRoot) throw new Error("A non-empty workspace-relative path is required.");
    return WORKSPACE_ROOT_REAL;
  }
  const segments = inputPath.split(/[/\\]+/);
  if (segments.includes("..")) {
    throw new Error("Parent directory references (..) are not allowed in workspace-relative paths.");
  }
  if (isAbsolute(inputPath)) {
    throw new Error("Absolute paths are not allowed. Use a path relative to the workspace root instead.");
  }
  const candidate = resolve(WORKSPACE_ROOT_REAL, inputPath);
  if (isOutsideWorkspace(candidate)) {
    throw new Error(`Path "${inputPath}" is outside the workspace root.`);
  }
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new Error(`Path "${inputPath}" does not exist inside the workspace.`);
    throw err;
  }
  if (isOutsideWorkspace(resolvedPath)) {
    throw new Error(`Path "${inputPath}" resolves outside the workspace root (possible symlink escape).`);
  }
  return resolvedPath;
}

// ---------------------------------------------------------------------------
// Tool definitions (provider-agnostic)
// ---------------------------------------------------------------------------

const tools: ToolDef[] = [
  {
    name: "list_workspace_files",
    description:
      "List files and directories in the workspace. Use this when user asks to see project structure, files, or folder contents.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative directory path to list (e.g. `web/app`). Default is the workspace root.",
        },
        depth: { type: "number", description: "Depth to traverse (default: 2)" },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file. Use this when user asks to see code, config, or any file content.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path to read (e.g. `web/app/page.tsx`)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_command",
    description: "Execute a terminal command (npm test, npm run build, etc). This requires user approval first.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        reason: { type: "string", description: "Why this command is needed" },
        cwd: { type: "string", description: "Workspace-relative working directory (optional)" },
      },
      required: ["command", "reason"],
    },
  },
  {
    name: "get_git_status",
    description: "Get git status of the repository",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Workspace-relative path (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_git_diff",
    description: "Get git diff of uncommitted changes",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Workspace-relative path (optional)" },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are VibeControl, an AI-powered IDE assistant. You help users explore, understand, and modify their codebase.

IMPORTANT RULES:
1. When users ask about project structure, files, or folders - call list_workspace_files
2. When users ask to see/read a file - call read_file with a workspace-relative path
3. When users ask to run commands (tests, builds, etc) - call execute_command (requires approval)
4. When users ask about git status or changes - call get_git_status or get_git_diff

The current workspace root is the project directory (all tool paths are relative to it).

When listing files, if no path is specified, use the workspace root.
Never use absolute paths when calling tools.
Always be helpful and explain what you find.`;

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface UIComponent {
  type: string;
  props: Record<string, any>;
}

const MAX_TOOL_STEPS = 6;
const MAX_FILE_CHARS_FOR_MODEL = 20_000;
const MAX_RESPONSE_CHARS = 30_000;
const MODEL_TEXT_SEPARATOR = "\n\n";

async function handleToolCall(
  toolCall: ToolCall
): Promise<{ modelResponse: object; component?: UIComponent }> {
  const { name, args } = toolCall;
  try {
    switch (name) {
      case "list_workspace_files": {
        const absolutePath = resolveWorkspacePath(args.path);
        const modelPath = toWorkspaceRelativePath(absolutePath);
        const tree = await workspaceList(absolutePath, args.depth || 2);
        return {
          modelResponse: { path: modelPath, tree },
          component: { type: "workspace_tree", props: { tree, rootPath: modelPath } },
        };
      }
      case "read_file": {
        const absolutePath = resolveWorkspacePath(args.path, { allowDefaultRoot: false });
        const modelPath = toWorkspaceRelativePath(absolutePath);
        const content = await workspaceRead(absolutePath);
        const ext = modelPath.split(".").pop() || "text";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          py: "python", json: "json", md: "markdown", css: "css", html: "html",
        };
        const wasTruncated = content.length > MAX_FILE_CHARS_FOR_MODEL;
        const omittedChars = wasTruncated ? content.length - MAX_FILE_CHARS_FOR_MODEL : 0;
        const modelContent = wasTruncated ? content.slice(0, MAX_FILE_CHARS_FOR_MODEL) : content;
        return {
          modelResponse: { path: modelPath, content: modelContent, truncated: wasTruncated, totalChars: content.length, omittedChars },
          component: {
            type: "code_panel",
            props: {
              code: content,
              language: langMap[ext] || "plaintext",
              filename: modelPath.split(/[/\\]/).pop() || modelPath,
              truncated: wasTruncated,
              omittedChars,
            },
          },
        };
      }
      case "execute_command": {
        const result = await requestApproval("terminal_run", args.reason, args.command);
        return {
          modelResponse: { ...result, action: "terminal_run", reason: args.reason, command: args.command },
          component: {
            type: "approval_card",
            props: { action: "terminal_run", reason: args.reason, command: args.command, request_id: result.request_id },
          },
        };
      }
      case "get_git_status": {
        const absoluteCwd = resolveWorkspacePath(args.cwd);
        const cwd = toWorkspaceRelativePath(absoluteCwd);
        const result = await gitStatus(absoluteCwd);
        return { modelResponse: { cwd, status: result } };
      }
      case "get_git_diff": {
        const absoluteCwd = resolveWorkspacePath(args.cwd);
        const cwd = toWorkspaceRelativePath(absoluteCwd);
        const result = await gitDiff(absoluteCwd);
        return { modelResponse: { cwd, diff: result } };
      }
      default:
        return { modelResponse: { error: `Unknown tool: ${name}` } };
    }
  } catch (error: any) {
    return { modelResponse: { error: error.message } };
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { message, history } = await request.json();

    // Build conversation history for the provider
    const chatHistory = (history || []).map((msg: any) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    }));

    // Try all available providers with automatic fallback
    let chatSession;
    let currentTurn;
    try {
      const { chat, turn } = await createChatWithFallback(SYSTEM_PROMPT, tools, chatHistory, message);
      chatSession = chat;
      currentTurn = turn;
    } catch (err: any) {
      console.error("[agent] Provider init failed:", err.message);
      return NextResponse.json({ error: err.message }, { status: 503 });
    }

    // Process the tool-calling loop
    const components: UIComponent[] = [];
    const textParts: string[] = [];
    let textChars = 0;
    let fallbackText = "";
    let sawExecuteCommand = false;
    let notedModelTruncation = false;
    let stopReason: "char_limit" | "step_limit" | null = null;

    let step = 0;
    while (step < MAX_TOOL_STEPS) {
      // Collect text from this turn
      if (currentTurn.text) {
        textParts.push(currentTurn.text);
        textChars += currentTurn.text.length;
      }

      // No tool calls => done
      if (currentTurn.functionCalls.length === 0) break;

      // Hit char limit => stop
      if (textChars >= MAX_RESPONSE_CHARS) {
        stopReason = "char_limit";
        break;
      }

      // Execute each tool call
      const functionResults: FunctionResult[] = [];

      for (const call of currentTurn.functionCalls) {
        const toolCall: ToolCall = { name: call.name, args: call.args };

        // Set fallback text
        switch (toolCall.name) {
          case "list_workspace_files":
            fallbackText = "Here's the project structure:";
            break;
          case "read_file":
            fallbackText = "Here's the file:";
            break;
          case "execute_command":
            fallbackText = "This command requires your approval:";
            break;
          default:
            if (!fallbackText) fallbackText = "Here's what I found:";
        }

        const { modelResponse, component } = await handleToolCall(toolCall);
        if (component) components.push(component);

        if (
          toolCall.name === "read_file" &&
          typeof (modelResponse as any)?.truncated === "boolean" &&
          (modelResponse as any).truncated
        ) {
          notedModelTruncation = true;
        }

        functionResults.push({ name: toolCall.name, result: modelResponse });

        if (toolCall.name === "execute_command") sawExecuteCommand = true;
      }

      // Send tool results back to the model
      currentTurn = await chatSession.sendToolResults(functionResults);

      // If we ran an execute_command, collect final text and stop
      if (sawExecuteCommand) {
        if (currentTurn.text) {
          textParts.push(currentTurn.text);
          textChars += currentTurn.text.length;
        }
        break;
      }

      step++;
    }

    // Add limit notes
    if (step >= MAX_TOOL_STEPS && stopReason === null) stopReason = "step_limit";

    if (stopReason === "char_limit") {
      textParts.unshift(`Note: response reached the ${MAX_RESPONSE_CHARS} character limit.`);
    } else if (stopReason === "step_limit") {
      textParts.unshift(`Note: reached the maximum of ${MAX_TOOL_STEPS} tool steps. Ask me to continue if something looks incomplete.`);
    }

    if (notedModelTruncation) {
      textParts.unshift(`Note: large files are truncated to ${MAX_FILE_CHARS_FOR_MODEL} characters for the AI model.`);
    }

    const textContent = textParts
      .filter(Boolean)
      .join(MODEL_TEXT_SEPARATOR)
      .slice(0, MAX_RESPONSE_CHARS)
      .trim();

    return NextResponse.json({
      content: textContent || fallbackText || "I'm ready to help you explore your codebase!",
      components,
    });
  } catch (error: any) {
    console.error("Agent error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
