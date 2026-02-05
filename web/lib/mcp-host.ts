/**
 * MCP Host/Bridge
 * Spawns MCP server as child process, handles JSON-RPC over stdio
 */

import { spawn, ChildProcess } from "child_process";
import { join } from "path";
import { EventEmitter } from "events";

let mcpProcess: ChildProcess | null = null;
let messageId = 0;
const pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

export const mcpEvents = new EventEmitter();

function getMcpProcess(): ChildProcess {
  if (mcpProcess && !mcpProcess.killed) return mcpProcess;

  const serverPath = join(process.cwd(), "..", "mcp-server", "index.js");
  
  mcpProcess = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: join(process.cwd(), "..", "mcp-server"),
  });

  mcpProcess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        if (message.id && pendingRequests.has(message.id)) {
          const { resolve, reject } = pendingRequests.get(message.id)!;
          pendingRequests.delete(message.id);
          message.error ? reject(new Error(message.error.message)) : resolve(message.result);
        }
        mcpEvents.emit("message", message);
      } catch (e) { /* not JSON */ }
    }
  });

  mcpProcess.stderr?.on("data", (data: Buffer) => console.error("[MCP]", data.toString()));
  mcpProcess.on("exit", () => { mcpProcess = null; });

  return mcpProcess;
}

async function callMcpTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const proc = getMcpProcess();
  const id = ++messageId;

  const request = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    proc.stdin?.write(JSON.stringify(request) + "\n");
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("MCP call timed out"));
      }
    }, 30000);
  });
}

export async function workspaceList(path: string, depth = 2) {
  return callMcpTool("workspace_list", { path, depth });
}

export async function workspaceRead(path: string) {
  return callMcpTool("workspace_read", { path });
}

export async function requestApproval(action: string, reason: string, command: string) {
  return callMcpTool("approval_request", { action, reason, command });
}

export async function grantApproval(requestId: string) {
  return callMcpTool("approval_grant", { request_id: requestId });
}

export async function runTerminal(command: string, approvalToken: string, cwd?: string) {
  return callMcpTool("terminal_run", { command, approval_token: approvalToken, cwd });
}

export async function gitStatus(cwd: string) {
  return callMcpTool("git_status", { cwd });
}

export async function gitDiff(cwd: string) {
  return callMcpTool("git_diff", { cwd });
}
