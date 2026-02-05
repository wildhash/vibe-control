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
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  workspaceList,
  workspaceRead,
  requestApproval,
  gitStatus,
  gitDiff,
} from "@/lib/mcp-tools";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Default workspace path - the vibe-control project itself
const DEFAULT_WORKSPACE = process.cwd();

// Tool definitions for Gemini
const tools = [
  {
    name: "list_workspace_files",
    description: "List files and directories in the workspace. Use this when user asks to see project structure, files, or folder contents.",
    parameters: {
      type: "object",
      properties: {
        path: { 
          type: "string", 
          description: `Directory path to list. Default is the current workspace: ${DEFAULT_WORKSPACE}` 
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
        path: { type: "string", description: "Full file path to read" },
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
        cwd: { type: "string", description: "Working directory (optional)" },
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
        cwd: { type: "string", description: "Repository path" },
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
        cwd: { type: "string", description: "Repository path" },
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

async function handleToolCall(toolCall: ToolCall): Promise<{ result: any; component?: UIComponent }> {
  const { name, args } = toolCall;

  try {
    switch (name) {
      case "list_workspace_files": {
        const path = args.path || DEFAULT_WORKSPACE;
        const tree = await workspaceList(path, args.depth || 2);
        return {
          result: tree,
          component: {
            type: "workspace_tree",
            props: { tree, rootPath: path },
          },
        };
      }

      case "read_file": {
        const content = await workspaceRead(args.path);
        const ext = args.path.split(".").pop() || "text";
        const langMap: Record<string, string> = {
          ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
          py: "python", json: "json", md: "markdown", css: "css", html: "html",
        };
        return {
          result: content,
          component: {
            type: "code_panel",
            props: {
              code: content,
              language: langMap[ext] || "plaintext",
              filename: args.path.split(/[/\\]/).pop() || args.path,
            },
          },
        };
      }

      case "execute_command": {
        const result = await requestApproval("terminal_run", args.reason, args.command);
        return {
          result,
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
        const cwd = args.cwd || DEFAULT_WORKSPACE;
        const result = await gitStatus(cwd);
        return { result };
      }

      case "get_git_diff": {
        const cwd = args.cwd || DEFAULT_WORKSPACE;
        const result = await gitDiff(cwd);
        return { result };
      }

      default:
        return { result: { error: `Unknown tool: ${name}` } };
    }
  } catch (error: any) {
    return { result: { error: error.message } };
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
    const result = await chat.sendMessage(message);
    const response = result.response;

    // Check for function calls
    const candidates = response.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    
    const components: UIComponent[] = [];
    let textContent = "";

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      
      if (part.functionCall) {
        const toolCall: ToolCall = {
          name: part.functionCall.name,
          args: part.functionCall.args as Record<string, any>,
        };
        
        const { result, component } = await handleToolCall(toolCall);
        
        if (component) {
          components.push(component);
        }
        
        // Add text about what was done if no text yet
        if (!textContent) {
          switch (toolCall.name) {
            case "list_workspace_files":
              textContent = "Here's the project structure:";
              break;
            case "read_file":
              textContent = `Here's the content of ${toolCall.args.path}:`;
              break;
            case "execute_command":
              textContent = "This command requires your approval:";
              break;
            default:
              textContent = "Here's what I found:";
          }
        }
      }
    }

    return NextResponse.json({
      content: textContent || "I'm ready to help you explore your codebase!",
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
