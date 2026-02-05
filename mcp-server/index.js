/**
 * VibeControl MCP Server
 * 
 * Local server for filesystem, terminal, and git operations.
 * Uses stdio transport - spawned by Next.js host.
 * 
 * Security: Dangerous operations require approval tokens.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync, spawn } from "child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import crypto from "crypto";

// ============================================
// APPROVAL TOKEN MANAGEMENT
// ============================================
const pendingApprovals = new Map(); // request_id -> { action, reason, command, timestamp }
const activeTokens = new Map();     // token -> { request_id, expires }

function generateRequestId() {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}

function generateToken() {
  return `tok_${crypto.randomBytes(16).toString("hex")}`;
}

function createApprovalRequest(action, reason, command) {
  const requestId = generateRequestId();
  pendingApprovals.set(requestId, {
    action,
    reason,
    command,
    timestamp: Date.now(),
  });
  // Auto-expire after 5 minutes
  setTimeout(() => pendingApprovals.delete(requestId), 5 * 60 * 1000);
  return requestId;
}

function grantApproval(requestId) {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    throw new Error("Invalid or expired approval request");
  }
  
  const token = generateToken();
  activeTokens.set(token, {
    requestId,
    command: pending.command,
    expires: Date.now() + 60 * 1000, // 1 minute validity
  });
  
  pendingApprovals.delete(requestId);
  return token;
}

function validateToken(token) {
  const tokenData = activeTokens.get(token);
  if (!tokenData) {
    throw new Error("⛔ PERMISSION DENIED: Invalid approval token");
  }
  if (Date.now() > tokenData.expires) {
    activeTokens.delete(token);
    throw new Error("⛔ PERMISSION DENIED: Approval token expired");
  }
  // One-time use
  activeTokens.delete(token);
  return tokenData;
}

// ============================================
// FILESYSTEM HELPERS
// ============================================
function buildDirectoryTree(dirPath, depth = 2, currentDepth = 0) {
  if (currentDepth >= depth) return [];
  
  const entries = [];
  try {
    const items = readdirSync(dirPath);
    for (const item of items) {
      // Skip common noise
      if (item.startsWith(".") || item === "node_modules") continue;
      
      const fullPath = join(dirPath, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        entries.push({
          name: item,
          type: "directory",
          children: buildDirectoryTree(fullPath, depth, currentDepth + 1),
        });
      } else {
        entries.push({
          name: item,
          type: "file",
          size: stat.size,
        });
      }
    }
  } catch (err) {
    // Permission denied or other error
  }
  return entries;
}

// ============================================
// MCP SERVER SETUP
// ============================================
const server = new Server(
  {
    name: "vibe-control-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================
// TOOL DEFINITIONS
// ============================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "workspace_list",
        description: "List files and directories in the workspace",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path to list" },
            depth: { type: "number", description: "How deep to traverse (default: 2)" },
          },
          required: ["path"],
        },
      },
      {
        name: "workspace_read",
        description: "Read the contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
      },
      {
        name: "approval_request",
        description: "Request approval for a dangerous operation. Returns a request_id that the UI must approve.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", description: "Type of action (run_command, apply_patch, etc)" },
            reason: { type: "string", description: "Why this action is needed" },
            command: { type: "string", description: "The actual command or patch to execute" },
          },
          required: ["action", "reason", "command"],
        },
      },
      {
        name: "approval_grant",
        description: "CALLED BY HOST ONLY. Grants approval for a pending request.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: { type: "string", description: "The approval request ID" },
          },
          required: ["request_id"],
        },
      },
      {
        name: "terminal_run",
        description: "Execute a terminal command. REQUIRES a valid approval_token for safety.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to execute" },
            cwd: { type: "string", description: "Working directory" },
            approval_token: { type: "string", description: "One-time approval token from approval_grant" },
          },
          required: ["command", "approval_token"],
        },
      },
      {
        name: "git_status",
        description: "Get git status of the repository",
        inputSchema: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Repository path" },
          },
          required: ["cwd"],
        },
      },
      {
        name: "git_diff",
        description: "Get git diff of uncommitted changes",
        inputSchema: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Repository path" },
          },
          required: ["cwd"],
        },
      },
    ],
  };
});

// ============================================
// TOOL HANDLERS
// ============================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "workspace_list": {
        const tree = buildDirectoryTree(args.path, args.depth || 2);
        return {
          content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
        };
      }

      case "workspace_read": {
        if (!existsSync(args.path)) {
          throw new Error(`File not found: ${args.path}`);
        }
        const content = readFileSync(args.path, "utf-8");
        return {
          content: [{ type: "text", text: content }],
        };
      }

      case "approval_request": {
        const requestId = createApprovalRequest(
          args.action,
          args.reason,
          args.command
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "pending",
                request_id: requestId,
                message: "Awaiting user approval in the UI",
              }),
            },
          ],
        };
      }

      case "approval_grant": {
        const token = grantApproval(args.request_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "granted",
                approval_token: token,
                expires_in: "60 seconds",
              }),
            },
          ],
        };
      }

      case "terminal_run": {
        // SECURITY: Validate token before execution
        validateToken(args.approval_token);
        
        const cwd = args.cwd || process.cwd();
        const result = execSync(args.command, {
          cwd,
          encoding: "utf-8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        
        return {
          content: [
            {
              type: "text",
              text: `✅ Command executed successfully:\n${result}`,
            },
          ],
        };
      }

      case "git_status": {
        const result = execSync("git status --porcelain", {
          cwd: args.cwd,
          encoding: "utf-8",
        });
        return {
          content: [{ type: "text", text: result || "Clean working directory" }],
        };
      }

      case "git_diff": {
        const result = execSync("git diff", {
          cwd: args.cwd,
          encoding: "utf-8",
        });
        return {
          content: [{ type: "text", text: result || "No uncommitted changes" }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ============================================
// START SERVER
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeControl MCP Server running on stdio");
}

main().catch(console.error);
