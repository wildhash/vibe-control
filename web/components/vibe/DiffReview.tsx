"use client";

import { useState } from "react";
import { z } from "zod";

export const DiffReviewSchema = z.object({
  filename: z.string(),
  hunks: z.array(z.object({
    oldStart: z.number(),
    newStart: z.number(),
    lines: z.array(z.object({
      type: z.enum(["add", "remove", "context"]),
      content: z.string(),
      lineNumber: z.number().optional(),
    })),
  })),
});

export type DiffReviewProps = z.infer<typeof DiffReviewSchema> & {
  onApprove?: () => void;
  onReject?: () => void;
};

export function DiffReview({ filename, hunks, onApprove, onReject }: DiffReviewProps) {
  const [expanded, setExpanded] = useState(true);

  const lineColors = {
    add: "bg-green-950/50 text-green-400",
    remove: "bg-red-950/50 text-red-400",
    context: "text-zinc-400",
  };

  const linePrefix = {
    add: "+",
    remove: "-",
    context: " ",
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden my-3">
      <div 
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-700 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs">{expanded ? "▼" : "▶"}</span>
        <span className="text-sm">📝</span>
        <span className="text-sm font-mono text-zinc-300">{filename}</span>
        <span className="text-xs text-zinc-500 ml-auto">
          {hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === "add").length, 0)} additions,{" "}
          {hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === "remove").length, 0)} deletions
        </span>
      </div>

      {expanded && (
        <>
          <div className="overflow-x-auto">
            {hunks.map((hunk, hi) => (
              <div key={hi} className="border-b border-zinc-800 last:border-0">
                <div className="px-3 py-1 bg-zinc-800/30 text-xs text-zinc-500 font-mono">
                  @@ -{hunk.oldStart} +{hunk.newStart} @@
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={`px-3 py-0.5 font-mono text-xs ${lineColors[line.type]}`}
                  >
                    <span className="inline-block w-4 text-zinc-600 select-none">
                      {linePrefix[line.type]}
                    </span>
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {(onApprove || onReject) && (
            <div className="flex gap-2 p-3 border-t border-zinc-800">
              {onApprove && (
                <button
                  onClick={onApprove}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                >
                  Apply Changes
                </button>
              )}
              {onReject && (
                <button
                  onClick={onReject}
                  className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
                >
                  Discard
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
