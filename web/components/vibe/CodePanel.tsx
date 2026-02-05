"use client";

import { z } from "zod";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export const CodePanelSchema = z.object({
  code: z.string(),
  language: z.string(),
  filename: z.string(),
  readOnly: z.boolean().optional(),
});

export type CodePanelProps = z.infer<typeof CodePanelSchema> & {
  onChange?: (value: string) => void;
};

export function CodePanel({ code, language, filename, readOnly = true, onChange }: CodePanelProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden my-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-700">
        <span className="text-sm">📄</span>
        <span className="text-sm font-mono text-zinc-300">{filename}</span>
        <span className="text-xs text-zinc-500 ml-auto">{language}</span>
      </div>
      <Editor
        height="300px"
        language={language}
        value={code}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          padding: { top: 8 },
        }}
        onChange={(value) => onChange?.(value || "")}
      />
    </div>
  );
}
