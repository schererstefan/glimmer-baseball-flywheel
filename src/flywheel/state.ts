import fs from "node:fs";
import path from "node:path";

export type FlywheelState = {
  version: number;
  updatedAt: string;
  iteration: number;
  bestRunId: string | null;
  bestAccuracy: number;
  bestModel: string | null;
  history: Array<{
    iteration: number;
    runId: string;
    accuracy: number;
    weightedAccuracy: number;
    model: string;
    promoted: boolean;
    at: string;
  }>;
  curriculum: {
    weakSlices: Array<{ slice: string; acc: number }>;
    focusCategories: string[];
    freshnessRefreshDue: string;
  };
  nextAction: "eval" | "synthesize" | "train" | "promote" | "done";
  totalIters: number;
};

const DEFAULT_STATE: FlywheelState = {
  version: 1,
  updatedAt: new Date().toISOString(),
  iteration: 0,
  bestRunId: null,
  bestAccuracy: 0,
  bestModel: null,
  history: [],
  curriculum: {
    weakSlices: [],
    focusCategories: ["stats", "live_season"],
    freshnessRefreshDue: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
  nextAction: "eval",
  totalIters: 0,
};

export function statePath(): string {
  return path.resolve("flywheel/state/flywheel.json");
}

export const SPEC_STATE_PATH = path.resolve("flywheel/state.json");

export function loadState(): FlywheelState {
  const p = statePath();
  const specP = SPEC_STATE_PATH;
  // Prefer legacy, but also check spec path for compatibility
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8")) as FlywheelState;
    } catch {}
  }
  if (fs.existsSync(specP)) {
    try {
      return JSON.parse(fs.readFileSync(specP, "utf8")) as FlywheelState;
    } catch {}
  }
  return { ...DEFAULT_STATE };
}

export function saveState(s: FlywheelState) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  s.updatedAt = new Date().toISOString();
  const json = JSON.stringify(s, null, 2);
  fs.writeFileSync(p, json);
  // Also write to spec path flywheel/state.json for compatibility
  try {
    const specP = SPEC_STATE_PATH;
    fs.mkdirSync(path.dirname(specP), { recursive: true });
    fs.writeFileSync(specP, json);
  } catch {}
}

export function bumpIteration(
  s: FlywheelState,
  entry: FlywheelState["history"][number],
): FlywheelState {
  s.iteration += 1;
  s.totalIters += 1;
  s.history.push(entry);
  if (entry.accuracy > s.bestAccuracy) {
    s.bestAccuracy = entry.accuracy;
    s.bestRunId = entry.runId;
    s.bestModel = entry.model;
  }
  return s;
}
