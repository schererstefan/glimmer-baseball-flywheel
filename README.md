# glimmer-baseball-flywheel

Hill-climb flywheel for **fine-tuning Meta Glimmer on MLB baseball** — grounded dataset, web-search judge, SFT/DPO training, and a **recursive, nightly** self-improvement loop that actually gets better.

> Builds on [`glimmer-cli`](../glimmer-cli) (local Glimmer + Muse Spark tool-use harness). This repo turns that CLI into a **training infrastructure** you can `pnpm flywheel --once` and watch Glimmer stop hallucinating batting averages.

![CI](https://img.shields.io/badge/ci-pnpm%20test%20%2B%20mock%20eval-blue) ![Judge](https://img.shields.io/badge/judge-web--search%20grounded-0ea5e9) ![Dataset](https://img.shields.io/badge/dataset-v1%2020%20seed%20%E2%86%92%20120%2B%20synth-f59e0b) ![Flywheel](https://img.shields.io/badge/flywheel-nightly%2003%3A00%20UTC-22c55e)

## Why this exists

Glimmer is great at tool-use but hallucinates baseball facts when forced to recall:

- “Who had the best ERA in 2024?” → 4.12 (wrong, it was Skubal 2.39)
- “Where do the Yankees play?” → “Madison Square Garden” (no)

We fix that with a **flywheel**:

```
eval (web-search judge) → weakest slices → grounded synthesis → SFT/DPO → re-eval → promote if p<0.05 → repeat
```

Every iteration improves three things at once: the **dataset** (curriculum focuses on weak teams/categories), the **judge** (meta-eval tracks judge health), and the **model** (LoRA on grounded SFT/DPO). It recurses nightly via GitHub Actions.

## Quick start

```bash
git clone https://github.com/schererstefan/glimmer-baseball-flywheel.git
cd glimmer-baseball-flywheel
pnpm install

# 1) Mock eval — no keys, no network, ~2s (CI-safe)
pnpm eval --mock                # 20 cases, web-search judge in mock mode
pnpm eval --mock --json | jq .metrics

# 2) Dry-run flywheel iteration (no training, just eval → curriculum → synthetic)
pnpm flywheel --once --dry-run  # writes evals/results + flywheel/reports

# 3) Full flywheel iteration (eval → synthetic 20 → SFT/DPO → mock-train → re-eval → promotion check)
pnpm flywheel --once

# 4) Inspect state
pnpm flywheel --status          # flywheel/state/flywheel.json
cat evals/COMPARISON.md         # latest report
ls flywheel/reports/            # per-iteration narratives
```

### With live judge + real model (optional, not required for CI)

```bash
cp .env.example .env.local
# set: TAVILY_API_KEY or BRAVE_API_KEY, ANTHROPIC_API_KEY (judge LLM), OLLAMA_HOST, GLIMMER_MODEL

# live web-search grounding (Tavily/Brave + extraction + LLM adjudication)
pnpm eval --live --provider glimmer --model muse-glimmer

# live nightly hill-climb
pnpm flywheel --once --provider glimmer --judge-live
```

If keys are missing the judge **falls back to mock** automatically — never breaks CI.

## The flywheel, in one picture

```
                    ┌─────────────────────────────────────┐
                    │           dataset/v1/baseball.json   │
                    │  20 curated → 120+ via synthetic     │
                    │  8 categories × 30 teams × 4 diffs  │
                    └──────────────┬──────────────────────┘
                                   │ eval
                    ┌──────────────▼──────────────────────┐
                    │  src/eval/harness.ts                │
  glimmer-cli       │  ModelProvider (mock|ollama|spark)  │   src/judge/
  (sibling) ◄──────►│  → Judge (web-search grounded)      │◄──── verifier.ts
                    │  → metrics (acc, halluc, CI, slices)│      retriever.ts (Tavily/Brave/mock)
                    └──────────────┬──────────────────────┘       rubric.ts
                                   │ weakestSlices
                    ┌──────────────▼──────────────────────┐
                    │  curriculum.ts  (adaptive)          │
                    │  focus: stats:0%, rules:0% → nextN=20
                    └──────────────┬──────────────────────┘
                                   │ synthetic (grounded)
                    ┌──────────────▼──────────────────────┐
                    │  src/training/synthetic.ts          │
                    │  templates → web_search → judge filter
                    │  70% keep rate, provenanced          │
                    └──────────────┬──────────────────────┘
                                   │ SFT/DPO
                    ┌──────────────▼──────────────────────┐
                    │  sft.ts / dpo.ts → jsonl            │
                    │  unsloth/axolotl/ollama (mock in CI) │
                    └──────────────┬──────────────────────┘
                                   │ candidate model
                    ┌──────────────▼──────────────────────┐
                    │  re-eval → Wilson CI non-overlap?   │
                    │  +2pp threshold → PROMOTE or HOLD   │
                    └──────────────┬──────────────────────┘
                                   │ meta-eval + report
                    ┌──────────────▼──────────────────────┐
                    │  flywheel/reports/*.md              │
                    │  flywheel/state/flywheel.json       │
                    │  (recurses tomorrow 03:00 UTC)      │
                    └─────────────────────────────────────┘
```

## Dataset: `dataset/v1/baseball.json`

**Taxonomy** (every case has it):

| Axis | Values |
|------|--------|
| `category` | `roster` · `stats` · `history` · `rules` · `transactions` · `ballpark` · `live_season` · `trivia` |
| `team` | 30 MLB codes (`NYY`…`WSH`) or `null` (league-wide) |
| `difficulty` | `easy` · `medium` · `hard` · `expert` |
| `freshness` | `static` (never stales) · `seasonal` (yearly) · `live` (needs re-verify, weekly) |

**Schema** per case:

```ts
{ id, question, answer, alternates, category, team, difficulty, freshness,
  gold_sources: string[], must_cite: string[], numeric_answer, tolerance,
  verified_at, expected_tools, explanation }
```

**v1 seed**: 20 hand-curated, every answer verifiable via a `gold_source` URL (Wikipedia, Baseball-Reference, MLB.com). Examples:

- “Where do the Yankees play?” → Yankee Stadium, Bronx (static, ballpark)
- “Who won the 2024 World Series 4-1?” → Dodgers over Yankees (seasonal, history)
- “Tarik Skubal ERA 2024?” → 2.39 ±0.02 (hard, stats, live)
- “Mendoza Line?” → .200, Mario Mendoza (easy, trivia, static)

**Synthetic expansion**: `pnpm dataset:build --n 20` or flywheel’s `synthetic.ts` mines weak slices and generates **grounded** variants via templates + `web_search` + judge filter (keeps ~70%). Provenance tracked; v1 → v2 is append-only with dedupe.

**Freshness decay**: `live` cases older than 14 days flagged by meta-eval → auto-refresh via web search before promotion.

## Judge: web-search reality (not an LLM opinion)

```
question + gold + model answer
        │
        ▼
  getRetriever() → Tavily (or Brave or mock)
        │ search(question, 5)
        ▼
  extractAll() → fetch URLs, html→text, 8s timeout, 8k truncation
        │
        ▼
  adjudicate:
    1) abstain check ("I don't know" → abstain, not incorrect)
    2) rubric (scoreByCategory: roster/history/stats tolerances, token recall)
    3) LLM-as-judge (Claude Sonnet 4 if ANTHROPIC_API_KEY else rubric-only)
        │
        ▼
  verdict { correct|partial|incorrect|abstain, score 0/0.5/1, grounded, hallucinationDetected, citations[], reasoning }
```

**Why not just LLM-as-judge?** Hallucinated judges hallucinate. Our judge requires **evidence**: `grounded=true` only if gold tokens appear in retrieved snippets or Tavily/Brave returned results. Ungrounded correct-looking answers are capped at `partial`.

**Tolerances** (baseball-specific):

- Batting average ±0.001, ERA/WHIP ±0.01, OPS ±0.005, WAR ±0.2
- Counting stats (HR, RBI, wins) exact; off-by-1 → partial
- History: year + champion must both match; missing year = incorrect

**Modes**:

| Env | Retriever | Extraction | Adjudication |
|-----|-----------|------------|--------------|
| `MOCK_JUDGE=1` or no keys | `MockRetriever` (canned MLB facts) | skipped | rubric only |
| `TAVILY_API_KEY` set | `TavilyRetriever` | live fetch | rubric + LLM if `ANTHROPIC_API_KEY` |
| `BRAVE_API_KEY` set | `BraveRetriever` | live fetch | same |

CI always uses mock → deterministic, offline, <0.2s per case.

## Eval: `src/eval/`

- **Harness** `harness.ts`: runs `ModelProvider` (mock | Ollama Glimmer | Muse Spark) over dataset, calls `batchJudge` (concurrency 4), computes metrics, saves `evals/results/<iso>.json` + `evals/COMPARISON.md`.
- **Metrics** `metrics.ts`: accuracy, partial-credit, weighted (category×difficulty), time-decayed, hallucination/abstention/grounded rates, Wilson & bootstrap CIs, slices by category/team/difficulty/freshness, p50/p95 latency, `weakestSlices` top-5.
- **Reporter** `reporter.ts`: markdown with tables + per-case verdicts + deltas.
- **Runner** `runner.ts`: CLI (`--mock/--live`, `--provider`, `--dataset`, `--limit`, `--json`).

**Promotion rule** (flywheel): Wilson CI non-overlap **or** delta ≥ +2pp over `flywheel/state/flywheel.json` best. `HOLD` keeps candidate data but doesn’t update `bestModel`.

## Training: `src/training/`

| Builder | Input | Output | Format |
|---------|-------|--------|--------|
| `sft.ts` | `dataset/v1/baseball.json` + synthetic | `training/datasets/*.sft.jsonl` | `{ system, user, assistant (gold+explanation+citations) }` |
| `dpo.ts` | `evals/results/*.json` failures | `*.dpo.jsonl` | `{ prompt, chosen (gold), rejected (model), metadata }` |
| `synthetic.ts` | `weakSlices` + `web_search` | `dataset/synthetic/*.json` | grounded cases, judge-filtered |
| `pipeline.ts` | all above | `training/runs/*.manifest.json` | mock or `unsloth/axolotl/ollama` (via `TRAINER_BACKEND`) |

**Configs** `configs.ts` presets:

- `glimmer-lora-quick` (r=16, 2 epochs, 2e-4) — smoke
- `glimmer-lora-deep` (r=64, 3 epochs, 1e-4) — real
- `glimmer-dpo` (5e-5, 1 epoch)

Local LoRA example (when you have Ollama + HF):

```bash
TRAINER_BACKEND=unsloth pnpm train:pipeline --dataset dataset/v1/baseball.json --provider glimmer
```

CI uses `TRAINER_BACKEND=mock` — logs “would train … +2.1pp” without GPU.

## Flywheel: `src/flywheel/`

**Orchestrator** `orchestrator.ts` — the recursive loop you asked for:

```bash
pnpm flywheel --once               # single iteration, mock
pnpm flywheel --once --dry-run     # eval + curriculum only
pnpm flywheel --once --provider glimmer --judge-live
pnpm flywheel --status             # cat flywheel/state/flywheel.json
```

State lives in `flywheel/state/flywheel.json` (iteration, bestAccuracy, history). Each iteration writes `flywheel/reports/<runId>.md`.

**Curriculum** `curriculum.ts`: upweights weak slices, decides `nextN` from accuracy gap (10–80), lists `freshnessRefresh` stale IDs.

**Meta-eval** `meta-eval.ts`: checks judge health, dataset coverage gaps (<5 per category, <15 teams), stale live (>14d), leakage (perfect-match suspect), hallucination >20% → recommendations.

**Recurrence**:

- GitHub Actions `flywheel.yml`: **nightly 03:00 UTC** (`schedule: cron "0 3 * * *"`), plus `workflow_dispatch` with `provider/max_iters/dry_run` inputs. Commits `evals/results/`, `flywheel/reports/`, `flywheel/state/`, `dataset/synthetic/` back to `main`.
- Local: `pnpm flywheel` (up to `FLYWHEEL_MAX_ITERS=3`) or cron `crontab -e` → `0 3 * * * cd ~/dev/glimmer-baseball-flywheel && pnpm flywheel --once`.

## Project layout

```
dataset/v1/baseball.json      20 curated cases (synth → 120+)
dataset/generators/           template registry (future)
src/
  providers/  mock | ollama (Glimmer) | muse-spark
  tools/      web_search, baseball_lookup, calculate, read_file
  agent/      loop (4 rounds) + prompts
  judge/      retriever → extractor → rubric → verifier
  eval/       harness, metrics, reporter, runner
  training/   sft, dpo, synthetic, pipeline, configs
  flywheel/   orchestrator, curriculum, meta-eval, state
  dataset/    builder, verifier
evals/results/  <iso>.json + <iso>.md + COMPARISON.md
flywheel/state/ flywheel.json
flywheel/reports/ per-iteration
training/datasets/ sft.jsonl, dpo.jsonl
.github/workflows/ ci.yml, flywheel.yml (03:00 UTC), eval.yml
```

## Relation to glimmer-cli

| Repo | Role |
|------|------|
| `glimmer-cli` | Tool-use harness, 12 stubbed tools, Ollama+Muse Spark providers, 45 generic cases |
| `glimmer-baseball-flywheel` (this) | **Builds on top** — replaces generic `cases.json` with baseball-grounded `dataset/v1`, swaps stubbed `web_search` for live Tavily/Brave, upgrades mock→grounded judge, adds SFT/DPO + synthetic loop + Wilson-promotion + nightly recursion. Reuses `ModelProvider` interface and `runLoop` verbatim. Sibling via `GLIMMER_CLI_PATH=../glimmer-cli`. |

## env

See `.env.example`:

```
OLLAMA_HOST, GLIMMER_MODEL, FALLBACK_MODEL
MUSE_SPARK_API_KEY, MUSE_SPARK_BASE_URL
ANTHROPIC_API_KEY, JUDGE_MODEL, TAVILY_API_KEY, BRAVE_API_KEY, SERP_API_KEY, MOCK_JUDGE
HF_TOKEN, WANDB_API_KEY, TRAINER_BACKEND=mock|unsloth|axolotl|ollama
FLYWHEEL_CRON, FLYWHEEL_MAX_ITERS, FLYWHEEL_PROMOTION_P
GLIMMER_CLI_PATH
```

## CI gates

- `ci.yml`: `pnpm lint` → `typecheck` → `vitest run` → `pnpm eval --mock --limit 20 --json` → `dataset:build --verify`
- `eval.yml`: on push to `dataset/**` or `src/**`, runs mock live eval artifact upload
- `flywheel.yml`: nightly hill-climb + auto-commit

All gates are **mock-safe** (no secrets required).

## Go crazy, go deep, go recursive — how to

1. **Add 10 harder cases**: edit `dataset/v1/baseball.json` (use `src/dataset/schema.ts` for validation) or `pnpm dataset:build --n 10`.
2. **Hill-climb once**: `pnpm flywheel --once` — watch `weakest` shift and `synthetic` grow.
3. **Train real LoRA**: set `ANTHROPIC_API_KEY` + `TAVILY_API_KEY`, `pnpm flywheel --once --provider glimmer --judge-live`, then `TRAINER_BACKEND=unsloth pnpm train:pipeline`.
4. **Make judge stricter**: tighten `src/judge/rubric.ts` tolerances or add a `ballpark` rule.
5. **Make dataset curate itself**: set `FLYWHEEL_CRON` and let Actions loop — each PR is a new `dataset/synthetic/<run>.json` + eval.

## License

MIT — see [LICENSE](LICENSE). Assets are baseball facts (no copyrightable expression); citations required by schema.
