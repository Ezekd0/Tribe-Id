import { useEffect, useState } from 'react';
// Development entry point; member screens will replace this after authentication is implemented.
export function FoundationStatus() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetch('/api/v1/health', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Health request failed');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('status' in body) || body.status !== 'ok') throw new Error('Invalid response');
        setStatus('ready');
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [attempt]);
  return <main><h1>Trueda Tribe ID</h1><p>Application foundation</p><p role="status">{status === 'loading' ? 'Connecting to the API…' : status === 'ready' ? 'API is ready.' : 'API is unavailable. Start the API and try again.'}</p>{status === 'error' && <button onClick={() => setAttempt(value => value + 1)}>Try again</button>}</main>;
}
