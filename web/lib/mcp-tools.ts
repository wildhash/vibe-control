/**
 * MCP Tools - Direct Implementation
 * 
 * Instead of spawning an MCP server process, we implement the tools directly.
 * This is simpler for the hackathon and works reliably in Next.js.
 */

import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

// ============================================
// APPROVAL TOKEN MANAGEMENT
// ============================================
const pendingApprovals = new Map<string, { action: string; reason: string; command: string; timestamp: number }>();
const activeTokens = new Map<string, { requestId: string; command: string; expires: number }>();

function generateRequestId(): string {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}

function generateToken(): string {
  return `tok_${crypto.randomBytes(16).toString("hex")}`;
}

// ============================================
// FILESYSTEM HELPERS
// ============================================
type FileNode = {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
};

function buildDirectoryTree(dirPath: string, depth = 2, currentDepth = 0): FileNode[] {
  if (currentDepth >= depth) return [];
  
  const entries: FileNode[] = [];
  try {
    const items = readdirSync(dirPath);
    for (const item of items) {
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
    // Permission denied
  }
  return entries;
}

// ============================================
// EXPORTED TOOLS
// ============================================
export async function workspaceList(path: string, depth = 2): Promise<FileNode[]> {
  return buildDirectoryTree(path, depth);
}

export async function workspaceRead(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

export async function requestApproval(action: string, reason: string, command: string): Promise<{ status: string; request_id: string }> {
  const requestId = generateRequestId();
  pendingApprovals.set(requestId, {
    action,
    reason,
    command,
    timestamp: Date.now(),
  });
  // Auto-expire after 5 minutes
  setTimeout(() => pendingApprovals.delete(requestId), 5 * 60 * 1000);
  
  return {
    status: "pending",
    request_id: requestId,
  };
}

export async function grantApproval(requestId: string): Promise<{ status: string; approval_token: string }> {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    throw new Error("Invalid or expired approval request");
  }
  
  const token = generateToken();
  activeTokens.set(token, {
    requestId,
    command: pending.command,
    expires: Date.now() + 60 * 1000,
  });
  
  pendingApprovals.delete(requestId);
  
  return {
    status: "granted",
    approval_token: token,
  };
}

export async function runTerminal(command: string, approvalToken: string, cwd?: string): Promise<string> {
  const tokenData = activeTokens.get(approvalToken);
  if (!tokenData) {
    throw new Error("⛔ PERMISSION DENIED: Invalid approval token");
  }
  if (Date.now() > tokenData.expires) {
    activeTokens.delete(approvalToken);
    throw new Error("⛔ PERMISSION DENIED: Approval token expired");
  }
  // One-time use
  activeTokens.delete(approvalToken);
  
  const workDir = cwd || process.cwd();
  const result = execSync(command, {
    cwd: workDir,
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  
  return result;
}

export async function gitStatus(cwd: string): Promise<string> {
  try {
    const result = execSync("git status --porcelain", {
      cwd,
      encoding: "utf-8",
    });
    return result || "Clean working directory";
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

export async function gitDiff(cwd: string): Promise<string> {
  try {
    const result = execSync("git diff", {
      cwd,
      encoding: "utf-8",
    });
    return result || "No uncommitted changes";
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}
