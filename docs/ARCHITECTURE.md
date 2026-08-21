# Architecture

## Provider layer

`ModelProvider` (shared with glimmer-cli):

```ts
interface ModelProvider {
  id: string; model: string;
  chat(opts: { messages, tools?, temperature? }): AsyncIterable<Delta>
  complete(opts): Promise<{ text, toolCalls }>
}
type Delta = {type:"text"} | {type:"tool_use"} | {type:"done"}
```

- **MockProvider** — deterministic baseball-aware, no tool_use in eval (so loop returns grounded text in one round). Handles `role:tool` follow-ups.
- **OllamaProvider** — `POST /api/chat` streaming JSON lines, tool_calls parsed; `OLLAMA_HOST` + `GLIMMER_MODEL`.
- **MuseSparkProvider** — OpenAI streaming SSE at `MUSE_SPARK_BASE_URL`, aggregates `tool_calls` by index.

## Agent loop

`runLoop({provider, messages, temperature:0})` — 4 tool rounds, parallel `runTool`, streams via `onDelta`. System prompt (`prompts.ts`) instructs tool use + citation.

## Tools (5)

`web_search`, `baseball_lookup` (wrapper), `get_weather`, `calculate`, `read_file`. Catalog in `src/tools/catalog.ts`; handlers in `handlers.ts` (deterministic mock + live Tavily/Brave fallback in `web_search`). Registry validates inputs.

## Judge

See [JUDGE.md](JUDGE.md). 3-stage: retrieve → extract → adjudicate. Abstain detection before rubric. Rubric first, LLM override when keys present. Verdict serialized with evidence URLs.

## Eval

Harness runs provider×dataset with concurrency 4, batches judge with concurrency 4, computes metrics (Wilson, bootstrap, weighted, time-decayed), slices. Reporter writes markdown + JSON, updates COMPARISON.md. Runner parses `--mock/--live/--provider/--dataset/--limit/--json`.

## Training

SFT builds `messages[]` with gold+explanation+citations; DPO mines `verdict=incorrect|partial` into `prompt/chosen/rejected`. Synthetic templates per category, filled via `SAMPLE_VALUES`, grounded via `getRetriever().search`, judge-filtered. Pipeline orchestrates eval→synthetic→SFT/DPO→mock trainer→manifest.

## Flywheel

State machine in `flywheel/state.json`. Orchestrator loops: eval_current → curriculum → synthetic → SFT/DPO → mock train → promotion (Wilson non-overlap or +2pp) → meta-eval → report. Curriculum upweights weak slices, decides `nextN = gap*80`. Meta-eval flags stale live, coverage gaps, leakage, hallucination.

## CI

- `ci.yml` — lint, typecheck, test, mock eval, dataset verify (no secrets).
- `flywheel.yml` — nightly 03:00 UTC hill-climb, commits artifacts.
- `eval.yml` — on dataset/src push, runs eval artifact upload.

## Env & paths

`.env.example` lists every var. `GLIMMER_CLI_PATH=../glimmer-cli` for sibling comparison.
