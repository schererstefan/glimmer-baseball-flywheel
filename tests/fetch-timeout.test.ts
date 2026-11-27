import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@/src/utils/fetch.ts";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when fetch never resolves", async () => {
    vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch);

    const start = Date.now();
    await expect(
      fetchWithTimeout("https://example.com", {}, 50),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("resolves when fetch is fast", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("ok", { status: 200 })) as typeof fetch,
    );

    const res = await fetchWithTimeout("https://example.com", {}, 1000);
    expect(res.status).toBe(200);
  });
});
