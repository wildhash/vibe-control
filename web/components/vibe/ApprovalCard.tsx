"use client";

import { useRef, useState } from "react";
import { z } from "zod";

export const ApprovalCardSchema = z.object({
  action: z.string(),
  reason: z.string(),
  command: z.string(),
  request_id: z.string(),
});

export type ApprovalCardProps = z.infer<typeof ApprovalCardSchema> & {
  onApprove?: (token: string) => void;
  onDeny?: () => void;
  onExecutionComplete?: (output: string, status: "success" | "error") => void;
};

type Status = "pending" | "approving" | "approved" | "executing" | "success" | "denied" | "error";

export function ApprovalCard({
  action,
  reason,
  command,
  request_id,
  onApprove,
  onDeny,
  onExecutionComplete,
}: ApprovalCardProps) {
  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const outputRef = useRef<string[]>([]);
  const approveInFlightRef = useRef(false);

  const setOutputLines = (next: string[]) => {
    outputRef.current = next;
    setOutput(next);
  };

  const handleApprove = async () => {
    if (approveInFlightRef.current) return;
    approveInFlightRef.current = true;

    setStatus("approving");
    setError(null);

    try {
      // Step 1: Get approval token
      const approveResponse = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id }),
      });

      if (!approveResponse.ok) {
        throw new Error("Failed to get approval token");
      }

      const approveData = await approveResponse.json();
      const token = approveData.approval_token || 
        (approveData.content?.[0]?.text ? JSON.parse(approveData.content[0].text).approval_token : null);

      if (!token) {
        throw new Error("No token received");
      }

      setStatus("approved");
      onApprove?.(token);

      // Step 2: Execute the command
      setStatus("executing");
      setOutputLines(["$ " + command, "Executing..."]);

      const execResponse = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, approval_token: token }),
      });

      const execData = await execResponse.json();

      if (execData.success) {
        const outputText = typeof execData.output === "string" 
          ? execData.output 
          : execData.output?.content?.[0]?.text || JSON.stringify(execData.output);

        const lines = ["$ " + command, ...outputText.split("\n")];
        setOutputLines(lines);
        setStatus("success");
        onExecutionComplete?.(lines.join("\n"), "success");
      } else {
        throw new Error(execData.error || "Execution failed");
      }
    } catch (err: any) {
      const message = String(err?.message || "Execution failed");
      setStatus("error");
      setError(message);
      const next = [...outputRef.current, `❌ Error: ${message}`];
      setOutputLines(next);
      onExecutionComplete?.(next.join("\n"), "error");
    } finally {
      approveInFlightRef.current = false;
    }
  };

  const handleDeny = () => {
    setStatus("denied");
    onDeny?.();
  };

  const statusColors: Record<Status, string> = {
    pending: "border-amber-500/50 bg-amber-950/20",
    approving: "border-amber-500/50 bg-amber-950/20",
    approved: "border-blue-500/50 bg-blue-950/20",
    executing: "border-blue-500/50 bg-blue-950/20",
    success: "border-green-500/50 bg-green-950/20",
    denied: "border-red-500/50 bg-red-950/20",
    error: "border-red-500/50 bg-red-950/20",
  };

  return (
    <div className={`border rounded-lg p-4 my-3 transition-colors ${statusColors[status]}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        {status === "pending" && <span className="text-amber-500 text-lg">⚠️</span>}
        {status === "approving" && <span className="text-amber-500 text-lg animate-pulse">🔐</span>}
        {(status === "approved" || status === "executing") && <span className="text-blue-500 text-lg animate-pulse">⏳</span>}
        {status === "success" && <span className="text-green-500 text-lg">✓</span>}
        {status === "denied" && <span className="text-red-500 text-lg">✕</span>}
        {status === "error" && <span className="text-red-500 text-lg">❌</span>}
        <h3 className="font-semibold text-zinc-200">
          {status === "pending" && "Permission Required"}
          {status === "approving" && "Generating Token..."}
          {status === "approved" && "Approved"}
          {status === "executing" && "Executing..."}
          {status === "success" && "Completed"}
          {status === "denied" && "Denied"}
          {status === "error" && "Error"}
        </h3>
      </div>

      {/* Info */}
      <div className="space-y-2 mb-4">
        <p className="text-sm text-zinc-300">
          <span className="text-zinc-500">Action:</span> {action}
        </p>
        <p className="text-sm text-zinc-300">
          <span className="text-zinc-500">Reason:</span> {reason}
        </p>
        <div className="bg-zinc-900 rounded p-2 mt-2">
          <code className="text-xs text-green-400 font-mono break-all">{command}</code>
        </div>
      </div>

      {/* Buttons */}
      {status === "pending" && (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            ✓ Authorize
          </button>
          <button
            onClick={handleDeny}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            ✕ Deny
          </button>
        </div>
      )}

      {/* Terminal Output */}
      {output.length > 0 && (status === "executing" || status === "success" || status === "error") && (
        <div className="mt-4 bg-zinc-950 rounded-lg p-3 font-mono text-xs max-h-48 overflow-y-auto">
          {output.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap ${
                line.startsWith("$") ? "text-zinc-400" : 
                line.startsWith("❌") ? "text-red-400" : "text-green-400"
              }`}
            >
              {line}
            </div>
          ))}
          {status === "executing" && (
            <div className="text-amber-400 animate-pulse">▌</div>
          )}
        </div>
      )}

      {/* Error message */}
      {status === "error" && error && !output.some(l => l.includes(error)) && (
        <div className="mt-2 text-red-400 text-sm">❌ {error}</div>
      )}
    </div>
  );
}
