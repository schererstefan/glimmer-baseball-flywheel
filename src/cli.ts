#!/usr/bin/env tsx
/**
 * glimmer-bb CLI — thin dispatcher over eval/judge/train/flywheel.
 */
const args = process.argv.slice(2);
function help() {
  console.log(`
glimmer-bb — Glimmer Baseball Flywheel CLI

Usage:
  glimmer-bb eval [--mock|--live] [--provider mock|glimmer|spark] [--dataset path] [--limit N] [--json]
  glimmer-bb judge --question "..." --answer "..." --gold "..."
  glimmer-bb dataset:build [--n 20]
  glimmer-bb sft [--dataset path] [--out path] [--augment 1]
  glimmer-bb dpo --eval evals/results/<run>.json [--out path]
  glimmer-bb synthetic [--n 20]
  glimmer-bb flywheel [--once] [--dry-run] [--status] [--max-iters 3]
  glimmer-bb pipeline [--dataset path] [--provider mock|glimmer]

Examples:
  pnpm eval --mock
  pnpm flywheel --once --dry-run
  MOCK_JUDGE=1 pnpm eval --limit 5 --json | head

Env:
  OLLAMA_HOST, GLIMMER_MODEL, ANTHROPIC_API_KEY, TAVILY_API_KEY, BRAVE_API_KEY, MOCK_JUDGE
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  help();
  process.exit(0);
}

const cmd = args[0]!;
const rest = args.slice(1);

async function dispatch() {
  const map: Record<string, string> = {
    eval: "src/eval/runner.ts",
    judge: "src/judge/verifier.ts",
    "dataset:build": "src/dataset/builder.ts",
    sft: "src/training/sft.ts",
    dpo: "src/training/dpo.ts",
    synthetic: "src/training/synthetic.ts",
    flywheel: "src/flywheel/orchestrator.ts",
    pipeline: "src/training/pipeline.ts",
  };
  const target = map[cmd];
  if (!target) {
    console.error(`unknown command: ${cmd}`);
    help();
    process.exit(1);
  }
  // re-exec with tsx and forwarded args
  const { spawn } = await import("node:child_process");
  const child = spawn("npx", ["tsx", target, ...rest], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

dispatch();
