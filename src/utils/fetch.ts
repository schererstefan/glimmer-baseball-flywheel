export async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const callerSignal = init?.signal ?? undefined;
  const onAbort = () => {
    if (!ctrl.signal.aborted) ctrl.abort(callerSignal?.reason);
  };
  if (callerSignal) {
    const signal: AbortSignal = callerSignal;
    if (signal.aborted) {
      clearTimeout(t);
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("The operation was aborted");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
    if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
  }
}
