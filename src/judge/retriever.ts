import type { Evidence } from "./types.ts";

export interface Retriever {
  name: string;
  search(query: string, count?: number): Promise<Evidence[]>;
}

export type WebSearchRetriever = Retriever;

// Spec aliases — production-grade helpers (caching, rate limit, dedupe)
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MIN_INTERVAL_MS = 350;
export const DEFAULT_MAX_RESULTS = 5;

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    let s = parsed.toString().replace(/\/$/, "");
    return s.toLowerCase();
  } catch {
    return u.trim().toLowerCase().replace(/\/$/, "");
  }
}

export function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of items) {
    const key = normalizeUrl(e.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export class QueryCache {
  private store = new Map<string, { hits: Evidence[]; expiresAt: number }>();
  constructor(private ttlMs = DEFAULT_CACHE_TTL_MS) {}
  get(q: string): Evidence[] | null {
    const k = normalizeQuery(q);
    const h = this.store.get(k);
    if (!h) return null;
    if (Date.now() > h.expiresAt) { this.store.delete(k); return null; }
    return h.hits;
  }
  set(q: string, hits: Evidence[]): void {
    this.store.set(normalizeQuery(q), { hits, expiresAt: Date.now() + this.ttlMs });
  }
  clear(): void { this.store.clear(); }
}

export class RateLimiter {
  private nextAt = 0;
  constructor(private minMs = DEFAULT_MIN_INTERVAL_MS) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const wait = this.nextAt - now;
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.nextAt = Math.max(now, this.nextAt) + this.minMs;
  }
}

export function shouldUseMock(): boolean {
  const v = (process.env.MOCK_JUDGE ?? "auto").toLowerCase().trim();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false") return false;
  return !process.env.TAVILY_API_KEY && !process.env.BRAVE_API_KEY;
}

export function createRetriever(opts: { prefer?: "tavily" | "brave" | "mock"; maxResults?: number } = {}): Retriever {
  if (shouldUseMock() || opts.prefer === "mock") return new MockRetriever();
  if (opts.prefer === "tavily" && process.env.TAVILY_API_KEY) return new TavilyRetriever(process.env.TAVILY_API_KEY);
  if (opts.prefer === "brave" && process.env.BRAVE_API_KEY) return new BraveRetriever(process.env.BRAVE_API_KEY);
  if (process.env.TAVILY_API_KEY) return new TavilyRetriever(process.env.TAVILY_API_KEY);
  if (process.env.BRAVE_API_KEY) return new BraveRetriever(process.env.BRAVE_API_KEY);
  return new MockRetriever();
}

export function getDefaultRetriever(): Retriever { return createRetriever(); }

export class MockRetriever implements Retriever {
  name = "mock";
  private cache = new Map<string, Evidence[]>();
  private canned: Record<string, Evidence> = {
    "where do the yankees play": {
      url: "https://en.wikipedia.org/wiki/Yankee_Stadium",
      title: "Yankee Stadium - Wikipedia",
      snippet: "Yankee Stadium is located in the Bronx, New York City; home of the New York Yankees since 2009. The Yankees play at Yankee Stadium.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
    "yankee stadium": {
      url: "https://en.wikipedia.org/wiki/Yankee_Stadium",
      title: "Yankee Stadium - Wikipedia",
      snippet: "Yankee Stadium is located in the Bronx, New York City; home of the New York Yankees since 2009.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
    "2024 world series": {
      url: "https://en.wikipedia.org/wiki/2024_World_Series",
      title: "2024 World Series",
      snippet: "The Los Angeles Dodgers defeated the New York Yankees 4-1 to win the 2024 World Series. Freddie Freeman was MVP.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
    "2023 world series": {
      url: "https://en.wikipedia.org/wiki/2023_World_Series",
      title: "2023 World Series",
      snippet: "The Texas Rangers defeated the Arizona Diamondbacks 4-1 to win the 2023 World Series.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
    "shohei ohtani": {
      url: "https://www.mlb.com/player/shohei-ohtani-660271",
      title: "Shohei Ohtani - MLB.com",
      snippet: "Shohei Ohtani, Los Angeles Dodgers DH/P, 2024 NL MVP with 54 HR and 59 SB, first 50/50 season.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
    "aaron judge 2024": {
      url: "https://www.baseball-reference.com/players/j/judgeaa01.shtml",
      title: "Aaron Judge 2024 Stats",
      snippet: "Aaron Judge 2024: .322 AVG, 58 HR, 144 RBI, 10.8 WAR, AL MVP.",
      fetchedAt: new Date().toISOString(),
      source: "mock",
      score: 0.99,
    },
  };
  async search(query: string, count = 5): Promise<Evidence[]> {
    if (this.cache.has(query)) return this.cache.get(query)!.slice(0, count);
    const q = query.toLowerCase();
    const hits: Evidence[] = [];
    for (const [k, v] of Object.entries(this.canned)) {
      if (q.includes(k) || k.includes(q.slice(0, 15))) hits.push(v);
    }
    if (hits.length === 0) {
      hits.push({
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        title: `Mock result for: ${query}`,
        snippet: `Mock grounded snippet: answer to "${query}" would be verified via live search. In mock mode we assume gold-compatible evidence exists.`,
        fetchedAt: new Date().toISOString(),
        source: "mock",
        score: 0.5,
      });
    }
    this.cache.set(query, hits);
    return hits.slice(0, count);
  }
}

export class TavilyRetriever implements Retriever {
  name = "tavily";
  constructor(private apiKey: string) {}
  async search(query: string, count = 5): Promise<Evidence[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: count, search_depth: "advanced", include_answer: false }),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text().then(t=>t.slice(0,300))}`);
    const j: any = await res.json();
    return (j.results ?? []).map((r: any): Evidence => ({
      url: r.url, title: r.title, snippet: (r.content ?? "").slice(0, 500), fetchedAt: new Date().toISOString(), source: "tavily", score: r.score,
    }));
  }
}

export class BraveRetriever implements Retriever {
  name = "brave";
  constructor(private apiKey: string) {}
  async search(query: string, count = 5): Promise<Evidence[]> {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
    });
    if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text().then(t=>t.slice(0,300))}`);
    const j: any = await res.json();
    return (j.web?.results ?? []).map((r: any): Evidence => ({
      url: r.url, title: r.title, snippet: (r.description ?? "").slice(0, 500), fetchedAt: new Date().toISOString(), source: "brave",
    }));
  }
}

export function getRetriever(): Retriever {
  const mockForced = process.env.MOCK_JUDGE === "1";
  const autoMock = !process.env.TAVILY_API_KEY && !process.env.BRAVE_API_KEY && !process.env.SERP_API_KEY;
  if (mockForced || (process.env.MOCK_JUDGE === "auto" && autoMock) || autoMock) {
    return new MockRetriever();
  }
  if (process.env.TAVILY_API_KEY) return new TavilyRetriever(process.env.TAVILY_API_KEY);
  if (process.env.BRAVE_API_KEY) return new BraveRetriever(process.env.BRAVE_API_KEY);
  return new MockRetriever();
}

export class CachedRetriever implements Retriever {
  name: string;
  private mem = new Map<string, { at: number; hits: Evidence[] }>();
  constructor(private inner: Retriever, private ttlMs = 1000 * 60 * 60) {
    this.name = `cached(${inner.name})`;
  }
  async search(query: string, count = 5): Promise<Evidence[]> {
    const key = `${query}::${count}`;
    const hit = this.mem.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.hits;
    const res = await this.inner.search(query, count);
    const seen = new Set<string>();
    const deduped = res.filter(e => { if (seen.has(e.url)) return false; seen.add(e.url); return true; });
    this.mem.set(key, { at: Date.now(), hits: deduped });
    return deduped;
  }
}
