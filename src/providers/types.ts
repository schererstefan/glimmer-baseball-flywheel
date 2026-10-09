/**
 * ModelProvider — shared with glimmer-cli (provider-agnostic).
 * This copy is intentional: flywheel is a standalone repo that can import glimmer-cli as sibling,
 * but also runs standalone with its own provider impls.
 */
export type Role = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: Role;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type Delta =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCall: ToolCall }
  | { type: "done"; reason: "stop" | "tool_use" | "error" };

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  model?: string;
};

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  chat(options: ChatOptions): AsyncIterable<Delta>;
  complete(
    options: ChatOptions,
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

export type ProviderInfo = {
  id: string;
  model: string;
  baseUrl?: string;
  via: "ollama" | "api" | "mock";
};
