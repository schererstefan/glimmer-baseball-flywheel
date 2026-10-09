import type {
  ChatMessage,
  ModelProvider,
  ToolCall,
} from "@/src/providers/types.ts";
import { tools as catalog } from "@/src/tools/catalog.ts";
import { runTool } from "@/src/tools/registry.ts";
import { buildSystemPrompt } from "./prompts.ts";

export const MAX_TOOL_ROUNDS = 4;

export type LoopResult = {
  text: string;
  toolCalls: ToolCall[];
  rounds: number;
};

export async function runLoop(opts: {
  provider: ModelProvider;
  messages: ChatMessage[];
  temperature?: number;
  onDelta?: (t: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
}): Promise<LoopResult> {
  const conversation: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...opts.messages,
  ];
  let fullText = "";
  const allCalls: ToolCall[] = [];
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const deltas: string[] = [];
    const calls: ToolCall[] = [];
    for await (const d of opts.provider.chat({
      messages: conversation,
      tools: catalog,
      temperature: opts.temperature ?? 0,
    })) {
      if (d.type === "text") {
        deltas.push(d.text);
        fullText += d.text;
        opts.onDelta?.(d.text);
      } else if (d.type === "tool_use") {
        calls.push(d.toolCall);
        allCalls.push(d.toolCall);
        opts.onToolUse?.(d.toolCall.name, d.toolCall.input);
      } else if (d.type === "done") break;
    }
    if (calls.length === 0) {
      if (deltas.length)
        conversation.push({ role: "assistant", content: deltas.join("") });
      return { text: fullText, toolCalls: allCalls, rounds };
    }
    conversation.push({
      role: "assistant",
      content: deltas.join("") || "",
      tool_calls: calls,
    });
    const results = await Promise.all(
      calls.map(async (tc) => {
        try {
          const out = await runTool(tc.name, tc.input);
          opts.onToolResult?.(tc.name, out.result);
          return { id: tc.id, name: tc.name, result: out.result };
        } catch (e) {
          return {
            id: tc.id,
            name: tc.name,
            result: { error: e instanceof Error ? e.message : String(e) },
          };
        }
      }),
    );
    for (const r of results)
      conversation.push({
        role: "tool",
        tool_call_id: r.id,
        name: r.name,
        content: JSON.stringify(r.result),
      });
  }
  return { text: fullText, toolCalls: allCalls, rounds };
}
