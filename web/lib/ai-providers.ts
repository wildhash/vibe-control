/**
 * Multi-Provider AI Abstraction
 *
 * Unified interface for 9+ AI providers:
 *   OpenAI, Anthropic, Gemini, Grok (xAI), Deepseek, Moonshot,
 *   Alibaba (Qwen), Mistral, Google (Vertex-compatible)
 *
 * Each provider normalises tool definitions and responses into a common shape
 * so the agent route doesn't need to know which backend is in use.
 *
 * Providers using OpenAI-compatible APIs share the same adapter, just with
 * different base URLs and model names.
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Part,
} from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface FunctionCallRequest {
  name: string;
  args: Record<string, any>;
}

export interface ModelTurn {
  text: string;
  functionCalls: FunctionCallRequest[];
}

export interface FunctionResult {
  name: string;
  result: any;
}

/**
 * A provider-agnostic chat session that supports multi-turn tool use.
 */
export interface AIChat {
  sendMessage(message: string): Promise<ModelTurn>;
  sendToolResults(results: FunctionResult[]): Promise<ModelTurn>;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "grok"
  | "deepseek"
  | "moonshot"
  | "alibaba"
  | "mistral"
  | "google";

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseURL?: string;
}

/**
 * OpenAI-compatible provider definitions.
 * Each entry maps an env var to its base URL and default models.
 */
const OPENAI_COMPATIBLE_PROVIDERS: {
  envKey: string;
  provider: ProviderType;
  baseURL: string;
  models: string[];
}[] = [
  {
    envKey: "DEEPSEEK_API_KEY",
    provider: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    envKey: "MOONSHOT_API_KEY",
    provider: "moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-128k", "moonshot-v1-32k"],
  },
  {
    envKey: "ALIBABA_API_KEY",
    provider: "alibaba",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-turbo", "qwen-plus"],
  },
  {
    envKey: "MISTRAL_API_KEY",
    provider: "mistral",
    baseURL: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    envKey: "GROK_API_KEY",
    provider: "grok",
    baseURL: "https://api.x.ai/v1",
    models: ["grok-3-mini-fast", "grok-3-mini"],
  },
];

/**
 * Returns all configured providers in priority order.
 * A provider is only included if its API key env var is set.
 */
export function getAvailableProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // --- OpenAI (native) ---
  if (process.env.OPENAI_API_KEY) {
    providers.push({ provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY });
    providers.push({ provider: "openai", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY });
  }

  // --- Anthropic ---
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({ provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: process.env.ANTHROPIC_API_KEY });
    providers.push({ provider: "anthropic", model: "claude-3-5-haiku-20241022", apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // --- Gemini ---
  if (process.env.GEMINI_API_KEY) {
    providers.push({ provider: "gemini", model: "gemini-2.0-flash", apiKey: process.env.GEMINI_API_KEY });
    providers.push({ provider: "gemini", model: "gemini-1.5-flash", apiKey: process.env.GEMINI_API_KEY });
  }

  // --- Google (separate from Gemini if user has a different key) ---
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== process.env.GEMINI_API_KEY) {
    providers.push({ provider: "gemini", model: "gemini-2.0-flash", apiKey: process.env.GOOGLE_API_KEY });
    providers.push({ provider: "gemini", model: "gemini-1.5-flash", apiKey: process.env.GOOGLE_API_KEY });
  }

  // --- All OpenAI-compatible providers ---
  for (const def of OPENAI_COMPATIBLE_PROVIDERS) {
    const apiKey = process.env[def.envKey];
    if (apiKey) {
      for (const model of def.models) {
        providers.push({
          provider: def.provider,
          model,
          apiKey,
          baseURL: def.baseURL,
        });
      }
    }
  }

  return providers;
}

// ---------------------------------------------------------------------------
// Gemini adapter
// ---------------------------------------------------------------------------

function toGeminiTools(tools: ToolDef[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [
          k,
          {
            type: v.type === "number" ? SchemaType.NUMBER : SchemaType.STRING,
            description: v.description,
          },
        ])
      ),
      required: t.parameters.required,
    },
  }));
}

function createGeminiChat(
  config: ProviderConfig,
  systemPrompt: string,
  tools: ToolDef[],
  history: { role: string; content: string }[]
): AIChat {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const model = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: systemPrompt,
  });

  const chatHistory = history.map((msg) => ({
    role: msg.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({
    history: chatHistory,
    tools: [{ functionDeclarations: toGeminiTools(tools) }],
  });

  function parseResponse(response: any): ModelTurn {
    let text = "";
    try {
      text = response.text();
    } catch {
      /* no text */
    }
    let functionCalls: FunctionCallRequest[] = [];
    try {
      const calls = response.functionCalls() ?? [];
      functionCalls = calls.map((c: any) => ({
        name: c.name,
        args: c.args as Record<string, any>,
      }));
    } catch {
      /* no calls */
    }
    return { text, functionCalls };
  }

  return {
    label: `gemini/${config.model}`,
    async sendMessage(message: string) {
      const result = await chat.sendMessage(message);
      return parseResponse(result.response);
    },
    async sendToolResults(results: FunctionResult[]) {
      const parts: Part[] = results.map((r) => ({
        functionResponse: { name: r.name, response: { result: r.result } },
      }));
      const result = await chat.sendMessage(parts);
      return parseResponse(result.response);
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter
// Handles: OpenAI, Grok, Deepseek, Moonshot, Alibaba/Qwen, Mistral
// ---------------------------------------------------------------------------

function toOpenAITools(tools: ToolDef[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    },
  }));
}

function createOpenAICompatibleChat(
  config: ProviderConfig,
  systemPrompt: string,
  tools: ToolDef[],
  history: { role: string; content: string }[]
): AIChat {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const openaiTools = toOpenAITools(tools);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
  ];

  function parseResponse(response: OpenAI.ChatCompletion): ModelTurn {
    const choice = response.choices[0];
    const text = choice.message.content || "";
    const functionCalls: FunctionCallRequest[] = (
      choice.message.tool_calls || []
    ).map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    }));
    return { text, functionCalls };
  }

  async function complete(): Promise<{
    raw: OpenAI.ChatCompletion;
    turn: ModelTurn;
  }> {
    const resp = await client.chat.completions.create({
      model: config.model,
      messages,
      tools: openaiTools,
      tool_choice: "auto",
    });
    const turn = parseResponse(resp);
    messages.push(resp.choices[0].message);
    return { raw: resp, turn };
  }

  return {
    label: `${config.provider}/${config.model}`,
    async sendMessage(message: string) {
      messages.push({ role: "user", content: message });
      const { turn } = await complete();
      return turn;
    },
    async sendToolResults(results: FunctionResult[]) {
      const lastAssistant = [...messages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && (m as any).tool_calls?.length
        ) as OpenAI.ChatCompletionAssistantMessageParam | undefined;

      const toolCalls = (lastAssistant as any)?.tool_calls || [];

      for (let i = 0; i < results.length; i++) {
        const tcId = toolCalls[i]?.id || `call_${i}`;
        messages.push({
          role: "tool",
          tool_call_id: tcId,
          content: JSON.stringify(results[i].result),
        });
      }
      const { turn } = await complete();
      return turn;
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------

function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));
}

function createAnthropicChat(
  config: ProviderConfig,
  systemPrompt: string,
  tools: ToolDef[],
  history: { role: string; content: string }[]
): AIChat {
  const client = new Anthropic({ apiKey: config.apiKey });
  const anthropicTools = toAnthropicTools(tools);

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));

  function parseResponse(response: Anthropic.Message): ModelTurn {
    let text = "";
    const functionCalls: FunctionCallRequest[] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") {
        functionCalls.push({
          name: block.name,
          args: (block.input || {}) as Record<string, any>,
        });
      }
    }
    return { text, functionCalls };
  }

  async function complete(): Promise<{
    raw: Anthropic.Message;
    turn: ModelTurn;
  }> {
    const resp = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    });
    const turn = parseResponse(resp);
    messages.push({ role: "assistant", content: resp.content });
    return { raw: resp, turn };
  }

  return {
    label: `anthropic/${config.model}`,
    async sendMessage(message: string) {
      messages.push({ role: "user", content: message });
      const { turn } = await complete();
      return turn;
    },
    async sendToolResults(results: FunctionResult[]) {
      const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const blocks = Array.isArray(lastAssistant?.content)
        ? lastAssistant!.content
        : [];
      const toolUseBlocks = blocks.filter(
        (b: any) => b.type === "tool_use"
      ) as Anthropic.ToolUseBlock[];

      for (let i = 0; i < results.length; i++) {
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: toolUseBlocks[i]?.id || `toolu_${i}`,
          content: JSON.stringify(results[i].result),
        });
      }

      messages.push({ role: "user", content: toolResultContent });
      const { turn } = await complete();
      return turn;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Providers that use the OpenAI-compatible chat completions API */
const OPENAI_COMPATIBLE_PROVIDER_TYPES: Set<ProviderType> = new Set([
  "openai",
  "grok",
  "deepseek",
  "moonshot",
  "alibaba",
  "mistral",
]);

export function createChat(
  config: ProviderConfig,
  systemPrompt: string,
  tools: ToolDef[],
  history: { role: string; content: string }[]
): AIChat {
  if (config.provider === "gemini" || config.provider === "google") {
    return createGeminiChat(config, systemPrompt, tools, history);
  }
  if (config.provider === "anthropic") {
    return createAnthropicChat(config, systemPrompt, tools, history);
  }
  if (OPENAI_COMPATIBLE_PROVIDER_TYPES.has(config.provider)) {
    return createOpenAICompatibleChat(config, systemPrompt, tools, history);
  }
  throw new Error(`Unknown provider: ${config.provider}`);
}

/**
 * Try each available provider in order until one works.
 * Returns the first successful chat + initial response, or throws.
 */
export async function createChatWithFallback(
  systemPrompt: string,
  tools: ToolDef[],
  history: { role: string; content: string }[],
  userMessage: string
): Promise<{ chat: AIChat; turn: ModelTurn }> {
  const providers = getAvailableProviders();

  if (providers.length === 0) {
    throw new Error(
      "No AI providers configured. Set at least one API key in .env.local. " +
        "Supported: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, " +
        "GROK_API_KEY, DEEPSEEK_API_KEY, MOONSHOT_API_KEY, ALIBABA_API_KEY, MISTRAL_API_KEY"
    );
  }

  console.log(
    `[ai] ${providers.length} provider configs available: ${providers.map((p) => `${p.provider}/${p.model}`).join(", ")}`
  );

  let lastError: any = null;

  for (const config of providers) {
    try {
      const chat = createChat(config, systemPrompt, tools, history);
      const turn = await chat.sendMessage(userMessage);
      console.log(`[ai] ✓ Using provider: ${chat.label}`);
      return { chat, turn };
    } catch (err: any) {
      lastError = err;
      const reason = err.status
        ? `HTTP ${err.status}`
        : err.code || err.message?.slice(0, 80);
      console.warn(`[ai] ✗ ${config.provider}/${config.model}: ${reason}`);
      continue;
    }
  }

  throw new Error(
    `All AI providers failed. Last error: ${lastError?.message || "unknown"}. ` +
      `Tried: ${providers.map((p) => `${p.provider}/${p.model}`).join(", ")}`
  );
}
