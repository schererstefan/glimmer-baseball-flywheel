import { describe, expect, it } from "vitest";
import { handleCalculate } from "@/src/tools/handlers.ts";
import { runTool } from "@/src/tools/registry.ts";

function errorOf(r: { result: unknown }): unknown {
  return (r.result as { error?: unknown })?.error;
}

function resultValue(r: { result: unknown }): unknown {
  return (r.result as { value?: unknown })?.value;
}

describe("handleCalculate arithmetic", () => {
  const cases: Array<[string, number]> = [
    ["2*(3+4)", 14],
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["10%3", 1],
    ["2^10", 1024],
    ["2**10", 1024],
    ["1.5*2", 3],
    [".5+.25", 0.75],
    ["-3+5", 2],
    ["2*-3", -6],
    ["1/4", 0.25],
    ["  2 + 2 ", 4],
  ];
  for (const [expression, expected] of cases) {
    it(`evaluates ${JSON.stringify(expression)} = ${expected}`, async () => {
      const r = await handleCalculate({ expression });
      expect(errorOf(r)).toBeUndefined();
      expect(resultValue(r)).toBe(expected);
    });
  }
});

describe("handleCalculate rejections", () => {
  const bad = [
    "process.env",
    "(function(){})()",
    "1; 2",
    "alert(1)",
    "x+1",
    "",
    "   ",
    "1/0",
    "1+",
  ];
  for (const expression of bad) {
    it(`rejects ${JSON.stringify(expression)} with an error result`, async () => {
      const r = await handleCalculate({ expression });
      expect(typeof errorOf(r)).toBe("string");
      expect(resultValue(r)).toBeUndefined();
    });
  }
});

describe("runTool dispatch", () => {
  it("blocks code execution via the registry path", async () => {
    const r = await runTool("calculate", {
      expression: "process.env.SECRET",
    });
    expect(typeof errorOf(r)).toBe("string");
    expect(resultValue(r)).toBeUndefined();
  });

  it("wires validateToolInput into runTool", async () => {
    const r = await runTool("web_search", {});
    expect(errorOf(r)).toBe("web_search requires query");
  });
});
