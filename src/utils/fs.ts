import fs from "node:fs";
import path from "node:path";

export function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
export function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return fallback; }
}
export function writeJson(p: string, data: unknown) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
export function nowIso() { return new Date().toISOString(); }
export function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
