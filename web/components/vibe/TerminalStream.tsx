"use client";

import { useEffect, useRef } from "react";
import { z } from "zod";

export const TerminalStreamSchema = z.object({
  lines: z.array(z.string()),
  status: z.enum(["running", "success", "error", "idle"]).optional(),
  command: z.string().optional(),
});

export type TerminalStreamProps = z.infer<typeof TerminalStreamSchema>;

export function TerminalStream({ lines, status = "idle", command }: TerminalStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const statusColors = { running: "text-amber-400", success: "text-green-400", error: "text-red-400", idle: "text-zinc-500" };
  const statusIcons = { running: "⏳", success: "✓", error: "✕", idle: "○" };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden my-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className={statusColors[status]}>{statusIcons[status]}</span>
        <span className="text-sm font-medium text-zinc-300">Terminal</span>
        {command && <code className="text-xs text-zinc-500 font-mono ml-auto truncate max-w-[50%]">$ {command}</code>}
      </div>
      <div ref={scrollRef} className="h-48 overflow-y-auto p-3 font-mono text-xs">
        {lines.length === 0 ? (
          <div className="text-zinc-600">Waiting for output...</div>
        ) : (
          lines.map((line, i) => <div key={i} className="text-green-400 whitespace-pre-wrap">{line}</div>)
        )}
        {status === "running" && <div className="text-amber-400 animate-pulse">▌</div>}
      </div>
    </div>
  );
}
