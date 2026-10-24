import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuthLoginResponse, MfaSetupResponse, MfaVerificationResponse, MfaChallenge, MembershipStatusResponse } from '@trueda-tribe-id/contracts';
import { createSessionToken, hashSessionToken, type SessionIdentity } from '../authentication/session.js';
import { MobileSessionRepository } from './repository.js';
import { Passwords, base32, matchTotp } from './crypto.js';
import { AdministratorVerification, AuthLimiter, AuthMail, audit, normalizeEmail, transaction, type AuthSettings, type MembershipVerificationProvider } from './support.js';
import { ServiceError } from '../../infrastructure/security/error.js';
interface User {
    id: string;
    email: string;
    password_hash: string;
    email_verified_at: Date | null;
    account_status: string;
    credential_version: number;
}
const denied = () => new ServiceError(401, 'AUTH_FAILED', 'Authentication could not be completed.');
const invalid = () => new ServiceError(400, 'TOKEN_INVALID', 'This request is invalid or has expired.');
export class IdentityService {
    readonly passwords: Passwords;
    readonly limiter: AuthLimiter;
    readonly mail: AuthMail;
    constructor(readonly pool: Pool, readonly sessions: MobileSessionRepository, settings: AuthSettings, private verification: MembershipVerificationProvider = new AdministratorVerification()) {
        this.passwords = new Passwords(settings.passwordBlocklist);
        this.limiter = new AuthLimiter(pool, settings.rateLimitKey);
        this.mail = new AuthMail(settings);
    }
    private async user(db: PoolClient, id: string) {
        return (await db.query<User>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    }
    private async privileged(db: PoolClient, id: string) {
        return Boolean((await db.query("SELECT 1 FROM tribe_memberships WHERE user_id=$1 AND status='active' AND role IN ('administrator','owner') LIMIT 1", [id])).rowCount);
    }
    private async authority(db: PoolClient, identity: SessionIdentity, tribeId: string, owner = false) {
        const user = await this.user(db, identity.userId);
        const session = await db.query("SELECT 1 FROM device_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND credential_version=$3 AND mfa_verified_at IS NOT NULL", [identity.sessionId, identity.userId, user?.credential_version ?? 0]);
        const role = (await db.query<{
            role: string;
        }>("SELECT role FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE", [identity.userId, tribeId])).rows[0]?.role;
        if (!user || user.account_status !== 'enabled' || !session.rowCount || !(owner ? role === 'owner' : role === 'owner' || role === 'administrator'))
            throw new ServiceError(403, 'AUTHORITY_REQUIRED', 'An authorized Tribe authority with MFA is required.');
        return user;
    }
    private async token(db: PoolClient, user: User, purpose: string, minutes: number, target: string | null = null) {
        const token = createSessionToken();
        await db.query('INSERT INTO account_tokens(user_id,purpose,token_hash,expires_at,credential_version,target_email) VALUES($1,$2,$3,clock_timestamp()+$4*interval \'1 minute\',$5,$6)', [user.id, purpose, hashSessionToken(token), minutes, user.credential_version, target]);
        return token;
    }
    private async revoke(db: PoolClient, id: string) {
        await db.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [id]);
        await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [id]);
        await db.query('UPDATE auth_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL', [id]);
    }
    async invite(identity: SessionIdentity, tribeId: string, emailInput: string, memberNumber: string, requestId: string) {
        this.mail.available();
        const email = normalizeEmail(emailInput);
        await this.limiter.take('invite', identity.userId, 10, 60, requestId);
        return transaction(this.pool, async (db) => {
            await this.authority(db, identity, tribeId);
            await db.query("UPDATE member_invitations SET revoked_at=clock_timestamp() WHERE tribe_id=$1 AND expires_at<=clock_timestamp() AND consumed_at IS NULL AND revoked_at IS NULL", [tribeId]);
            if ((await db.query('SELECT 1 FROM tribe_memberships m JOIN users u ON u.id=m.user_id WHERE m.tribe_id=$1 AND (m.member_number=$2 OR u.email=$3)', [tribeId, memberNumber, email])).rowCount)
                throw new ServiceError(409, 'MEMBERSHIP_EXISTS', 'Membership is already allocated.');
            const token = createSessionToken();
            const result = await db.query<{
                id: string;
            }>("INSERT INTO member_invitations(tribe_id,email,member_number,invited_by,token_hash) VALUES($1,$2,$3,$4,$5) RETURNING id", [tribeId, email, memberNumber, identity.userId, hashSessionToken(token)]);
            await this.mail.queue(db, email, 'Trueda Tribe ID invitation', `You have been invited to Trueda Tribe ID. Enter this invitation token in the app: ${token}\nExpires in seven days. Membership requires separate approval.`, 7 * 24 * 60);
            await audit(db, 'invitation.created', 'success', requestId, identity.userId, tribeId);
            return { invitationId: result.rows[0]!.id };
        });
    }
    async revokeInvitation(identity: SessionIdentity, tribeId: string, id: string, requestId: string) {
        await transaction(this.pool, async (db) => {
            await this.authority(db, identity, tribeId);
            await db.query('UPDATE member_invitations SET revoked_at=clock_timestamp() WHERE id=$1 AND tribe_id=$2 AND consumed_at IS NULL', [id, tribeId]);
            await audit(db, 'invitation.revoked', 'success', requestId, identity.userId, tribeId);
        });
    }
    async enroll(token: string, password: string, displayName: string, requestId: string) {
        this.mail.available();
        if (!(await this.pool.query('SELECT 1 FROM member_invitations WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()', [hashSessionToken(token)])).rowCount)
            throw invalid();
        this.passwords.validate(password);
        const hash = await this.passwords.hash(password);
        return transaction(this.pool, async (db) => {
            const invitation = (await db.query<{
                id: string;
                tribe_id: string;
                email: string;
                member_number: string;
            }>('SELECT * FROM member_invitations WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE', [hashSessionToken(token)])).rows[0];
            if (!invitation)
                throw invalid();
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['enroll:' + invitation.email]);
            if ((await db.query('SELECT 1 FROM users WHERE email=$1', [invitation.email])).rowCount)
                throw new ServiceError(409, 'EXISTING_ACCOUNT', 'Sign in to accept this invitation with your existing account.');
            const user = (await db.query<User>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING *', [invitation.email, hash])).rows[0]!;
            await this.link(db, invitation, user.id, displayName);
            const verify = await this.token(db, user, 'verify_email', 60);
            await this.mail.queue(db, user.email, 'Verify your Trueda Tribe ID email', `Enter this email verification token in the app: ${verify}\nExpires in one hour. This does not activate Tribe membership.`, 60);
            await audit(db, 'account.enrolled', 'success', requestId, user.id, invitation.tribe_id);
        });
    }
    private async link(db: PoolClient, invitation: {
        id: string;
        tribe_id: string;
        member_number: string;
    }, userId: string, displayName: string) {
        const member = await db.query<{
            id: string;
        }>("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role) VALUES($1,$2,$3,'pending','member') RETURNING id", [invitation.tribe_id, userId, invitation.member_number]);
        await db.query('INSERT INTO profiles(membership_id,tribe_id,display_name) VALUES($1,$2,$3)', [member.rows[0]!.id, invitation.tribe_id, displayName]);
        await db.query('UPDATE member_invitations SET consumed_at=clock_timestamp() WHERE id=$1', [invitation.id]);
    }
    async acceptExisting(identity: SessionIdentity, token: string, displayName: string, requestId: string) {
        await transaction(this.pool, async (db) => {
            const user = await this.user(db, identity.userId);
            if (!user || user.account_status !== 'enabled' || !user.email_verified_at)
                throw denied();
            const invitation = (await db.query<{
                id: string;
                tribe_id: string;
                member_number: string;
                email: string;
            }>('SELECT * FROM member_invitations WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE', [hashSessionToken(token)])).rows[0];
            if (!invitation || invitation.email !== user.email)
                throw invalid();
            await this.link(db, invitation, user.id, displayName);
            await audit(db, 'invitation.accepted', 'success', requestId, user.id, invitation.tribe_id);
        });
    }
    async requestToken(emailInput: string, purpose: 'verify_email' | 'reset_password', requestId: string) {
        this.mail.available();
        const email = normalizeEmail(emailInput);
        await this.limiter.take('email:' + purpose, email, 3, 3600, requestId);
        await transaction(this.pool, async (db) => {
            const user = (await db.query<User>('SELECT * FROM users WHERE email=$1 FOR UPDATE', [email])).rows[0];
            if (user?.account_status === 'enabled' && (purpose === 'reset_password' || !user.email_verified_at)) {
                await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [user.id, purpose]);
                const token = await this.token(db, user, purpose, purpose === 'reset_password' ? 30 : 60);
                await this.mail.queue(db, email, purpose === 'reset_password' ? 'Reset your Trueda Tribe ID password' : 'Verify your Trueda Tribe ID email', `Enter this ${purpose === 'reset_password' ? 'password reset' : 'email verification'} token in the app: ${token}`, purpose === 'reset_password' ? 30 : 60);
            }
            await audit(db, purpose + '.requested', 'success', requestId, null, null, this.limiter.subject(email));
        });
    }
    private async consume(db: PoolClient, token: string, purpose: string) {
        const preview = (await db.query<{
            user_id: string;
        }>('SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose=$2', [hashSessionToken(token), purpose])).rows[0];
        if (!preview)
            throw invalid();
        const user = await this.user(db, preview.user_id);
        const record = (await db.query<{
            id: string;
            target_email: string | null;
            credential_version: number;
        }>('SELECT * FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE', [hashSessionToken(token), purpose])).rows[0];
        if (!user || user.account_status !== 'enabled' || !record || record.credential_version !== user.credential_version)
            throw invalid();
        await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE id=$1', [record.id]);
        return { user, record };
    }
    async verifyEmail(token: string, requestId: string) {
        await transaction(this.pool, async (db) => {
            const { user } = await this.consume(db, token, 'verify_email');
            await db.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1', [user.id]);
            await db.query("UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND purpose='verify_email' AND consumed_at IS NULL", [user.id]);
            await audit(db, 'email.verified', 'success', requestId, user.id);
        });
    }
    async login(emailInput: string, password: string, deviceName: string, requestId: string): Promise<AuthLoginResponse> {
        const email = normalizeEmail(emailInput);
        await this.limiter.take('login', email, 5, 900, requestId);
        const snapshot = (await this.pool.query<User>('SELECT * FROM users WHERE email=$1', [email])).rows[0];
        const valid = await this.passwords.verify(snapshot?.password_hash, password);
        if (!valid || !snapshot) {
            await audit(this.pool, 'login', 'denied', requestId, snapshot?.id ?? null, null, this.limiter.subject(email));
            throw denied();
        }
        return transaction(this.pool, async (db) => {
            const user = await this.user(db, snapshot.id);
            if (!user || user.credential_version !== snapshot.credential_version || user.password_hash !== snapshot.password_hash || user.account_status !== 'enabled' || !user.email_verified_at) {
                await audit(db, 'login', 'denied', requestId, user?.id ?? null);
                return null;
            }
            if (await this.privileged(db, user.id) || (await db.query('SELECT 1 FROM user_mfa WHERE user_id=$1', [user.id])).rowCount) {
                const challengeToken = createSessionToken();
                await db.query('INSERT INTO auth_challenges(token_hash,user_id,credential_version,device_name) VALUES($1,$2,$3,$4)', [hashSessionToken(challengeToken), user.id, user.credential_version, deviceName]);
                const enrolled = Boolean((await db.query('SELECT 1 FROM user_mfa WHERE user_id=$1', [user.id])).rowCount);
                await audit(db, 'login.mfa_challenge', 'success', requestId, user.id);
                return { challengeToken, enrollmentRequired: !enrolled };
            }
            const pair = await this.sessions.issueLocked(db, user.id, user.credential_version, deviceName);
            await audit(db, 'login', 'success', requestId, user.id);
            return pair;
        }).then(result => {
            if (!result)
                throw denied();
            return result;
        });
    }
    async resetPassword(token: string, password: string, requestId: string) {
        if (!(await this.pool.query("SELECT 1 FROM account_tokens WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>clock_timestamp()", [hashSessionToken(token)])).rowCount)
            throw invalid();
        this.passwords.validate(password);
        const hash = await this.passwords.hash(password);
        await transaction(this.pool, async (db) => {
            const { user } = await this.consume(db, token, 'reset_password');
            await db.query('UPDATE users SET password_hash=$2,password_changed_at=clock_timestamp(),credential_version=credential_version+1 WHERE id=$1', [user.id, hash]);
            await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL', [user.id]);
            await this.revoke(db, user.id);
            await this.mail.queue(db, user.email, 'Trueda Tribe ID password changed', 'Your password was changed and all sessions were revoked. Contact your Tribe authority if this was not you.', 60);
            await audit(db, 'password.reset', 'success', requestId, user.id);
        });
    }
    async changePassword(identity: SessionIdentity, currentPassword: string, newPassword: string, requestId: string) {
        this.passwords.validate(newPassword);
        const snapshot = (await this.pool.query<User>('SELECT * FROM users WHERE id=$1', [identity.userId])).rows[0];
        if (!await this.passwords.verify(snapshot?.password_hash, currentPassword))
            throw denied();
        const hash = await this.passwords.hash(newPassword);
        await transaction(this.pool, async (db) => {
            const user = await this.user(db, identity.userId);
            if (!user || user.credential_version !== snapshot?.credential_version || user.account_status !== 'enabled')
                throw denied();
            await db.query('UPDATE users SET password_hash=$2,password_changed_at=clock_timestamp(),credential_version=credential_version+1 WHERE id=$1', [user.id, hash]);
            await this.revoke(db, user.id);
            await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL', [user.id]);
            await audit(db, 'password.changed', 'success', requestId, user.id);
        });
    }
    async requestEmailChange(identity: SessionIdentity, password: string, emailInput: string, requestId: string) {
        this.mail.available();
        const email = normalizeEmail(emailInput);
        await this.limiter.take('email.change', identity.userId, 3, 3600, requestId);
        const snapshot = (await this.pool.query<User>('SELECT * FROM users WHERE id=$1', [identity.userId])).rows[0];
        if (!await this.passwords.verify(snapshot?.password_hash, password))
            throw denied();
        await transaction(this.pool, async (db) => {
            const user = await this.user(db, identity.userId);
            if (!user || user.credential_version !== snapshot?.credential_version || user.account_status !== 'enabled')
                throw denied();
            await db.query("UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND purpose='change_email' AND consumed_at IS NULL", [user.id]);
            const token = await this.token(db, user, 'change_email', 30, email);
            await this.mail.queue(db, email, 'Verify your new Trueda Tribe ID email', `Enter this email change token: ${token}`, 30);
            await this.mail.queue(db, user.email, 'Trueda Tribe ID email change requested', 'A change of your sign-in email was requested. Your verified email has not changed yet.', 60);
            await audit(db, 'email.change_requested', 'success', requestId, user.id);
        });
    }
    async confirmEmailChange(token: string, requestId: string) {
        await transaction(this.pool, async (db) => {
            const { user, record } = await this.consume(db, token, 'change_email');
            if (!record.target_email)
                throw invalid();
            await db.query('UPDATE users SET email=$2,email_verified_at=clock_timestamp(),credential_version=credential_version+1 WHERE id=$1', [user.id, record.target_email]);
            await this.revoke(db, user.id);
            await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1 AND consumed_at IS NULL', [user.id]);
            await this.mail.queue(db, user.email, 'Trueda Tribe ID email changed', 'Your sign-in email changed and all sessions were revoked. Contact your Tribe authority if this was not you.', 60);
            await audit(db, 'email.changed', 'success', requestId, user.id);
        });
    }
    async activate(identity: SessionIdentity, tribeId: string, membershipId: string, evidenceReference: string, requestId: string) {
        await transaction(this.pool, async (db) => {
            await db.query('SELECT id FROM users WHERE id=$1 OR id=(SELECT user_id FROM tribe_memberships WHERE id=$2 AND tribe_id=$3) ORDER BY id FOR UPDATE', [identity.userId, membershipId, tribeId]);
            await this.authority(db, identity, tribeId);
            const target = (await db.query<{
                user_id: string;
                role: string;
            }>('SELECT user_id,role FROM tribe_memberships WHERE id=$1 AND tribe_id=$2', [membershipId, tribeId])).rows[0];
            if (!target)
                throw new ServiceError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
            if (target.role !== 'member')
                await this.authority(db, identity, tribeId, true);
            const user = await this.user(db, target.user_id);
            if (!user?.email_verified_at || user.account_status !== 'enabled')
                throw new ServiceError(409, 'VERIFICATION_REQUIRED', 'A verified enabled account is required.');
            const record = await this.verification.verify({ tribeId, membershipId, authority: identity, evidenceReference });
            const updated = await db.query("UPDATE tribe_memberships SET status='active',joined_at=COALESCE(joined_at,clock_timestamp()) WHERE id=$1 AND tribe_id=$2 AND status='pending'", [membershipId, tribeId]);
            if (!updated.rowCount)
                throw new ServiceError(409, 'TRANSITION_INVALID', 'Only pending memberships can be activated.');
            await db.query('INSERT INTO membership_verifications(membership_id,verified_by,provider,evidence_reference) VALUES($1,$2,$3,$4)', [membershipId, identity.userId, record.provider, record.reference]);
            await db.query("INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status,evidence_reference) VALUES($1,$2,$3,'approved','active',$4)", [membershipId,tribeId,identity.userId,record.reference]);
            await audit(db, 'membership.activated', 'success', requestId, identity.userId, tribeId);
        });
    }
    async setRole(identity: SessionIdentity, tribeId: string, membershipId: string, role: 'member' | 'administrator' | 'owner', requestId: string) {
        await transaction(this.pool, async (db) => {
            await db.query('SELECT id FROM users WHERE id=$1 OR id=(SELECT user_id FROM tribe_memberships WHERE id=$2 AND tribe_id=$3) ORDER BY id FOR UPDATE', [identity.userId, membershipId, tribeId]);
            await this.authority(db, identity, tribeId, true);
            const target = (await db.query<{
                user_id: string;
                role: string;
            }>('SELECT user_id,role FROM tribe_memberships WHERE id=$1 AND tribe_id=$2 AND status=\'active\'', [membershipId, tribeId])).rows[0];
            if (!target)
                throw new ServiceError(404, 'MEMBERSHIP_NOT_FOUND', 'Active membership not found.');
            if (target.role === 'owner' && role !== 'owner')
                throw new ServiceError(409, 'OWNER_TRANSFER_REQUIRED', 'Owner removal requires a controlled ownership transfer.');
            await this.user(db, target.user_id);
            await db.query('UPDATE tribe_memberships SET role=$2 WHERE id=$1', [membershipId, role]);
            await this.revoke(db, target.user_id);
            await audit(db, 'membership.role_changed', 'success', requestId, identity.userId, tribeId);
        });
    }
    async membershipStatus(identity: SessionIdentity): Promise<MembershipStatusResponse> {
        return { memberships: (await this.pool.query<MembershipStatusResponse['memberships'][number]>('SELECT m.id,m.tribe_id AS "tribeId",t.name AS "tribeName",m.status FROM tribe_memberships m JOIN tribes t ON t.id=m.tribe_id WHERE m.user_id=$1 ORDER BY m.created_at LIMIT 100', [identity.userId])).rows };
    }
    private async challenge(db: PoolClient, token: string) {
        const preview = (await db.query<{
            user_id: string;
        }>('SELECT user_id FROM auth_challenges WHERE token_hash=$1', [hashSessionToken(token)])).rows[0];
        if (!preview)
            return null;
        const user = await this.user(db, preview.user_id);
        const challenge = (await db.query<{
            token_hash: string;
            credential_version: number;
            device_name: string;
            setup_ciphertext: string | null;
        }>('SELECT * FROM auth_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND attempts<5 FOR UPDATE', [hashSessionToken(token)])).rows[0];
        if (!user || !user.email_verified_at || user.account_status !== 'enabled' || !challenge || challenge.credential_version !== user.credential_version)
            return null;
        return { user, challenge };
    }
    async setupMfa(token: string, requestId: string): Promise<MfaSetupResponse> {
        return transaction(this.pool, async (db) => {
            const state = await this.challenge(db, token);
            if (!state || (await db.query('SELECT 1 FROM user_mfa WHERE user_id=$1', [state.user.id])).rowCount)
                throw denied();
            const seed = state.challenge.setup_ciphertext ? this.mail.box.open(state.challenge.setup_ciphertext, `mfa-setup:${state.user.id}`) : randomBytes(20).toString('base64');
            await db.query('UPDATE auth_challenges SET setup_ciphertext=$2 WHERE token_hash=$1', [hashSessionToken(token), this.mail.box.seal(seed, `mfa-setup:${state.user.id}`)]);
            await audit(db, 'mfa.setup_started', 'success', requestId, state.user.id);
            const secret = base32(Buffer.from(seed, 'base64'));
            return { secret, otpAuthUrl: `otpauth://totp/${encodeURIComponent('Trueda Tribe ID:' + state.user.email)}?secret=${secret}&issuer=Trueda%20Tribe%20ID&algorithm=SHA1&digits=6&period=30` };
        });
    }
    async verifyMfa(token: string, code: string, requestId: string): Promise<MfaVerificationResponse> {
        const result = await transaction(this.pool, async (db) => {
            const state = await this.challenge(db, token);
            if (!state)
                return null;
            const { user, challenge } = state;
            await db.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=$1', [hashSessionToken(token)]);
            const factor = (await db.query<{
                secret_ciphertext: string;
                last_step: string;
            }>('SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE', [user.id])).rows[0];
            const encrypted = factor?.secret_ciphertext ?? challenge.setup_ciphertext;
            if (!encrypted)
                return null;
            const seed = this.mail.box.open(encrypted, factor ? `mfa:${user.id}` : `mfa-setup:${user.id}`);
            const step = matchTotp(Buffer.from(seed, 'base64'), code, Number(factor?.last_step ?? -1));
            if (step === null) {
                await audit(db, 'mfa.verify', 'denied', requestId, user.id);
                return null;
            }
            let recoveryCodes: string[] | undefined;
            if (!factor) {
                await db.query('INSERT INTO user_mfa(user_id,secret_ciphertext,last_step) VALUES($1,$2,$3)', [user.id, this.mail.box.seal(seed, `mfa:${user.id}`), step]);
                recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
                for (const recovery of recoveryCodes)
                    await db.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)', [user.id, hashSessionToken(recovery)]);
                await audit(db, 'mfa.enrolled', 'success', requestId, user.id);
            }
            else
                await db.query('UPDATE user_mfa SET last_step=$2 WHERE user_id=$1', [user.id, step]);
            await db.query('UPDATE auth_challenges SET consumed_at=clock_timestamp(),setup_ciphertext=NULL WHERE token_hash=$1', [hashSessionToken(token)]);
            const pair = await this.sessions.issueLocked(db, user.id, user.credential_version, challenge.device_name, true);
            await audit(db, 'login.mfa', 'success', requestId, user.id);
            return { ...pair, ...(recoveryCodes ? { recoveryCodes } : {}) };
        });
        if (!result)
            throw denied();
        return result;
    }
    async recoverMfa(token: string, recoveryCode: string, requestId: string): Promise<MfaChallenge> {
        const result = await transaction(this.pool, async (db) => {
            const state = await this.challenge(db, token);
            if (!state)
                return null;
            await db.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=$1', [hashSessionToken(token)]);
            const used = await db.query('UPDATE mfa_recovery_codes SET consumed_at=clock_timestamp() WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL RETURNING user_id', [state.user.id, hashSessionToken(recoveryCode)]);
            if (!used.rowCount) {
                await audit(db, 'mfa.recovery', 'denied', requestId, state.user.id);
                return null;
            }
            await this.revoke(db, state.user.id);
            await db.query('DELETE FROM user_mfa WHERE user_id=$1', [state.user.id]);
            await db.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1', [state.user.id]);
            const challengeToken = createSessionToken();
            await db.query('INSERT INTO auth_challenges(token_hash,user_id,credential_version,device_name) VALUES($1,$2,$3,$4)', [hashSessionToken(challengeToken), state.user.id, state.user.credential_version + 1, state.challenge.device_name]);
            await this.mail.queue(db, state.user.email, 'Trueda Tribe ID authenticator recovery', 'Your authenticator was recovered. Existing sessions were revoked and a new factor must be enrolled.', 60);
            await audit(db, 'mfa.recovery', 'success', requestId, state.user.id);
            return { challengeToken, enrollmentRequired: true };
        });
        if (!result)
            throw denied();
        return result;
    }
    async setMembershipState(identity: SessionIdentity, tribeId: string, membershipId: string, status: 'suspended' | 'revoked' | 'pending', requestId: string) {
        await transaction(this.pool, async (db) => {
            await db.query('SELECT id FROM users WHERE id=$1 OR id=(SELECT user_id FROM tribe_memberships WHERE id=$2 AND tribe_id=$3) ORDER BY id FOR UPDATE', [identity.userId, membershipId, tribeId]);
            await this.authority(db, identity, tribeId);
            const target = (await db.query<{
                user_id: string;
                role: string;
            }>('SELECT user_id,role FROM tribe_memberships WHERE id=$1 AND tribe_id=$2', [membershipId, tribeId])).rows[0];
            if (!target)
                throw new ServiceError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
            if (target.role !== 'member')
                await this.authority(db, identity, tribeId, true);
            if (target.role === 'owner')
                throw new ServiceError(409, 'OWNER_TRANSFER_REQUIRED', 'Owner removal requires controlled ownership transfer.');
            await db.query("UPDATE tribe_memberships SET status=$2,exited_at=CASE WHEN $2='revoked' THEN COALESCE(exited_at,clock_timestamp()) ELSE NULL END WHERE id=$1", [membershipId, status]);
            await db.query("INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status) VALUES($1,$2,$3,'state_changed',$4)", [membershipId,tribeId,identity.userId,status]);
            await db.query('DELETE FROM membership_verifications WHERE membership_id=$1', [membershipId]);
            await audit(db, 'membership.' + status, 'success', requestId, identity.userId, tribeId);
        });
    }
    async bootstrap(tribeId: string, emailInput: string, password: string, memberNumber: string, reference: string) {
        this.mail.available();
        this.passwords.validate(password);
        const hash = await this.passwords.hash(password);
        return transaction(this.pool, async (db) => {
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['bootstrap:' + tribeId]);
            if ((await db.query("SELECT 1 FROM tribe_memberships WHERE tribe_id=$1 AND role='owner'", [tribeId])).rowCount)
                throw new Error('An owner already exists; bootstrap is closed');
            const user = (await db.query<User>('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING *', [normalizeEmail(emailInput), hash])).rows[0]!;
            const membership = (await db.query<{
                id: string;
            }>("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role,joined_at) VALUES($1,$2,$3,'active','owner',clock_timestamp()) RETURNING id", [tribeId, user.id, memberNumber])).rows[0]!;
            await db.query("INSERT INTO membership_verifications(membership_id,verified_by,provider,evidence_reference) VALUES($1,$2,'administrator',$3)", [membership.id, user.id, reference]);
            await db.query("INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status,evidence_reference) VALUES($1,$2,$3,'approved','active',$4)", [membership.id,tribeId,user.id,reference]);
            const token = await this.token(db, user, 'verify_email', 60);
            await this.mail.queue(db, user.email, 'Verify your initial-owner email', `Enter this verification token: ${token}. Administrator access also requires authenticator enrollment.`, 60);
            await audit(db, 'owner.bootstrap', 'success', 'controlled-bootstrap', user.id, tribeId);
            return { userId: user.id };
        });
    }
}
