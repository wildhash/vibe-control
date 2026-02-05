"use client";

import { useState } from "react";
import { z } from "zod";

type FileNode = {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
};

export const WorkspaceTreeSchema = z.object({
  tree: z.array(z.any()),
  rootPath: z.string(),
});

export type WorkspaceTreeProps = z.infer<typeof WorkspaceTreeSchema> & {
  onFileSelect?: (path: string) => void;
};

function TreeNode({ node, depth = 0, path, onFileSelect }: { node: FileNode; depth?: number; path: string; onFileSelect?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const currentPath = `${path}/${node.name}`;
  const isDir = node.type === "directory";
  const hasChildren = isDir && node.children && node.children.length > 0;

  return (
    <div className="select-none">
      <div
        onClick={() => isDir ? setExpanded(!expanded) : onFileSelect?.(currentPath)}
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer hover:bg-zinc-800 ${!isDir ? "text-zinc-300" : "text-zinc-100"}`}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {isDir ? <span className="text-xs w-4">{expanded ? "▼" : "▶"}</span> : <span className="text-xs w-4 text-zinc-500">•</span>}
        <span className={isDir ? "text-amber-400" : ""}>{isDir ? "📁" : "📄"}</span>
        <span className="text-sm truncate">{node.name}</span>
      </div>
      {expanded && hasChildren && node.children!.map((child, i) => (
        <TreeNode key={`${child.name}-${i}`} node={child} depth={depth + 1} path={currentPath} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
}

export function WorkspaceTree({ tree, rootPath, onFileSelect }: WorkspaceTreeProps) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 my-3">
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-800">
        <span className="text-lg">📂</span>
        <h3 className="font-medium text-zinc-200 text-sm">Workspace</h3>
        <span className="text-xs text-zinc-500 font-mono truncate ml-auto">{rootPath}</span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {tree.map((node: FileNode, i: number) => (
          <TreeNode key={`${node.name}-${i}`} node={node} path={rootPath} onFileSelect={onFileSelect} />
        ))}
      </div>
    </div>
  );
}
