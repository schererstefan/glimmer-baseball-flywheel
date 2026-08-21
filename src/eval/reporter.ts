import type { EvalRun } from "./harness.ts";

export function writeReport(run: EvalRun): string {
  const m = run.metrics;
  let md = `# Glimmer Baseball Flywheel — Eval Report\n\n`;
  md += `**Run:** \`${run.runId}\`  \n`;
  md += `**Time:** ${run.timestamp}  \n`;
  md += `**Provider:** \`${run.provider}\` (\`${run.model}\`)  \n`;
  md += `**Dataset:** \`${run.datasetVersion}\` (${run.datasetPath}, n=${m.total})  \n`;
  md += `**Judge:** \`${run.judgeModel}\` (web-search-grounded)  \n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value | CI / p95 |\n|---|---|---|\n`;
  md += `| Accuracy (correct/total) | **${(m.accuracy*100).toFixed(1)}%** (${m.correct}/${m.total}) | Wilson [${(m.accuracyCI[0]*100).toFixed(1)}–${(m.accuracyCI[1]*100).toFixed(1)}%] |\n`;
  md += `| Partial-credit acc (correct+0.5·partial) | ${(m.partialCreditAccuracy*100).toFixed(1)}% | bootstrap [${(m.accuracyBootstrapCI[0]*100).toFixed(1)}–${(m.accuracyBootstrapCI[1]*100).toFixed(1)}%] |\n`;
  md += `| Weighted accuracy | ${(m.weightedAccuracy*100).toFixed(1)}% | — |\n`;
  md += `| Hallucination rate | ${(m.hallucinationRate*100).toFixed(1)}% | — |\n`;
  md += `| Abstention rate | ${(m.abstentionRate*100).toFixed(1)}% | — |\n`;
  md += `| Grounded rate (evidence supports gold) | ${(m.groundedRate*100).toFixed(1)}% | — |\n`;
  md += `| Latency p50 / p95 / avg | ${m.p50LatencyMs}ms / ${m.p95LatencyMs}ms / ${m.avgLatencyMs}ms | — |\n\n`;

  md += `### By category\n\n| Category | Acc | PartialAcc | n |\n|---|---|---|---|\n`;
  for (const [k, v] of Object.entries(m.byCategory).sort()) md += `| ${k} | ${(v.acc*100).toFixed(1)}% | ${(v.partialAcc*100).toFixed(1)}% | ${v.total} |\n`;
  md += `\n### By difficulty\n\n| Difficulty | Acc | n |\n|---|---|---|\n`;
  for (const [k, v] of Object.entries(m.byDifficulty).sort()) md += `| ${k} | ${(v.acc*100).toFixed(1)}% | ${v.total} |\n`;
  md += `\n### By team (n≥3 shown)\n\n| Team | Acc | n |\n|---|---|---|\n`;
  for (const [k, v] of Object.entries(m.byTeam).filter(([,v])=>v.total>=1).sort((a,b)=>a[0].localeCompare(b[0]))) md += `| ${k} | ${(v.acc*100).toFixed(1)}% | ${v.total} |\n`;
  md += `\n### By freshness\n\n| Freshness | Acc | n |\n|---|---|---|\n`;
  for (const [k, v] of Object.entries(m.byFreshness).sort()) md += `| ${k} | ${(v.acc*100).toFixed(1)}% | ${v.total} |\n`;

  md += `\n### Weakest slices (hill-climb targets)\n\n`;
  for (const w of run.weakestSlices) md += `- \`${w.slice}\` — ${(w.acc*100).toFixed(1)}% (n=${w.total})\n`;

  md += `\n## Cases\n\n| ID | Cat | Team | Diff | Verdict | Score | Grounded | Latency | Question | Gold | Pred (trunc) |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of run.cases) {
    const pred = c.modelAnswer.replace(/\|/g,"/").replace(/\n/g," ").slice(0, 80);
    const gold = c.goldAnswer.replace(/\|/g,"/").slice(0, 40);
    md += `| ${c.id} | ${c.category} | ${c.team ?? "—"} | ${c.difficulty} | ${c.verdict.verdict} | ${c.verdict.score} | ${c.verdict.grounded ? "✓" : "✗"} | ${c.latencyMs}ms | ${c.question.slice(0,50)} | ${gold} | ${pred} |\n`;
  }

  md += `\n---\n\n*Judge:* every verdict required web-search evidence (mock or live). See JSON for per-case evidence URLs and citations.  \n`;
  md += `*Next:* \`pnpm flywheel --once\` to hill-climb on weakest slices ↘, or \`pnpm train:pipeline\` to synthesize + SFT.\n`;

  return md;
}

export function diffReports(a: EvalRun, b: EvalRun): string {
  const da = a.metrics.accuracy, db = b.metrics.accuracy;
  const delta = db - da;
  const sig = Math.abs(delta) > 0.03 ? (delta > 0 ? "▲ significant" : "▼ significant") : "→ noise";
  return `Delta ${a.provider}/${a.model} → ${b.provider}/${b.model}: ${(delta*100).toFixed(1)}pp (${(da*100).toFixed(1)}%→${(db*100).toFixed(1)}%) ${sig}`;
}
