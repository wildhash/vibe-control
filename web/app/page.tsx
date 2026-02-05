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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
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

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.content || "",
        components: data.components || [],
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

  const handleApprove = async (token: string, componentId: string) => {
    // Token received from ApprovalCard - continue the flow
    console.log("Approval token received:", token);
    // This would typically trigger the next step in the agent flow
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
            onApprove={(token) => handleApprove(token, `${index}`)}
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
      {/* Header */}
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

      {/* Messages */}
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
                    onClick={() => setInput(suggestion)}
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

      {/* Input */}
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
  );
}
