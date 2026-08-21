# Judge — web-search reality

## Contract

`JudgeInput { id, question, goldAnswer, modelAnswer, category, alternates, numericGold, tolerance, goldSources, mustCite }`
→ `JudgeVerdict { verdict: correct|partial|incorrect|abstain, score 0|0.5|1, confidence, grounded, hallucinationDetected, reasoning, evidence[], citations[] }`

## Pipeline

1. **Retrieve** `getRetriever()` → `MockRetriever` (canned MLB facts) or `TavilyRetriever`/`BraveRetriever`. Factory falls back to mock when keys missing or `MOCK_JUDGE=1`. `CachedRetriever` wrapper dedupes by URL, caches 1h.

2. **Extract** `extractAll(evs)` — fetch each URL (8s timeout), `htmlToText` (strip scripts/styles, collapse whitespace, 8k truncation), attach `extracted`. Concurrency 3. Mock evidence skips fetch.

3. **Adjudicate**
   - Abstain: `"I don't know"` / empty → `abstain` (not incorrect, hallucination=false).
   - Rubric: `scoreByCategory` — category-specific rules: history needs year+champion, stats uses `scoreNumeric` with numeric tolerance search (best of all numbers ignoring years) + verbatim fallback, roster needs token containment, etc.
   - LLM override: if `ANTHROPIC_API_KEY` and `mock=false` and `useLLM!==false`, call Claude Sonnet 4 with `JUDGE_SYSTEM_PROMPT` + evidence block, parse JSON `{verdict, confidence, reasoning, hallucinationDetected}`, override rubric. Evidence injected verbatim.

4. **Groundedness**: `true` if all gold tokens (≤6) appear in evidence text **or** retriever was Tavily/Brave.

## Tolerances

| Stat | Tolerance | Note |
|------|-----------|------|
| BA | ±0.001 | |
| ERA/WHIP | ±0.01 | |
| OPS/SLG/OBP | ±0.005 | |
| WAR | ±0.2 | |
| Counting (HR/RBI/W) | exact | off-by-1 → partial |
| Year | exact | |

Numeric extraction: regex `-?\d+(?:\.\d+)?`, collect all, filter years when gold isn’t a year, find best diff. Verbatim substring fallback (`"58"` in `"58 HR"` still correct).

## Modes & costs

- Mock: 0$/0s, deterministic, CI. 5 evidence stubs (Yankee Stadium, 2024/2023 WS, Ohtani, Judge).
- Tavily: $0.00X/q via `api.tavily.com/search`, depth advanced.
- Brave: similar via `api.search.brave.com`.
- Anthropic: Sonnet 4 ~600 tokens/verdict, only when live.

## Extending

- Add a `SerpRetriever` for Google via `SERP_API_KEY`.
- Tighten rubric via `CATEGORY_WEIGHTS` / `CATEGORY_RULES`.
- Add hallucination detector: flag model numbers not in evidence.

## Debugging

```bash
MOCK_JUDGE=1 pnpm judge --question "Where do Yankees play?" --answer "Bronx" --gold "Yankee Stadium Bronx"
ANTHROPIC_API_KEY=... TAVILY_API_KEY=... pnpm judge --question "2024 ERA leader?" --answer "Skubal 2.39" --gold "Skubal 2.39"
```
