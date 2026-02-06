"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Terminal, FolderTree, Code2 } from "lucide-react";
import {
  WorkspaceTree,
  CodePanel,
  ApprovalCard,
  TerminalStream,
  DiffReview,
} from "@/components/vibe";

type MessageRole = "user" | "assistant";

interface UIComponent {
  type: "workspace_tree" | "code_panel" | "approval_card" | "terminal_stream" | "diff_review";
  props: any;
}

type HudTab = "workspace" | "code" | "terminal" | "diff";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  components?: UIComponent[];
  timestamp: Date;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeHudTab, setActiveHudTab] = useState<HudTab>("workspace");
  const [hudState, setHudState] = useState<{
    workspace?: UIComponent;
    code?: UIComponent;
    terminal?: UIComponent;
    diff?: UIComponent;
  }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      const hudUpdates: Partial<typeof hudState> = {};
      const chatComponents: UIComponent[] = [];
      for (const comp of (data.components || []) as UIComponent[]) {
        switch (comp.type) {
          case "workspace_tree":
            hudUpdates.workspace = comp;
            setActiveHudTab("workspace");
            break;
          case "code_panel":
            hudUpdates.code = comp;
            setActiveHudTab("code");
            break;
          case "terminal_stream":
            hudUpdates.terminal = comp;
            setActiveHudTab("terminal");
            break;
          case "diff_review":
            hudUpdates.diff = comp;
            setActiveHudTab("diff");
            break;
          default:
            chatComponents.push(comp);
        }
      }

      if (Object.keys(hudUpdates).length > 0) {
        setHudState((prev) => ({ ...prev, ...hudUpdates }));
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.content || "",
        components: chatComponents,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(input);
  };

  const renderHudContent = () => {
    switch (activeHudTab) {
      case "workspace":
        return hudState.workspace ? (
          <WorkspaceTree
            {...hudState.workspace.props}
            onFileSelect={(path) => sendMessage(`Read the file ${path}`)}
          />
        ) : (
          <div className="text-sm text-zinc-500 p-4">
            Ask &quot;Show me the project structure&quot; to populate the workspace view.
          </div>
        );
      case "code":
        return hudState.code ? (
          <CodePanel {...hudState.code.props} />
        ) : (
          <div className="text-sm text-zinc-500 p-4">
            Ask me to read a file to populate the code view.
          </div>
        );
      case "terminal":
        return hudState.terminal ? (
          <TerminalStream {...hudState.terminal.props} />
        ) : (
          <div className="text-sm text-zinc-500 p-4">
            Run a command (it will appear here after approval).
          </div>
        );
      case "diff":
        return hudState.diff ? (
          <DiffReview {...hudState.diff.props} />
        ) : (
          <div className="text-sm text-zinc-500 p-4">
            No diff to review yet.
          </div>
        );
      default:
        return null;
    }
  };

  const renderComponent = (component: UIComponent, index: number) => {
    switch (component.type) {
      case "workspace_tree":
        return <WorkspaceTree key={index} {...component.props} />;
      case "code_panel":
        return <CodePanel key={index} {...component.props} />;
      case "approval_card":
        return (
          <ApprovalCard
            key={index}
            {...component.props}
            onExecutionComplete={(output) => {
              setHudState((prev) => ({
                ...prev,
                terminal: {
                  type: "terminal_stream",
                  props: {
                    lines: String(output || "").split("\n"),
                    status: "success",
                    command: component.props.command,
                  },
                },
              }));
              setActiveHudTab("terminal");
            }}
          />
        );
      case "terminal_stream":
        return <TerminalStream key={index} {...component.props} />;
      case "diff_review":
        return <DiffReview key={index} {...component.props} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-xl font-semibold">VibeControl</h1>
          <span className="text-xs text-zinc-500 px-2 py-0.5 bg-zinc-800 rounded">
            v0.1
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-500">
          <div className="flex items-center gap-1.5">
            <FolderTree className="w-4 h-4" />
            <span>Workspace</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Code2 className="w-4 h-4" />
            <span>Generative UI</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Persistent HUD */}
        <aside className="w-[420px] border-r border-zinc-800 bg-zinc-950/40 flex flex-col min-h-0">
          <div className="flex items-center gap-1 p-3 border-b border-zinc-800">
            {(
              [
                { id: "workspace", label: "Workspace" },
                { id: "code", label: "Code" },
                { id: "terminal", label: "Terminal" },
                { id: "diff", label: "Diff" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveHudTab(id)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  activeHudTab === id
                    ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                    : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">{renderHudContent()}</div>
        </aside>

        {/* Chat */}
        <div className="flex-1 flex flex-col min-h-0">
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.length === 0 && (
                <div className="text-center py-20">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
                    <Terminal className="w-8 h-8 text-amber-500" />
                  </div>
                  <h2 className="text-2xl font-semibold mb-2">Welcome to VibeControl</h2>
                  <p className="text-zinc-500 max-w-md mx-auto">
                    Your AI-powered IDE. Ask me to explore your codebase, analyze files,
                    or run commands.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {[
                      "Show me the project structure",
                      "Read the main config file",
                      "Run the tests",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => sendMessage(suggestion)}
                        className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-amber-600 text-white"
                        : "bg-zinc-800 text-zinc-100"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    {message.components?.map((comp, i) => renderComponent(comp, i))}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 rounded-2xl px-4 py-3">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </main>

          <footer className="border-t border-zinc-800 bg-zinc-900/50 p-4">
            <form
              onSubmit={handleSubmit}
              className="max-w-4xl mx-auto flex items-center gap-3"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything about your codebase..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </footer>
        </div>
      </div>
    </div>
  );
}
