import type { Pool, PoolClient } from 'pg';
import type { AuthTokenPair as TokenPair, AuthDeviceView } from '@trueda-tribe-id/contracts';
export type { AuthTokenPair as TokenPair } from '@trueda-tribe-id/contracts';
import { createSessionToken, hashSessionToken, type SessionIdentity, type SessionRepository } from '../authentication/session.js';
export const enabledIdentity = `u.email_verified_at IS NOT NULL AND u.account_status='enabled' AND s.credential_version=u.credential_version AND (s.mfa_verified_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM tribe_memberships m WHERE m.user_id=u.id AND m.status='active' AND m.role IN ('administrator','owner')))`;
export class MobileSessionRepository implements SessionRepository {
    constructor(private readonly pool: Pool) {
    }
    async resolve(hash: string): Promise<SessionIdentity | null> {
        const result = await this.pool.query<SessionIdentity>(`SELECT s.id AS "sessionId",u.id AS "userId",u.email,s.mfa_verified_at AS "mfaVerifiedAt" FROM access_tokens a JOIN device_sessions s ON s.id=a.session_id JOIN users u ON u.id=s.user_id WHERE a.token_hash=$1 AND a.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp() AND s.revoked_at IS NULL AND ${enabledIdentity}`, [hash]);
        return result.rows[0] ?? null;
    }
    async revoke(id: string) {
        await this.pool.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE id=$1', [id]);
    }
    async devices(userId: string) {
        const result = await this.pool.query<AuthDeviceView>(`SELECT id,device_name AS "deviceName",to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt" FROM device_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 100`, [userId]);
        return result.rows;
    }
    async revokeDevice(userId: string, id: string) {
        await this.pool.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND user_id=$2', [id, userId]);
    }
    async revokeAll(userId: string) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
            await client.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [userId]);
            await client.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [userId]);
            await client.query('UPDATE auth_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL', [userId]);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    private async pair(client: PoolClient, id: string): Promise<TokenPair> {
        const accessToken = createSessionToken(), refreshToken = createSessionToken();
        await client.query('INSERT INTO access_tokens(token_hash,session_id) VALUES($1,$2)', [hashSessionToken(accessToken), id]);
        await client.query('INSERT INTO refresh_tokens(token_hash,session_id) VALUES($1,$2)', [hashSessionToken(refreshToken), id]);
        return { accessToken, refreshToken, expiresIn: 900 };
    }
    /** Caller holds the user's FOR UPDATE lock and checks credential version after password verification. */
    async issueLocked(client: PoolClient, userId: string, version: number, deviceName: string, mfa = false) {
        const result = await client.query<{
            id: string;
        }>(`INSERT INTO device_sessions(user_id,device_name,credential_version,mfa_verified_at) SELECT id,$2,credential_version,CASE WHEN $4 THEN clock_timestamp() END FROM users u WHERE id=$1 AND credential_version=$3 AND email_verified_at IS NOT NULL AND account_status='enabled' AND ($4 OR NOT EXISTS(SELECT 1 FROM tribe_memberships WHERE user_id=u.id AND status='active' AND role IN ('administrator','owner'))) RETURNING id`, [userId, deviceName, version, mfa]);
        if (!result.rows[0])
            throw new Error('Eligible authenticated identity required');
        return this.pair(client, result.rows[0].id);
    }
    // Internal fixture/integration capability; never exposed as a public user-ID credential contract.
    async issue(userId: string, deviceName: string): Promise<TokenPair> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const user = await client.query<{
                credential_version: number;
            }>('SELECT credential_version FROM users WHERE id=$1 FOR UPDATE', [userId]);
            if (!user.rows[0])
                throw new Error('Identity required');
            const pair = await this.issueLocked(client, userId, user.rows[0].credential_version, deviceName);
            await client.query('COMMIT');
            return pair;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async rotate(token: string, requestId='internal-rotation'): Promise<TokenPair | null> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // All credential mutations/issuance/rotation acquire user before session to avoid reset races/deadlocks.
            const owner = await client.query<{
                user_id: string;
            }>('SELECT s.user_id FROM refresh_tokens r JOIN device_sessions s ON s.id=r.session_id WHERE r.token_hash=$1', [hashSessionToken(token)]);
            if (owner.rows[0])
                await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner.rows[0].user_id]);
            const result = await client.query<{
                id: string;
                user_id: string;
                consumed: boolean;
                valid: boolean;
            }>(`SELECT s.id,s.user_id,r.consumed_at IS NOT NULL AS consumed,s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} AS valid FROM refresh_tokens r JOIN device_sessions s ON s.id=r.session_id JOIN users u ON u.id=s.user_id WHERE r.token_hash=$1 FOR UPDATE OF s,r`, [hashSessionToken(token)]);
            const row = result.rows[0];
            let pair: TokenPair | null = null;
            if (row?.consumed) {
                await client.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE id=$1', [row.id]);
                await client.query("INSERT INTO auth_security_events(user_id,action,outcome,request_id) VALUES($1,'refresh.replay','denied',$2)", [row.user_id,requestId]);
            }
            else if (row?.valid) {
                await client.query('UPDATE refresh_tokens SET consumed_at=clock_timestamp() WHERE token_hash=$1', [hashSessionToken(token)]);
                pair = await this.pair(client, row.id);
            }
            await client.query('COMMIT');
            return pair;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
