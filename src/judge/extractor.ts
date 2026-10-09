import type { Evidence } from "./types.ts";

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_CHARS = 8000;
export const DEFAULT_FETCH_TIMEOUT_MS = FETCH_TIMEOUT_MS;
export const DEFAULT_MAX_CHARS = MAX_CHARS;
export const DEFAULT_BATCH_CONCURRENCY = 3;

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  // decode entities
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, MAX_CHARS);
}

export function truncateText(text: string, maxChars = MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}… [truncated]`;
}

export async function fetchAndExtract(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<{ extracted: string; fetchedAt: string; ok: boolean }> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const fetchedAt = new Date().toISOString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "glimmer-bb-judge/1.0",
        Accept: "text/html,*/*",
      },
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, fetchedAt, extracted: "" };
    const html = await res.text();
    return {
      ok: true,
      fetchedAt,
      extracted: truncateText(htmlToText(html), maxChars),
    };
  } catch {
    clearTimeout(t);
    return { ok: false, fetchedAt, extracted: "" };
  }
}

export function evidenceFromHtml(
  url: string,
  title: string,
  html: string,
  source = "html",
): Evidence {
  const text = htmlToText(html);
  return {
    url,
    title,
    snippet: text.slice(0, 600),
    extracted: text,
    fetchedAt: new Date().toISOString(),
    source,
  };
}

export async function extractEvidence(ev: Evidence): Promise<Evidence> {
  if (ev.source === "mock" || ev.extracted) return ev;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(ev.url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "glimmer-bb-judge/1.0 (+https://github.com/schererstefan/glimmer-baseball-flywheel)",
      },
    });
    clearTimeout(t);
    if (!res.ok) return ev;
    const html = await res.text();
    const text = htmlToText(html);
    return {
      ...ev,
      extracted: text,
      snippet: text.slice(0, 500),
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return ev;
  }
}

export async function extractAll(
  evs: Evidence[],
  concurrency = 3,
): Promise<Evidence[]> {
  const out: Evidence[] = [];
  for (let i = 0; i < evs.length; i += concurrency) {
    const chunk = evs.slice(i, i + concurrency);
    const res = await Promise.all(chunk.map(extractEvidence));
    out.push(...res);
  }
  return out;
}

export const extractBatch = extractAll;
