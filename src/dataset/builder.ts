#!/usr/bin/env tsx
/**
 * Dataset builder — validates v1, optionally extends with synthetic, writes versioned manifest.
 * Usage: pnpm dataset:build --n 20
 */
import fs from "node:fs";
import path from "node:path";
import { generateSynthetic } from "@/src/training/synthetic.ts";
import { type BaseballCase, DatasetManifestSchema } from "./schema.ts";

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    n: Number(a.find((x) => x.startsWith("--n="))?.split("=")[1] ?? 0),
    dataset:
      a.find((x) => x.startsWith("--dataset="))?.split("=")[1] ??
      "dataset/v1/baseball.json",
    out: a.find((x) => x.startsWith("--out="))?.split("=")[1],
    verifyOnly: a.includes("--verify"),
  };
}

async function main() {
  const args = parseArgs();
  const raw = JSON.parse(fs.readFileSync(args.dataset, "utf8"));
  const manifest = DatasetManifestSchema.parse(raw);
  console.log(
    `[dataset] loaded ${manifest.version} n=${manifest.total} cases from ${args.dataset}`,
  );
  // Validate each case
  let errs = 0;
  for (const c of manifest.cases) {
    if (!c.gold_sources.length) {
      console.warn(`  warn ${c.id}: no gold_sources`);
      errs++;
    }
    if (
      c.freshness === "live" &&
      new Date(c.verified_at).getTime() < Date.now() - 30 * 86400000
    ) {
      console.warn(
        `  warn ${c.id}: stale live case (verified_at ${c.verified_at})`,
      );
    }
  }
  if (args.verifyOnly) {
    console.log(`[dataset] verify done — ${errs} warnings`);
    return;
  }
  if (args.n > 0) {
    console.log(`[dataset] generating ${args.n} synthetic grounded cases...`);
    const { kept } = await generateSynthetic(manifest.cases as BaseballCase[], {
      weakSlices: [{ slice: "category:stats", acc: 0.5 }],
      n: args.n,
    });
    const extended = {
      ...manifest,
      version: `${manifest.version}+synth${kept.length}`,
      total: manifest.total + kept.length,
      cases: [...manifest.cases, ...kept],
    };
    const out = args.out ?? `dataset/synthetic/extended-${Date.now()}.json`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(extended, null, 2));
    console.log(`[dataset] wrote extended ${extended.total} cases -> ${out}`);
  } else {
    console.log(
      `[dataset] no synthesis requested (--n >0 to generate). Manifest is valid.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
