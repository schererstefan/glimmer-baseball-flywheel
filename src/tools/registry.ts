import {
  handleBaseballLookup,
  handleCalculate,
  handleGetWeather,
  handleReadFile,
  handleWebSearch,
} from "./handlers.ts";

const HANDLERS: Record<
  string,
  (input: Record<string, unknown>) => Promise<{ result: unknown }>
> = {
  web_search: handleWebSearch,
  baseball_lookup: handleBaseballLookup,
  get_weather: handleGetWeather,
  calculate: handleCalculate,
  read_file: handleReadFile,
};

export async function runTool(name: string, input: Record<string, unknown>) {
  const h = HANDLERS[name];
  if (!h) return { result: { error: `Unknown tool: ${name}` } };
  return h(input);
}

export function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): string | null {
  if (name === "web_search" && !input.query) return "web_search requires query";
  if (name === "baseball_lookup" && !input.entity)
    return "baseball_lookup requires entity";
  return null;
}
