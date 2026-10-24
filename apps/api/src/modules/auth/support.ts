import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SessionIdentity } from '../authentication/session.js';
import { ServiceError } from '../../infrastructure/security/error.js';
import { SecretBox } from './crypto.js';
export interface AuthSettings {
    encryptionKey: string;
    rateLimitKey: string;
    mailFrom: string;
    smtpUrl: string;
    mailMode?: 'smtp' | 'local-capture';
    passwordBlocklist?: string[];
}
export async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const value = await fn(client);
        await client.query('COMMIT');
        return value;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
export async function audit(db: Pool | PoolClient, action: string, outcome: 'success' | 'denied', requestId: string, userId: string | null = null, tribeId: string | null = null, subjectKey: string | null = null) {
    await db.query('INSERT INTO auth_security_events(user_id,tribe_id,action,outcome,request_id,subject_key) VALUES($1,$2,$3,$4,$5,$6)', [userId, tribeId, action, outcome, requestId, subjectKey]);
}
export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}
export class AuthLimiter {
    constructor(private pool: Pool, private key: string) {
    }
    subject(value: string) {
        return createHmac('sha256', this.key).update(value).digest('hex');
    }
    async take(scope: string, subject: string, max: number, seconds: number, requestId: string) {
        const key = this.subject(scope + ':' + subject);
        const count = await this.pool.query<{
            count: number;
        }>(`INSERT INTO request_limits(key,window_start,count) VALUES($1,to_timestamp(floor(extract(epoch FROM clock_timestamp())/$2)*$2),1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.window_start=EXCLUDED.window_start THEN request_limits.count+1 ELSE 1 END,window_start=EXCLUDED.window_start RETURNING count`, [key, seconds]);
        if (count.rows[0]!.count > max) {
            await audit(this.pool, 'rate_limit', 'denied', requestId, null, null, key);
            throw new ServiceError(429, 'RATE_LIMITED', 'Too many attempts. Try later.');
        }
    }
}
export interface MembershipVerificationProvider {
    verify(input: {
        tribeId: string;
        membershipId: string;
        authority: SessionIdentity;
        evidenceReference: string;
    }): Promise<{
        provider: 'administrator';
        reference: string;
    }>;
}
/** Records an authorized authority's attestation. Does not claim an external registry check. */
export class AdministratorVerification implements MembershipVerificationProvider {
    async verify(input: {
        evidenceReference: string;
    }) {
        if (!input.evidenceReference.trim() || input.evidenceReference.length > 500)
            throw new ServiceError(400, 'EVIDENCE_REQUIRED', 'Record the membership approval reference.');
        return { provider: 'administrator' as const, reference: input.evidenceReference.trim() };
    }
}
export class AuthMail {
    readonly box: SecretBox;
    constructor(private settings: AuthSettings) {
        this.box = new SecretBox(settings.encryptionKey);
    }
    available() {
        if (!this.settings.smtpUrl || !this.settings.mailFrom)
            throw new ServiceError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured.');
    }
    async queue(db: PoolClient, to: string, subject: string, text: string, minutes: number) {
        this.available();
        await db.query("INSERT INTO auth_outbox(payload_ciphertext,expires_at) VALUES($1,clock_timestamp()+$2*interval '1 minute')", [this.box.seal(JSON.stringify({ to, subject, text }), 'auth-mail'), minutes]);
    }
}
