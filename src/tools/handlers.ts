export type ToolResult = { result: unknown };

const FILES: Record<string, string> = {
  "/dataset/README.md": "# Baseball dataset — see dataset/v1/baseball.json",
};

function mockWebSearch(query: string, _count = 5): ToolResult {
  const q = query.toLowerCase();
  // Deterministic stubs for common baseball queries
  if (q.includes("yankee stadium")) return { result: { hits: [{ title: "Yankee Stadium - Wikipedia", url: "https://en.wikipedia.org/wiki/Yankee_Stadium", snippet: "Yankee Stadium is in the Bronx, New York City, home of the New York Yankees since 2009 (original 1923)." }] } };
  if (q.includes("world series 2024")) return { result: { hits: [{ title: "2024 World Series - Wikipedia", url: "https://en.wikipedia.org/wiki/2024_World_Series", snippet: "The Los Angeles Dodgers defeated the New York Yankees in 5 games (4-1) to win the 2024 World Series." }] } };
  if (q.includes("shohei ohtani")) return { result: { hits: [{ title: "Shohei Ohtani - MLB.com", url: "https://www.mlb.com/player/shohei-ohtani-660271", snippet: "Shohei Ohtani, Los Angeles Dodgers DH/SP, 2024 NL MVP, 54 HR, 59 SB in 2024." }] } };
  if (q.includes("aaron judge")) return { result: { hits: [{ title: "Aaron Judge - Baseball-Reference", url: "https://www.baseball-reference.com/players/j/judgeaa01.shtml", snippet: "Aaron Judge, Yankees RF, 2024: .322 AVG, 58 HR, 144 RBI, 2024 AL MVP." }] } };
  return { result: { hits: [{ title: `Search: ${query}`, url: "https://example.com/search?q=" + encodeURIComponent(query), snippet: `Mock grounded snippet for "${query}" — replace with live Tavily/Brave in production.` }] } };
}

export async function handleWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof input.query === "string" ? input.query : "";
  const count = typeof input.count === "number" ? input.count : 5;
  if (!query) return { result: { error: "web_search requires query" } };

  // If live keys present and not in mock mode, try live fetch
  const useMock = process.env.MOCK_JUDGE === "1" || (!process.env.TAVILY_API_KEY && !process.env.BRAVE_API_KEY);
  if (useMock) return mockWebSearch(query, count);

  // Try Tavily first
  if (process.env.TAVILY_API_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: count, search_depth: "advanced", include_answer: false }),
      });
      if (res.ok) {
        const j: any = await res.json();
        const hits = (j.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 400) ?? "" }));
        if (hits.length) return { result: { hits } };
      }
    } catch {}
  }
  // Brave fallback
  if (process.env.BRAVE_API_KEY) {
    try {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY },
      });
      if (res.ok) {
        const j: any = await res.json();
        const hits = (j.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
        if (hits.length) return { result: { hits } };
      }
    } catch {}
  }
  return mockWebSearch(query, count);
}

export async function handleBaseballLookup(input: Record<string, unknown>): Promise<ToolResult> {
  const entity = typeof input.entity === "string" ? input.entity : "";
  if (!entity) return { result: { error: "baseball_lookup requires entity" } };
  return handleWebSearch({ query: `${entity} ${input.season ?? ""} ${input.stat ?? ""} baseball stats`, count: 3 });
}

export async function handleGetWeather(input: Record<string, unknown>): Promise<ToolResult> {
  const location = typeof input.location === "string" ? input.location : "New York";
  const date = typeof input.date === "string" ? input.date : new Date().toISOString().slice(0, 10);
  return { result: { location, date, condition: location.toLowerCase().includes("seattle") ? "rain" : "sunny", temp: 22, unit: "c" } };
}

export async function handleCalculate(input: Record<string, unknown>): Promise<ToolResult> {
  const expr = typeof input.expression === "string" ? input.expression : "";
  if (!expr) return { result: { error: "calculate requires expression" } };
  try {
    const fn = new Function(`return (${expr});`);
    const val = fn();
    if (typeof val !== "number" || !Number.isFinite(val)) throw new Error("not finite");
    return { result: { expression: expr, value: val } };
  } catch (e) {
    return { result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

export async function handleReadFile(input: Record<string, unknown>): Promise<ToolResult> {
  const p = typeof input.path === "string" ? input.path : "";
  const c = FILES[p];
  if (c === undefined) return { result: { error: `File not found: ${p}` } };
  return { result: { path: p, content: c } };
}
