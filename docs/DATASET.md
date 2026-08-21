# Dataset

## Schema

Zod in `src/dataset/schema.ts` + JSON `dataset/v1/baseball.json`. Validated by `pnpm dataset:build --verify`.

Each `BaseballCase`:

```ts
{ id: /^bb_[a-z0-9_]+$/, question, answer, alternates, category, team, difficulty, freshness,
  gold_sources: [url], must_cite: [substr], numeric_answer, tolerance,
  tags, verified_at: ISO, expected_tools, explanation }
```

## Categories (8)

- `roster` — who plays where, jersey numbers, lineup
- `stats` — BA/ERA/HR/WAR, tolerances
- `history` — World Series, MVPs, droughts
- `rules` — strikes/balls, distances, infield fly, pitch clock
- `transactions` — trades, drafts, contracts (Soto $765M, Skenes 1st)
- `ballpark` — Green Monster, capacities, quirks
- `live_season` — standings, current leaders (freshness=live, decays fast)
- `trivia` — Mendoza Line, nicknames, slang

## Teams

Nullable `MlbTeam` (30 codes + `"CHW"`/`"CWS"` alias handling). `null` = league-wide (history). Coverage tracked in `by_team`.

## Difficulty & freshness

- `easy` (Bronx, 3 strikes), `medium` (Judge 2024 line), `hard` (Skubal ERA, WAR), `expert` (trick dimensions)
- `static` (Yankee Stadium location, rules), `seasonal` (2024 MVP, WS result), `live` (standings today) — live requires `web_search` tool and weekly re-verify.

## Building

```bash
pnpm dataset:build --verify               # validate v1
pnpm dataset:build --n 20                  # extend v1+synthetic → dataset/synthetic/extended-*.json
pnpm eval --mock --dataset dataset/synthetic/extended-*.json
```

Synthetic (`src/training/synthetic.ts`) templates per category, filled from `SAMPLE_VALUES`, grounded via `web_search`, judge-filtered.

## Versioning

`version: "v1.0.0"` → `v1.0.0+synthN` for synthetic forks. Append-only, deduped by `question::answer` + id. Manifest validated via `DatasetManifestSchema`.

## Adding cases

1. Pick an `id` like `bb_stats_006`, choose category/team/difficulty/freshness.
2. Write `question` (≥10 chars), `answer` (gold), 1+ `gold_sources` URLs, `must_cite` keywords.
3. If numeric, set `numeric_answer` + `tolerance` (see JUDGE.md).
4. `pnpm dataset:build --verify` then `pnpm eval --mock --limit 5 --json` to sanity-check judge.
