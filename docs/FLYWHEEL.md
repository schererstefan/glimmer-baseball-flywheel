# Flywheel — recursive hill-climb

## State

`flywheel/state/flywheel.json`:

```json
{ "version":1, "iteration":2, "bestAccuracy":0.45, "bestRunId":"2026-08-21T04-...", "history":[...], "curriculum":{...} }
```

Updated by `bumpIteration`; `bestAccuracy` is monotonic (promotion only).

## Iteration steps

```
eval_current ─► analyze_weak_slices ─► buildCurriculum (focusCategories, nextN, freshnessRefresh)
       ─► generateSynthetic(weakSlices, N) ─► SFT+DPO ─► mockTrainer ─► eval_candidate (same model, extended data mimics +2pp)
       ─► isSignificant(prev, next) ─► PROMOTE or HOLD ─► metaEval ─► report.md
```

## Promotion

`isSignificant(prevAcc, prevN, nextAcc, nextN)`:

- Wilson CI non-overlap and delta>0 → PROMOTE
- else delta ≥ threshold (env `FLYWHEEL_PROMOTION_P`, default 0.02) → PROMOTE
- else HOLD (but synthetic data still committed for next round’s dataset)

## Curriculum

`buildCurriculum(run)`:

- `focusCategories` = 3 lowest `byCategory.acc`
- `upweightedSlices` = `weakestSlices` weighted 1.0–1.6
- `freshnessRefresh` = live/seasonal IDs older than 7 days
- `nextN` = clamp(10, 80, round((1-accuracy)*80))

Synthetic uses `focusCategories` to pick template pools; `nextN` decides how many to generate.

## Meta-eval

Flags:

- `staleLive > 10` → warn → refresh via web search
- `<5` per category or `<15` teams → coverage gap
- `hallucinationRate > 20%` → add abstention training
- `accuracy < 70%` → keep hill-climbing

## Recurrence

- **GitHub Actions** `flywheel.yml` cron `0 3 * * *` UTC + `workflow_dispatch` (provider, max_iters, dry_run). Commits back via `actions/checkout` write token.
- **Local** `pnpm flywheel --once` or `--max-iters 3`; `--dry-run` skips synthetic/train.
- **Status** `pnpm flywheel --status` cats state; reports in `flywheel/reports/*.md`.

## Going recursive

Each commit triggers `eval.yml` (dataset change → eval). Next night’s flywheel sees new `bestAccuracy` and new synthetic, so improvements compound. To make it fully autonomous, enable branch protection + auto-merge for `flywheel[bot]` commits.

## Training backends

`TRAINER_BACKEND=mock` (default) → logs “would train … +2.1pp”. Replace with `unsloth`/`axolotl` by adding a script that reads `training/datasets/*.jsonl` and calls `accelerate launch`. The manifest’s `candidateModel` would then be a real Ollama model id for next eval.
