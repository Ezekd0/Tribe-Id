import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
export interface SessionIdentity { sessionId: string; userId: string; email: string; mfaVerifiedAt?: Date | null }
export interface SessionRepository {
  resolve(tokenHash: string): Promise<SessionIdentity | null>;
  revoke(sessionId: string): Promise<void>;
}
export function hashSessionToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function createSessionToken() { return randomBytes(32).toString('base64url'); }
export function readSessionCookie(header: string | undefined, name: string): string | null {
  const matches = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export class PostgresSessionRepository implements SessionRepository {
  constructor(private pool: Pool) {}
  async resolve(tokenHash: string): Promise<SessionIdentity | null> {
    const result = await this.pool.query<SessionIdentity>(`SELECT s.id AS "sessionId", u.id AS "userId", u.email
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND u.email_verified_at IS NOT NULL AND u.account_status='enabled' AND NOT EXISTS(SELECT 1 FROM tribe_memberships m WHERE m.user_id=u.id AND m.status='active' AND m.role IN ('administrator','owner'))`, [tokenHash]);
    return result.rows[0] ?? null;
  }
  async revoke(sessionId: string) { await this.pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]); }
}
