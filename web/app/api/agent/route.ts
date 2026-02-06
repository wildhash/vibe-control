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
import { basename, resolve, isAbsolute } from "path";
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
  const cwd = process.cwd();
  return basename(cwd) === "web" ? resolve(cwd, "..") : cwd;
}

// Default workspace path - the vibe-control project itself
const DEFAULT_WORKSPACE = detectWorkspaceRoot();

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
          description: "Directory path to list. Default is the current workspace root."
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
        path: { type: SchemaType.STRING, description: "Full file path to read" },
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
        cwd: { type: SchemaType.STRING, description: "Working directory (optional)" },
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
        cwd: { type: SchemaType.STRING, description: "Repository path" },
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
        cwd: { type: SchemaType.STRING, description: "Repository path" },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are VibeControl, an AI-powered IDE assistant. You help users explore, understand, and modify their codebase.

IMPORTANT RULES:
1. When users ask about project structure, files, or folders - call list_workspace_files
2. When users ask to see/read a file - call read_file with the full path
3. When users ask to run commands (tests, builds, etc) - call execute_command (requires approval)
4. When users ask about git status or changes - call get_git_status or get_git_diff

The current workspace is: ${DEFAULT_WORKSPACE}

When listing files, if no path is specified, use the workspace root.
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

function toFunctionResponsePayload(value: unknown): object {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as object;
  return { result: value };
}

function safeResponseText(response: { text: () => string }): string {
  try {
    return response.text();
  } catch {
    return "";
  }
}

function safeFunctionCalls(response: { functionCalls: () => FunctionCall[] | undefined }): FunctionCall[] {
  try {
    return response.functionCalls() ?? [];
  } catch {
    return [];
  }
}

function resolveWorkspacePath(maybePath: unknown): string {
  if (typeof maybePath !== "string" || !maybePath.trim()) return DEFAULT_WORKSPACE;
  return isAbsolute(maybePath) ? maybePath : resolve(DEFAULT_WORKSPACE, maybePath);
}

async function handleToolCall(toolCall: ToolCall): Promise<{ modelResponse: object; component?: UIComponent }> {
  const { name, args } = toolCall;

  try {
    switch (name) {
      case "list_workspace_files": {
        const path = resolveWorkspacePath(args.path);
        const tree = await workspaceList(path, args.depth || 2);
        return {
          modelResponse: { path, tree },
          component: {
            type: "workspace_tree",
            props: { tree, rootPath: path },
          },
        };
      }

      case "read_file": {
        const path = resolveWorkspacePath(args.path);
        const content = await workspaceRead(path);
        const ext = path.split(".").pop() || "text";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          py: "python", json: "json", md: "markdown", css: "css", html: "html",
        };

        const wasTruncated = content.length > MAX_FILE_CHARS_FOR_MODEL;
        const modelContent = wasTruncated ? content.slice(0, MAX_FILE_CHARS_FOR_MODEL) : content;

        return {
          modelResponse: {
            path,
            content: modelContent,
            truncated: wasTruncated,
            totalChars: content.length,
          },
          component: {
            type: "code_panel",
            props: {
              code: content,
              language: langMap[ext] || "plaintext",
              filename: path.split(/[/\\]/).pop() || path,
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
        const cwd = resolveWorkspacePath(args.cwd);
        const result = await gitStatus(cwd);
        return { modelResponse: { cwd, status: result } };
      }

      case "get_git_diff": {
        const cwd = resolveWorkspacePath(args.cwd);
        const result = await gitDiff(cwd);
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
    let fallbackText = "";

    let sawExecuteCommand = false;
    let result = await chat.sendMessage(message);

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const response = result.response;
      const responseText = safeResponseText(response);
      if (responseText) textParts.push(responseText);

      const calls = safeFunctionCalls(response);
      if (calls.length === 0) break;

      const functionResponseParts: Part[] = [];

      for (const call of calls) {
        const toolCall: ToolCall = {
          name: call.name,
          args: call.args as Record<string, any>,
        };

        if (!fallbackText) {
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
              fallbackText = "Here's what I found:";
          }
        }

        const { modelResponse, component } = await handleToolCall(toolCall);
        if (component) components.push(component);

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
        const finalText = safeResponseText(result.response);
        if (finalText) textParts.push(finalText);
        break;
      }
    }

    const textContent = textParts.filter(Boolean).join(MODEL_TEXT_SEPARATOR).trim();

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
