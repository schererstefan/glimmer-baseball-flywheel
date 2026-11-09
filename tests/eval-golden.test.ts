import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DatasetManifest } from "@/src/dataset/schema.ts";
import { runEval } from "@/src/eval/harness.ts";
import { MockProvider } from "@/src/providers/mock.ts";

/**
 * Golden mock eval — locks the harness + judge + metrics wiring end to end.
 *
 * MockProvider and the mock judge are deterministic, so accuracy over the
 * full v1 dataset sits on a fixed plateau (0.45 = 9/20, confirmed by live
 * runs, matching the nightly flywheel history). Any drift means the
 * provider, judge, or metrics pipeline changed behavior. The CI eval gate
 * floor (--min-accuracy 0.40) sits 5pp below this plateau.
 */
describe("golden mock eval (dataset/v1/baseball.json)", () => {
  it("holds the deterministic mock plateau", async () => {
    const datasetPath = path.resolve(
      import.meta.dirname,
      "../dataset/v1/baseball.json",
    );
    const manifest = JSON.parse(
      fs.readFileSync(datasetPath, "utf8"),
    ) as DatasetManifest;

    const run = await runEval({
      provider: new MockProvider(),
      cases: manifest.cases,
      datasetVersion: manifest.version,
      datasetPath: "dataset/v1/baseball.json",
      mockJudge: true,
    });

    expect(run.total).toBe(20);
    expect(run.metrics.total).toBe(20);
    expect(run.metrics.accuracy).toBeCloseTo(0.45, 10);
    expect(run.metrics.hallucinationRate).toBeGreaterThan(0);
    expect(run.metrics.hallucinationRate).toBeLessThanOrEqual(0.5);
  });
});
