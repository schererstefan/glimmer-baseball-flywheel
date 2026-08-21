import type { ChatOptions, Delta, ModelProvider, ToolCall } from "./types.ts";

export class OllamaProvider implements ModelProvider {
  readonly id = "glimmer";
  readonly model: string;
  readonly baseUrl: string;

  constructor(opts: { model?: string; baseUrl?: string } = {}) {
    this.model = opts.model ?? process.env.GLIMMER_MODEL ?? "muse-glimmer";
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
  }

  async *chat(options: ChatOptions): AsyncIterable<Delta> {
    const url = `${this.baseUrl}/api/chat`;
    const messages = options.messages.map((m) => ({
      role: m.role === "tool" ? "tool" : m.role,
      content: m.content,
      tool_calls: (m as any).tool_calls,
    }));

    // Convert ToolDefinition to Ollama tools format
    const tools = options.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const body: any = {
      model: options.model ?? this.model,
      messages,
      tools,
      stream: true,
      options: { temperature: options.temperature ?? 0 },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Ollama fetch failed at ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.message?.content) yield { type: "text", text: obj.message.content } as Delta;
          if (obj.message?.tool_calls) {
            for (const tc of obj.message.tool_calls) {
              const call: ToolCall = {
                id: tc.id ?? `call_${Math.random().toString(36).slice(2, 8)}`,
                name: tc.function?.name ?? tc.name ?? "unknown",
                input: tc.function?.arguments ?? tc.input ?? {},
              };
              // Ollama sometimes returns arguments as string
              if (typeof call.input === "string") {
                try { call.input = JSON.parse(call.input); } catch {}
              }
              yield { type: "tool_use", toolCall: call } as Delta;
            }
          }
          if (obj.done) yield { type: "done", reason: obj.message?.tool_calls ? "tool_use" : "stop" } as Delta;
        } catch {
          // ignore parse errors for partial lines
        }
      }
    }
    yield { type: "done", reason: "stop" } as Delta;
  }

  async complete(options: ChatOptions): Promise<{ text: string; toolCalls: ToolCall[] }> {
    let text = "";
    const toolCalls: ToolCall[] = [];
    for await (const d of this.chat(options)) {
      if (d.type === "text") text += d.text;
      if (d.type === "tool_use") toolCalls.push(d.toolCall);
    }
    return { text, toolCalls };
  }
}
