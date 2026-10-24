import { timedFetch } from '../api/transport';
import { isAuthTokenPair } from '@trueda-tribe-id/contracts';
import type { AuthTokenPair } from '@trueda-tribe-id/contracts';
export type Tokens = AuthTokenPair;
export interface TokenStorage { read(): Promise<string | null>; write(token: string): Promise<void>; remove(): Promise<void> }
export class SessionFailure extends Error {
  constructor(message: string, readonly canRetry: boolean) { super(message); }
}
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const isTokens = isAuthTokenPair;
/** Memory-only access tokens; injected secure refresh storage; one rotation per process. */
export class SessionCore {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string | null> | null = null;
  private generation = 0;
  private storagePending: Promise<void> = Promise.resolve();
  constructor(private readonly baseUrl: string, private readonly storage: TokenStorage,
    private request: typeof fetch = fetch, private readonly now = Date.now) { this.request = timedFetch(request); }
  token() { return this.now() < this.expiresAt ? this.accessToken : null; }
  private store(operation: () => Promise<void>) {
    const pending = this.storagePending.then(operation);
    this.storagePending = pending.catch(() => {});
    return pending;
  }
  async accept(tokens: Tokens) {
    if (!isTokens(tokens)) throw new SessionFailure('Invalid session response.', false);
    const generation = ++this.generation;
    this.accessToken = null;
    this.expiresAt = 0;
    await this.store(() => this.storage.write(tokens.refreshToken));
    if (generation !== this.generation) return;
    this.accessToken = tokens.accessToken;
    this.expiresAt = this.now() + tokens.expiresIn * 1000;
  }
  async clear() { this.generation++; this.accessToken = null; this.expiresAt = 0; await this.store(() => this.storage.remove()); }
  refresh(): Promise<string | null> {
    if (!this.pending) this.pending = this.rotate().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async rotate() {
    const generation = this.generation;
    const refreshToken = await this.storage.read();
    if (generation !== this.generation || !refreshToken) return null;
    if (!tokenPattern.test(refreshToken)) { await this.clear(); return null; }
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
      });
    } catch {
      if (generation !== this.generation) return null;
      // An uncertain rotation may have consumed the token. Never replay it.
      await this.clear();
      throw new SessionFailure('Session restoration could not be confirmed. Sign in again.', false);
    }
    if (generation !== this.generation) return null;
    if (response.status === 401) { await this.clear(); return null; }
    if (!response.ok) {
      let failure: unknown;
      try { failure = await response.json(); } catch {}
      if (generation !== this.generation) return null;
      const error = (failure as {error?: {code?: string; refreshUnconsumed?: boolean}} | undefined)?.error;
      if ((response.status === 503 || response.status === 429) && error?.refreshUnconsumed === true && ['RATE_LIMITED','AUTH_UNAVAILABLE'].includes(error.code ?? '')) throw new SessionFailure('Session service is unavailable. Please try again.', true);
      await this.clear();
      throw new SessionFailure('Session restoration could not be confirmed. Sign in again.', false);
    }
    let acceptingGeneration: number | undefined;
    try {
      const value: unknown = await response.json();
      if (!isTokens(value)) throw new Error('Invalid tokens');
      if (generation !== this.generation) return null;
      acceptingGeneration = generation + 1;
      await this.accept(value);
      if (acceptingGeneration !== this.generation) return null;
      return this.token();
    } catch {
      // accept() advances generation itself; a newer sign-in must survive a stale failure.
      if ((acceptingGeneration ?? generation) !== this.generation) return null;
      await this.clear();
      throw new SessionFailure('Session could not be stored securely. Sign in again.', false);
    }
  }
}
