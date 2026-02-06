/**
 * Agent API Route
 * 
 * Orchestrates the conversation flow:
 * 1. Receives user message
 * 2. Calls Gemini with tool definitions
 * 3. Handles tool calls
 * 4. Returns response with rendered components
 */

import { NextRequest, NextResponse } from "next/server";
import { basename, resolve, isAbsolute, relative, sep } from "path";
import { realpathSync } from "fs";
import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type FunctionCall,
  type Part,
} from "@google/generative-ai";
import {
  workspaceList,
  workspaceRead,
  requestApproval,
  gitStatus,
  gitDiff,
} from "@/lib/mcp-tools";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function detectWorkspaceRoot(): string {
  const override = process.env.WORKSPACE_ROOT;
  if (override && override.trim()) {
    return resolve(override);
  }

  const cwd = process.cwd();
  if (process.env.NODE_ENV !== "production" && basename(cwd) === "web") {
    return resolve(cwd, "..");
  }

  return cwd;
}

// Default workspace path - the vibe-control project itself
const DEFAULT_WORKSPACE = detectWorkspaceRoot();
const WORKSPACE_ROOT_REAL = realpathSync(resolve(DEFAULT_WORKSPACE));
if (process.env.DEBUG_AGENT === "1") {
  console.log("[agent] Workspace root:", DEFAULT_WORKSPACE);
}

// Tool definitions for Gemini
const tools: FunctionDeclaration[] = [
  {
    name: "list_workspace_files",
    description: "List files and directories in the workspace. Use this when user asks to see project structure, files, or folder contents.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: { 
          type: SchemaType.STRING,
          description: "Workspace-relative directory path to list (e.g. `web/app`). Default is the workspace root."
        },
        depth: { type: SchemaType.NUMBER, description: "Depth to traverse (default: 2)" },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file. Use this when user asks to see code, config, or any file content.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: { type: SchemaType.STRING, description: "Workspace-relative file path to read (e.g. `web/app/page.tsx`)" },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_command",
    description: "Execute a terminal command (npm test, npm run build, etc). This requires user approval first.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        command: { type: SchemaType.STRING, description: "Command to execute" },
        reason: { type: SchemaType.STRING, description: "Why this command is needed" },
        cwd: { type: SchemaType.STRING, description: "Workspace-relative working directory (optional)" },
      },
      required: ["command", "reason"],
    },
  },
  {
    name: "get_git_status",
    description: "Get git status of the repository",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        cwd: { type: SchemaType.STRING, description: "Workspace-relative path (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_git_diff",
    description: "Get git diff of uncommitted changes",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        cwd: { type: SchemaType.STRING, description: "Workspace-relative path (optional)" },
      },
      required: [],
    },
  },
];

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

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface UIComponent {
  type: string;
  props: Record<string, any>;
}

const MAX_TOOL_STEPS = 6;
const MODEL_TEXT_SEPARATOR = "\n\n";
const MAX_FILE_CHARS_FOR_MODEL = 20_000;
const MAX_RESPONSE_CHARS = 30_000;

function toFunctionResponsePayload(value: unknown): object {
  return { result: value };
}

function readResponseText(response: { text: () => string }): string {
  try {
    return response.text();
  } catch (err) {
    console.error("Gemini response.text() failed", err);
    throw new Error("Failed to read model response text");
  }
}

function readFunctionCalls(response: { functionCalls: () => FunctionCall[] | undefined }): FunctionCall[] {
  try {
    return response.functionCalls() ?? [];
  } catch (err) {
    console.error("Gemini functionCalls() failed", err);
    throw new Error("Failed to read model function calls");
  }
}

// Authoritative guard for ensuring an absolute path stays under the workspace root.
function isOutsideWorkspace(absolutePath: string): boolean {
  const rel = relative(WORKSPACE_ROOT_REAL, absolutePath);
  if (!rel) return false;
  return isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep);
}

function toWorkspaceRelativePath(absolutePath: string): string {
  const rel = relative(WORKSPACE_ROOT_REAL, absolutePath);
  // Use "." for the root so consumers can safely join paths as `./file`.
  return rel || ".";
}

function resolveWorkspacePath(maybePath: unknown): string {
  if (typeof maybePath !== "string" || !maybePath.trim()) return WORKSPACE_ROOT_REAL;

  const inputPath = maybePath.trim();
  if (isAbsolute(inputPath)) {
    throw new Error(
      "Absolute paths are not allowed. Use a path relative to the workspace root instead."
    );
  }

  const candidate = resolve(WORKSPACE_ROOT_REAL, inputPath);

  // Policy: tools must use workspace-relative paths.
  // This keeps tool traces portable and avoids accessing the workspace via host-specific absolute paths.
  // The post-`realpathSync` check below is the authoritative guard for symlink escapes.
  if (isOutsideWorkspace(candidate)) {
    throw new Error(
      `Path "${inputPath}" is outside the workspace root. Use a path under the project directory instead.`
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path "${inputPath}" does not exist inside the workspace.`);
    }
    throw err;
  }

  if (isOutsideWorkspace(resolvedPath)) {
    throw new Error(
      `Path "${inputPath}" resolves outside the workspace root (possible symlink escape). Use a path under the project directory instead.`
    );
  }

  return resolvedPath;
}

async function handleToolCall(toolCall: ToolCall): Promise<{ modelResponse: object; component?: UIComponent }> {
  const { name, args } = toolCall;

  try {
    switch (name) {
      case "list_workspace_files": {
        const absolutePath = resolveWorkspacePath(args.path);
        const modelPath = toWorkspaceRelativePath(absolutePath);
        const tree = await workspaceList(absolutePath, args.depth || 2);
        return {
          modelResponse: { path: modelPath, tree },
          component: {
            type: "workspace_tree",
            props: { tree, rootPath: modelPath },
          },
        };
      }

      case "read_file": {
        const absolutePath = resolveWorkspacePath(args.path);
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
          modelResponse: {
            path: modelPath,
            content: modelContent,
            truncated: wasTruncated,
            totalChars: content.length,
            omittedChars,
          },
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
          modelResponse: {
            ...result,
            action: "terminal_run",
            reason: args.reason,
            command: args.command,
          },
          component: {
            type: "approval_card",
            props: {
              action: "terminal_run",
              reason: args.reason,
              command: args.command,
              request_id: result.request_id,
            },
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

export async function POST(request: NextRequest) {
  try {
    const { message, history } = await request.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured. Add it to .env.local" },
        { status: 500 }
      );
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      systemInstruction: SYSTEM_PROMPT,
    });

    // Build conversation history
    const chatHistory = (history || []).map((msg: any) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({
      history: chatHistory,
      tools: [{ functionDeclarations: tools }],
    });

    // Send user message
    const components: UIComponent[] = [];
    const textParts: string[] = [];
    let textChars = 0;
    let fallbackText = "";

    let sawExecuteCommand = false;
    let notedModelTruncation = false;
    let result = await chat.sendMessage(message);

    let stopReason: "char_limit" | "step_limit" | null = null;
    let step = 0;
    while (step < MAX_TOOL_STEPS) {
      const response = result.response;
      const responseText = readResponseText(response);
      if (responseText) {
        textParts.push(responseText);
        textChars += responseText.length;
      }

      const calls = readFunctionCalls(response);
      if (calls.length === 0) break;

      if (textChars >= MAX_RESPONSE_CHARS) {
        stopReason = "char_limit";
        break;
      }

      const functionResponseParts: Part[] = [];

      for (const call of calls) {
        const toolCall: ToolCall = {
          name: call.name,
          args: call.args as Record<string, any>,
        };

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

        functionResponseParts.push({
          functionResponse: {
            name: toolCall.name,
            response: toFunctionResponsePayload(modelResponse),
          },
        });

        if (toolCall.name === "execute_command") sawExecuteCommand = true;
      }

      result = await chat.sendMessage(functionResponseParts);

      if (sawExecuteCommand) {
        const finalText = readResponseText(result.response);
        if (finalText) {
          textParts.push(finalText);
          textChars += finalText.length;
        }
        break;
      }

      step++;
    }

    if (step >= MAX_TOOL_STEPS && stopReason === null) {
      stopReason = "step_limit";
    }

    if (stopReason === "char_limit") {
      textParts.unshift(
        `Note: I stopped generating because the response reached the ${MAX_RESPONSE_CHARS} character limit.`
      );
    } else if (stopReason === "step_limit") {
      textParts.unshift(
        `Note: I reached the maximum of ${MAX_TOOL_STEPS} tool steps in this turn. Ask me to continue if something looks incomplete.`
      );
    }

    if (notedModelTruncation) {
      textParts.unshift(
        `Note: for large files, only the first ${MAX_FILE_CHARS_FOR_MODEL} characters are sent back to the model.`
      );
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
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
