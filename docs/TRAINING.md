# Training

## SFT

`src/training/sft.ts` → `buildSFT(cases, {augment, filterFreshness})` → `SFTRecord[]` → `writeSFTJsonl`.

Each record:

```json
{ "id": "bb_roster_001", "messages": [
  {"role":"system","content":"You are a baseball-knowledgeable assistant..."},
  {"role":"user","content":"Where do Yankees play?"},
  {"role":"assistant","content":"Yankee Stadium in the Bronx...\n\nSources: https://..."}
], "metadata": {...} }
```

Chat format works for both Ollama (Glimmer) and OpenAI. `augment:1` adds paraphrase variants (`"Baseball question: ..."` etc). Dedupe by id.

CLI: `pnpm train:sft --dataset dataset/v1/baseball.json --out training/datasets/sft.jsonl --augment 1`

## DPO

`src/training/dpo.ts` → `buildDPO(evalCases, {includePartial})` → `DPOPair[]`.

Mines failures where `verdict=incorrect` (or partial if flagged). Decontamination: skips if rejected already contains gold verbatim. Writes `prompt/chosen/rejected` JSONL.

CLI: `pnpm train:dpo --eval evals/results/<run>.json --out training/datasets/dpo.jsonl --include-partial`

## Synthetic

`src/training/synthetic.ts` → `generateSynthetic(baseCases, {weakSlices, n, judgeFilter})`.

Templates per category with `{team}/{player}/{stat}` placeholders. Grounding: `getRetriever().search(q,3)` → snippet as answer, URLs as `gold_sources`. Judge filter calls `judgeAnswer` (mock) to keep only grounded/self-consistent (~60-70% keep).

CLI: `pnpm train:synthetic --n 20 --dataset dataset/v1/baseball.json --out dataset/synthetic/latest.json`

## Pipeline

`src/training/pipeline.ts` → `runPipeline({provider, datasetPath, syntheticN})`.

Sequence: base eval → synthetic (weak slice) → SFT → DPO → mock trainer → manifest `training/runs/<iso>.manifest.json`. Real trainers plug via `TRAINER_BACKEND`:

```bash
TRAINER_BACKEND=unsloth pnpm train:pipeline   # would call unsloth notebook
TRAINER_BACKEND=axolotl pnpm train:pipeline   # accelerate launch
TRAINER_BACKEND=ollama pnpm train:pipeline    # ollama create + modelfile
```

Mock trainer logs: `[mock-trainer] SFT N records + DPO M pairs -> would LoRA … Simulating +2.1pp`.

## Configs

`src/training/configs.ts` presets `PRESETS`:

- `glimmer-lora-quick` r=16, 2 epochs, lr 2e-4, bs 4, 2048 ctx — smoke (<10 min on 1xA100)
- `glimmer-lora-deep` r=64, 3 epochs, lr 1e-4, bs 8, 4096 ctx — real
- `glimmer-dpo` on top of lora-quick, lr 5e-5

YAML emission: `console.log(JSON.stringify(PRESETS["glimmer-lora-quick"], null, 2))` → pipe to `axolotl`.

## Hill-climb integration

Flywheel calls synthetic→SFT→DPO each iteration, but training is mocked in CI. To train for real, set live keys, run flywheel with `--provider glimmer --judge-live`, and export `training/datasets/*.jsonl` to your trainer. Promotion still via `isSignificant` (Wilson/McNemar).

## Monitoring

`training/runs/*.json` store baseEvalId, syntheticKept, SFT/DPO paths, trainerLog. W&B via `WANDB_API_KEY` if you wire it into your trainer script.
