import { describe, expect, it } from "vitest";
import { runLoop } from "@/src/agent/loop.ts";
import { MockProvider } from "@/src/providers/mock.ts";

describe("MockProvider + loop", () => {
  it("answers via loop without tools", async () => {
    const p = new MockProvider();
    const res = await runLoop({
      provider: p,
      messages: [{ role: "user", content: "Where do the Yankees play?" }],
    });
    expect(res.text.length).toBeGreaterThan(5);
    expect(res.text).toMatch(/Yankee/i);
  });

  it("supports web_search tool path", async () => {
    const p = new MockProvider();
    // trigger web_search path with a known pattern + ?
    const res = await runLoop({
      provider: p,
      messages: [
        {
          role: "user",
          content: "Who won the 2024 World Series? Use web search.",
        },
      ],
    });
    expect(res.text.length).toBeGreaterThan(0);
  });
});
