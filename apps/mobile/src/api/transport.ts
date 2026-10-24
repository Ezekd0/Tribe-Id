/** No retries: a timed-out mutation or refresh may already have committed. */
export function timedFetch(transport: typeof fetch = (input, init) => fetch(input, init), timeoutMs = 20000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await transport(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
}
