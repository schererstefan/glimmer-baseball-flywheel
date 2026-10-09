import type { ChatOptions, Delta, ModelProvider, ToolCall } from "./types.ts";

export class MuseSparkProvider implements ModelProvider {
  readonly id = "spark";
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(
    opts: { model?: string; baseUrl?: string; apiKey?: string } = {},
  ) {
    this.model = opts.model ?? process.env.MUSE_SPARK_MODEL ?? "muse-spark-1.2";
    this.baseUrl = (
      opts.baseUrl ??
      process.env.MUSE_SPARK_BASE_URL ??
      "https://api.meta.ai/v1"
    ).replace(/\/$/, "");
    this.apiKey =
      opts.apiKey ??
      process.env.MUSE_SPARK_API_KEY ??
      process.env.MODEL_API_KEY ??
      "";
  }

  async *chat(options: ChatOptions): AsyncIterable<Delta> {
    if (!this.apiKey) {
      yield {
        type: "text",
        text: "[spark mock — no MUSE_SPARK_API_KEY]",
      } as Delta;
      yield { type: "done", reason: "stop" } as Delta;
      return;
    }
    const url = `${this.baseUrl}/chat/completions`;
    const messages = options.messages.map((m) => ({
      role: m.role,
      content: m.content,
      tool_call_id: (m as any).tool_call_id,
      tool_calls: (m as any).tool_calls,
    }));
    const tools = options.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        temperature: options.temperature ?? 0,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Spark ${res.status}: ${txt.slice(0, 600)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAccum = new Map<number, any>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") {
          yield { type: "done", reason: "stop" } as Delta;
          return;
        }
        try {
          const obj = JSON.parse(data);
          const choice = obj.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content)
            yield { type: "text", text: delta.content } as Delta;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const prev = toolAccum.get(idx) ?? {
                id: tc.id ?? `call_${idx}`,
                name: "",
                args: "",
              };
              if (tc.id) prev.id = tc.id;
              if (tc.function?.name) prev.name = tc.function.name;
              if (tc.function?.arguments) prev.args += tc.function.arguments;
              toolAccum.set(idx, prev);
            }
          }
          if (choice?.finish_reason === "tool_calls") {
            for (const [, v] of toolAccum) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(v.args || "{}");
              } catch {}
              yield {
                type: "tool_use",
                toolCall: { id: v.id, name: v.name, input },
              } as Delta;
            }
            yield { type: "done", reason: "tool_use" } as Delta;
          }
        } catch {}
      }
    }
    yield { type: "done", reason: "stop" } as Delta;
  }

  async complete(
    options: ChatOptions,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    let text = "";
    const toolCalls: ToolCall[] = [];
    for await (const d of this.chat(options)) {
      if (d.type === "text") text += d.text;
      if (d.type === "tool_use") toolCalls.push(d.toolCall);
    }
    return { text, toolCalls };
  }
}
