import { describe, expect, it } from "vitest";
import { runLoop } from "@/src/agent/loop.ts";
import { MockProvider } from "@/src/providers/mock.ts";
import { MuseSparkProvider } from "@/src/providers/muse-spark.ts";
import { OllamaProvider } from "@/src/providers/ollama.ts";
import { selectProvider, VALID_PROVIDERS } from "@/src/providers/select.ts";

describe("selectProvider", () => {
  it("maps mock to MockProvider", () => {
    const p = selectProvider("mock");
    expect(p).toBeInstanceOf(MockProvider);
    expect(p.id).toBe("mock");
  });

  it("maps glimmer and ollama to OllamaProvider", () => {
    for (const name of ["glimmer", "ollama"]) {
      const p = selectProvider(name);
      expect(p).toBeInstanceOf(OllamaProvider);
      expect(p.id).toBe("glimmer");
    }
  });

  it("maps spark to MuseSparkProvider", () => {
    const p = selectProvider("spark");
    expect(p).toBeInstanceOf(MuseSparkProvider);
    expect(p.id).toBe("spark");
  });

  it("passes the model through", () => {
    expect(selectProvider("mock", "m1").model).toBe("m1");
    expect(selectProvider("glimmer", "m2").model).toBe("m2");
    expect(selectProvider("ollama", "m3").model).toBe("m3");
    expect(selectProvider("spark", "m4").model).toBe("m4");
  });

  it("lists all valid providers", () => {
    expect([...VALID_PROVIDERS]).toEqual([
      "mock",
      "glimmer",
      "ollama",
      "spark",
    ]);
  });

  it("throws on unknown providers", () => {
    expect(() => selectProvider("bogus")).toThrow(/Unknown --provider/);
    expect(() => selectProvider("")).toThrow(/Unknown --provider/);
  });
});

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
