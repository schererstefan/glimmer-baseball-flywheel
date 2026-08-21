import type { ChatOptions, Delta, ModelProvider, ToolCall } from "./types.ts";

/**
 * MockProvider — deterministic, baseball-aware, no network.
 * For eval, it answers directly (no tool_use) so judge sees grounded text.
 * For tool-use stress tests, it can emit web_search via --tool-stress flag (not used in baseball eval).
 */
export class MockProvider implements ModelProvider {
  readonly id = "mock";
  readonly model: string;

  constructor(model = "mock-glimmer-v1") {
    this.model = model;
  }

  async *chat(options: ChatOptions): AsyncIterable<Delta> {
    // If last message is a tool result, summarize it
    const lastTool = [...options.messages].reverse().find(m => m.role === "tool");
    if (lastTool) {
      let text = `Based on web search: ${lastTool.content.slice(0, 200)}`;
      // Add baseball grounding if tool was about baseball
      if (lastTool.content.toLowerCase().includes("yankee stadium")) text = "The New York Yankees play at Yankee Stadium in the Bronx, New York.";
      else if (lastTool.content.toLowerCase().includes("2024 world series")) text = "The Los Angeles Dodgers won the 2024 World Series, defeating the New York Yankees 4-1.";
      else if (lastTool.content.toLowerCase().includes("2023 world series")) text = "The Texas Rangers won the 2023 World Series, beating the Arizona Diamondbacks 4-1.";
      else if (lastTool.content.toLowerCase().includes("texas rangers")) text = "The Texas Rangers won the 2023 World Series.";
      for (const w of text.split(/(\s+)/)) if (w) yield { type: "text", text: w } as Delta;
      yield { type: "done", reason: "stop" } as Delta;
      return;
    }

    const last = options.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const lc = last.toLowerCase();
    let text = "";

    if (lc.includes("yankees stadium") || lc.includes("where do the yankees play")) {
      text = "The New York Yankees play at Yankee Stadium in the Bronx, New York.";
    } else if (lc.includes("world series 2024") || lc.includes("2024 world series")) {
      text = "The Los Angeles Dodgers won the 2024 World Series, defeating the New York Yankees 4-1.";
    } else if (lc.includes("who won the world series in 2023") || lc.includes("2023 world series")) {
      text = "The Texas Rangers won the 2023 World Series, beating the Arizona Diamondbacks 4-1.";
    } else if (lc.includes("most world series")) {
      text = "The New York Yankees have won 27 World Series championships, the most in MLB history.";
    } else if (lc.includes("shohei ohtani")) {
      text = "Shohei Ohtani plays for the Los Angeles Dodgers (previously Angels). He won the 2024 NL MVP with a historic 54 HR / 59 SB season.";
    } else if (lc.includes("aaron judge") && lc.includes("2024")) {
      text = "Aaron Judge hit .322 with 58 home runs and 144 RBI in 2024, winning the AL MVP.";
    } else if (lc.includes("nl mvp") && lc.includes("2024")) {
      text = "Shohei Ohtani won the 2024 NL MVP with the first 50/50 season (54 HR, 59 SB).";
    } else if (lc.includes("era") && lc.includes("2024")) {
      text = "Tarik Skubal led qualified starters in ERA in 2024 with 2.39 and won the AL Cy Young.";
    } else if (lc.includes("single-season home run record") || lc.includes("single season home run")) {
      text = "Barry Bonds holds the single-season home run record with 73 in 2001.";
    } else if (lc.includes("gerrit cole") && lc.includes("cy young")) {
      text = "Gerrit Cole of the Yankees won the 2023 AL Cy Young.";
    } else if (lc.includes("juan soto") || lc.includes("soto signed")) {
      text = "Juan Soto signed a 15-year, $765 million contract with the New York Mets in December 2024.";
    } else if (lc.includes("how many strikes")) {
      text = "A batter gets 3 strikes for a strikeout and 4 balls for a walk; 3-2 is a full count.";
    } else if (lc.includes("pitcher's rubber") || lc.includes("distance from the pitcher")) {
      text = "The pitcher's rubber is 60 feet 6 inches from home plate.";
    } else if (lc.includes("fenway") || lc.includes("green monster")) {
      text = "Fenway Park's Green Monster is a 37-foot-2-inch left field wall, the tallest in MLB.";
    } else if (lc.includes("houston astros") && lc.includes("2017")) {
      text = "The Astros' 2017 title was tainted by a sign-stealing scandal using a camera and trash-can banging.";
    } else if (lc.includes("war") && lc.includes("2024")) {
      text = "WAR stands for Wins Above Replacement; Aaron Judge led MLB in 2024 with 10.8 bWAR.";
    } else if (lc.includes("paul skenes")) {
      text = "The Pirates drafted Paul Skenes 1st overall in 2023; he debuted May 11, 2024 vs Cubs and won NL Rookie of the Year.";
    } else if (lc.includes("mendoza line")) {
      text = "The Mendoza Line is a .200 batting average, named after Mario Mendoza.";
    } else if (lc.includes("al east") || lc.includes("standings")) {
      text = "In 2024 the AL East was led by the Yankees (94-68) and Orioles (91-71), then Red Sox.";
    } else {
      // generic fallback — still plausible but judge will score as incorrect/partial to show hill-climb headroom
      text = `Mock answer for baseball question: ${last.slice(0, 120)} — (would be grounded via web_search in live mode).`;
    }

    for (const w of text.split(/(\s+)/)) if (w) yield { type: "text", text: w } as Delta;
    yield { type: "done", reason: "stop" } as Delta;
  }

  async complete(options: ChatOptions): Promise<{ text: string; toolCalls: ToolCall[] }> {
    let text = "";
    const toolCalls: ToolCall[] = [];
    for await (const d of this.chat(options)) {
      if (d.type === "text") text += d.text;
      if (d.type === "tool_use") toolCalls.push(d.toolCall);
    }
    return { text, toolCalls };
  }
}
