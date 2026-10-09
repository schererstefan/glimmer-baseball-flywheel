import type { ToolDefinition } from "@/src/providers/types.ts";

export const tools: ToolDefinition[] = [
  {
    name: "web_search",
    description:
      "Search the web for a query. Returns top hits with title, url, snippet. Use for any baseball stat, roster, trade, or history that needs grounding.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query, e.g. '2024 Dodgers roster Shohei Ohtani stats'",
        },
        count: { type: "number", description: "Results 1-10, default 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "baseball_lookup",
    description:
      "Lookup baseball entity: player, team, season, or record. Returns structured JSON from local cache or web fallback.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "Entity name, e.g. 'Aaron Judge', 'Yankees', '2024 World Series'",
        },
        season: { type: "string", description: "Optional season YYYY" },
        stat: {
          type: "string",
          description:
            "Optional stat filter: 'batting_average', 'ERA', 'HR', 'WAR', 'wins'",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "get_weather",
    description: "Get weather for a ballpark city on a date.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string" },
        date: { type: "string" },
        unit: { type: "string", enum: ["c", "f"] },
      },
      required: ["location", "date"],
    },
  },
  {
    name: "calculate",
    description: "Evaluate math, e.g. batting average = hits/at-bats.",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
  {
    name: "read_file",
    description: "Read file from stubbed FS (dataset, docs).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];
