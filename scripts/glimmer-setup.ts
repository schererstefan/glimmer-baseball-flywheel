#!/usr/bin/env tsx
const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const model = process.env.GLIMMER_MODEL ?? "muse-glimmer";
const fallback = process.env.FALLBACK_MODEL ?? "llama3.1:8b";
async function check() {
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) throw new Error(`${res.status}`);
    const j: any = await res.json();
    const models = (j.models ?? []).map((m: any)=>m.name);
    console.log(`Ollama at ${host}: ${models.join(", ") || "(no models)"}`);
    if (models.some((m:string)=>m.includes(model))) console.log(`✓ ${model} present`);
    else console.log(`→ pull ${model}: ollama pull ${model}`);
    if (process.argv.includes("--dry-run")) return;
    // try pull via API
  } catch (e) {
    console.error(`Ollama not reachable at ${host}: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`Install: brew install ollama && ollama serve &`);
    console.log(`Pull: ollama pull ${model} (fallback ${fallback})`);
  }
}
check();
