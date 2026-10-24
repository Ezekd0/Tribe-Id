import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { IdentityService } from '../apps/api/src/modules/auth/identity-service.js';
import { MobileSessionRepository } from '../apps/api/src/modules/auth/repository.js';
import { hashSessionToken, createSessionToken, type SessionIdentity } from '../apps/api/src/modules/authentication/session.js';
import { SecretBox, totp } from '../apps/api/src/modules/auth/crypto.js';
import { transaction } from '../apps/api/src/modules/auth/support.js';
if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true')
    throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const settings = { encryptionKey: randomBytes(32).toString('base64'), rateLimitKey: randomBytes(32).toString('base64'), mailFrom: 'test@example.invalid', smtpUrl: 'smtps://mail.example.invalid' };
const env = readEnvironment({ NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL });
env.auth = settings;
const app = await buildApp(env), other = await buildApp(env), sessions = new MobileSessionRepository(pool), service = new IdentityService(pool, sessions, settings), box = new SecretBox(settings.encryptionKey);
const suffix = randomUUID(), password = 'A strong test phrase ' + suffix;
const tribe = (await pool.query<{
    id: string;
}>('INSERT INTO tribes(name,slug) VALUES($1,$2) RETURNING id', ['Authentication test', suffix])).rows[0]!.id;
let checks = 0;
const pass = (label: string) => {
    checks++;
    console.log('PASS ' + label);
};
async function post(path: string, body: Record<string, string>, bearer?: string, instance = app) {
    return instance.inject({ method: 'POST', url: '/api/v1/' + path, payload: body, headers: bearer ? { authorization: 'Bearer ' + bearer } : {} });
}
async function messageToken(email: string, subject: string) {
    const rows = (await pool.query<{
        payload_ciphertext: string;
    }>('SELECT payload_ciphertext FROM auth_outbox WHERE payload_ciphertext IS NOT NULL ORDER BY created_at DESC')).rows;
    for (const row of rows) {
        const message = JSON.parse(box.open(row.payload_ciphertext, 'auth-mail')) as {
            to: string;
            subject: string;
            text: string;
        };
        if (message.to === email && message.subject === subject)
            return message.text.match(/[A-Za-z0-9_-]{43}/)![0];
    }
    throw new Error('Test message missing');
}
async function identity(accessToken: string) {
    const found = await sessions.resolve(hashSessionToken(accessToken));
    assert.ok(found);
    return found;
}
async function factor(challengeToken: string, seed?: Buffer) {
    if (!seed) {
        assert.equal((await post('auth/mfa/setup', { challengeToken })).statusCode, 200);
        const row = (await pool.query<{
            setup_ciphertext: string;
            user_id: string;
        }>('SELECT setup_ciphertext,user_id FROM auth_challenges WHERE token_hash=$1', [hashSessionToken(challengeToken)])).rows[0]!;
        seed = Buffer.from(box.open(row.setup_ciphertext, 'mfa-setup:' + row.user_id), 'base64');
    }
    const code = totp(seed, Math.floor(Date.now() / 30000));
    const response = await post('auth/mfa/verify', { challengeToken, code });
    assert.equal(response.statusCode, 200, response.body);
    return { seed, pair: response.json() as {
            accessToken: string;
            refreshToken: string;
            recoveryCodes?: string[];
        } };
}
try {
    const ownerEmail = 'owner-' + suffix + '@example.invalid';
    await service.bootstrap(tribe, ownerEmail, password, 'OWNER-' + suffix, 'Test deployment approval');
    await assert.rejects(service.bootstrap(tribe, 'other-' + suffix + '@example.invalid', password, 'OTHER', 'Test'), /owner already exists/);
    pass('controlled bootstrap closes after initial owner');
    assert.equal((await post('auth/login', { email: ownerEmail, password, deviceName: 'Owner test' })).statusCode, 401);
    const verifyOwner = await messageToken(ownerEmail, 'Verify your initial-owner email');
    assert.equal((await post('auth/verification/confirm', { token: verifyOwner })).statusCode, 204);
    assert.equal((await post('auth/verification/confirm', { token: verifyOwner })).statusCode, 400);
    pass('email verification required and single-use');
    const ownerLogin = await post('auth/login', { email: ownerEmail, password, deviceName: 'Owner test' });
    assert.equal(ownerLogin.statusCode, 200);
    assert.equal(ownerLogin.json().enrollmentRequired, true);
    assert.equal(ownerLogin.json().accessToken, undefined);
    const ownerFactor = await factor(ownerLogin.json().challengeToken);
    const owner = await identity(ownerFactor.pair.accessToken);
    assert.equal(ownerFactor.pair.recoveryCodes!.length, 10);
    assert.equal((await post('auth/mfa/verify', { challengeToken: ownerLogin.json().challengeToken, code: totp(ownerFactor.seed, Math.floor(Date.now() / 30000)) })).statusCode, 401);
    pass('admin requires enrolled MFA; challenge and code cannot replay');
    const email = 'member-' + suffix + '@example.invalid';
    const invitation = await post(`tribes/${tribe}/invitations`, { email, memberNumber: 'MEMBER-' + suffix }, ownerFactor.pair.accessToken);
    assert.equal(invitation.statusCode, 200, invitation.body);
    const invitationToken = await messageToken(email, 'Trueda Tribe ID invitation');
    const enroll = await post('auth/enroll', { invitationToken, password, displayName: 'Test member' });
    assert.equal(enroll.statusCode, 204, enroll.body);
    assert.equal((await post('auth/enroll', { invitationToken, password, displayName: 'Example Test Identity 1' })).statusCode, 400);
    pass('authorized invitation, account creation, single-use invitation');
    const member = (await pool.query<{
        id: string;
        status: string;
        role: string;
    }>('SELECT m.id,m.status,m.role FROM tribe_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1', [email])).rows[0]!;
    assert.equal(member.status, 'pending');
    assert.equal(member.role, 'member');
    const unverifiedActivation = await post(`tribes/${tribe}/memberships/${member.id}/activate`, { evidenceReference: 'Reviewed enrollment' }, ownerFactor.pair.accessToken);
    assert.equal(unverifiedActivation.statusCode, 409);
    const verificationToken = await messageToken(email, 'Verify your Trueda Tribe ID email');
    assert.equal((await post('auth/verification/confirm', { token: verificationToken })).statusCode, 204);
    pass('email verification does not activate membership');
    const wrong = await post('auth/login', { email, password: 'Wrong password', deviceName: 'Member test' });
    assert.equal(wrong.statusCode, 401);
    const unknown = await post('auth/login', { email: 'unknown-' + suffix + '@example.invalid', password, deviceName: 'Member test' });
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrong.json().error.message, unknown.json().error.message);
    pass('wrong and unknown credentials return generic failure');
    const login = await post('auth/login', { email, password, deviceName: 'Member test' });
    assert.equal(login.statusCode, 200, login.body);
    const pair = login.json() as {
        accessToken: string;
        refreshToken: string;
    };
    const memberIdentity = await identity(pair.accessToken);
    assert.equal((await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer ' + pair.accessToken } })).json().memberships.length, 0);
    assert.equal((await app.inject({ url: `/api/v1/tribes/${tribe}/hub`, headers: { authorization: 'Bearer ' + pair.accessToken } })).statusCode, 404);
    assert.equal((await post(`tribes/${tribe}/invitations`, { email: 'forbidden@example.invalid', memberNumber: 'NO' }, pair.accessToken)).statusCode, 403);
    pass('verified identity without active membership; member cannot invite');
    const badScope = await post(`tribes/${randomUUID()}/memberships/${member.id}/activate`, { evidenceReference: 'Wrong Tribe' }, ownerFactor.pair.accessToken);
    assert.equal(badScope.statusCode, 403);
    assert.equal((await post(`tribes/${tribe}/memberships/${member.id}/activate`, { evidenceReference: 'Administrator reviewed authoritative records' }, ownerFactor.pair.accessToken)).statusCode, 204);
    assert.equal((await app.inject({ url: `/api/v1/tribes/${tribe}/hub`, headers: { authorization: 'Bearer ' + pair.accessToken } })).statusCode, 200);
    pass('scoped administrator activation and real member API integration');
    const expiredEmail = 'expired-' + suffix + '@example.invalid';
    const expiredInvitation = await post(`tribes/${tribe}/invitations`, { email: expiredEmail, memberNumber: 'EXP-' + suffix }, ownerFactor.pair.accessToken);
    await pool.query("UPDATE member_invitations SET expires_at=created_at+interval '1 microsecond' WHERE id=$1", [expiredInvitation.json().invitationId]);
    assert.equal((await post('auth/enroll', { invitationToken: await messageToken(expiredEmail, 'Trueda Tribe ID invitation'), password, displayName: 'Example Test Identity 2' })).statusCode, 400);
    pass('expired invitation rejected');
    const two = await sessions.issue(memberIdentity.userId, 'Second device');
    const devices = await app.inject({ url: '/api/v1/auth/devices', headers: { authorization: 'Bearer ' + pair.accessToken } });
    assert.equal(devices.statusCode, 200);
    assert.equal(devices.json().devices.length, 2);
    const secondIdentity = await identity(two.accessToken);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/auth/devices/' + owner.sessionId, headers: { authorization: 'Bearer ' + pair.accessToken } })).statusCode, 204);
    assert.ok(await sessions.resolve(hashSessionToken(ownerFactor.pair.accessToken)));
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/auth/devices/' + secondIdentity.sessionId, headers: { authorization: 'Bearer ' + pair.accessToken } })).statusCode, 204);
    assert.equal(await sessions.resolve(hashSessionToken(two.accessToken)), null);
    pass('device listing and ownership-bound revocation');
    const rotated = await post('auth/refresh', { refreshToken: pair.refreshToken }, undefined, other);
    assert.equal(rotated.statusCode, 200);
    assert.equal((await post('auth/refresh', { refreshToken: pair.refreshToken })).statusCode, 401);
    assert.equal(await sessions.resolve(hashSessionToken(rotated.json().accessToken)), null);
    pass('cross-instance refresh rotation and replay family revocation');
    const logoutPair = await sessions.issue(memberIdentity.userId, 'Logout');
    assert.equal((await post('auth/logout', {}, logoutPair.accessToken)).statusCode, 204);
    assert.equal(await sessions.rotate(logoutPair.refreshToken), null);
    const allA = await sessions.issue(memberIdentity.userId, 'All A'), allB = await sessions.issue(memberIdentity.userId, 'All B');
    assert.equal((await post('auth/logout-all', {}, allA.accessToken)).statusCode, 204);
    assert.equal(await sessions.rotate(allB.refreshToken), null);
    pass('logout current and logout-all revoke families');
    await post('auth/recovery/request', { email });
    const reset = await messageToken(email, 'Reset your Trueda Tribe ID password');
    const beforeReset = await sessions.issue(memberIdentity.userId, 'Before reset');
    const newPassword = password + ' changed';
    assert.equal((await post('auth/recovery/confirm', { token: reset, newPassword })).statusCode, 204);
    assert.equal(await sessions.resolve(hashSessionToken(beforeReset.accessToken)), null);
    assert.equal(await sessions.rotate(beforeReset.refreshToken), null);
    assert.equal((await post('auth/recovery/confirm', { token: reset, newPassword })).statusCode, 400);
    pass('single-use password recovery invalidates access, refresh and other reset tokens');
    await pool.query("DELETE FROM request_limits WHERE key=$1", [service.limiter.subject('login:' + email)]);
    assert.equal((await post('auth/login', { email, password, deviceName: 'Old credential' })).statusCode, 401);
    const newLogin = await post('auth/login', { email, password: newPassword, deviceName: 'New credential' });
    assert.equal(newLogin.statusCode, 200);
    // Pause a real password verification across a concurrent reset; old verification cannot issue afterward.
    await service.requestToken(email, 'reset_password', 'race-reset');
    const raceToken = await messageToken(email, 'Reset your Trueda Tribe ID password');
    let verified!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => verified = resolve), gate = new Promise<void>(resolve => release = resolve);
    const racing = new IdentityService(pool, sessions, settings);
    const original = racing.passwords.verify.bind(racing.passwords);
    racing.passwords.verify = async (hash, value) => {
        const valid = await original(hash, value);
        verified();
        await gate;
        return valid;
    };
    const lateLogin = racing.login(email, newPassword, 'Race device', 'race-login');
    await ready;
    await service.resetPassword(raceToken, newPassword + ' again', 'race-reset-confirm');
    release();
    await assert.rejects(lateLogin);
    pass('password reset wins against already-verified stale password issuance');
    const disablePair = await sessions.issue(memberIdentity.userId, 'Disable test');
    await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1", [memberIdentity.userId]);
    assert.equal(await sessions.resolve(hashSessionToken(disablePair.accessToken)), null);
    assert.equal(await sessions.rotate(disablePair.refreshToken), null);
    await pool.query("DELETE FROM request_limits WHERE key=$1", [service.limiter.subject('login:' + email)]);
    assert.equal((await post('auth/login', { email, password: newPassword + ' again', deviceName: 'Disabled' })).statusCode, 401);
    await pool.query("UPDATE users SET account_status='enabled' WHERE id=$1", [memberIdentity.userId]);
    pass('disabled accounts rejected by login, access and refresh');
    const active = await sessions.issue(memberIdentity.userId, 'Inactive test');
    assert.equal((await post(`tribes/${tribe}/memberships/${member.id}/status`, { status: 'suspended' }, ownerFactor.pair.accessToken)).statusCode, 204);
    assert.equal((await app.inject({ url: `/api/v1/tribes/${tribe}/hub`, headers: { authorization: 'Bearer ' + active.accessToken } })).statusCode, 404);
    pass('suspended membership immediately loses Tribe access');
    const limitEmail = 'rate-' + suffix + '@example.invalid';
    for (let i = 0; i < 5; i++)
        assert.equal((await post('auth/login', { email: limitEmail, password: 'Wrong password', deviceName: 'Rate test' })).statusCode, 401);
    assert.equal((await post('auth/login', { email: limitEmail, password: 'Wrong password', deviceName: 'Rate test' })).statusCode, 429);
    pass('shared account-scoped rate limit');
    // Reset IP counter to isolate later security checks from admission caps.
    await pool.query('DELETE FROM request_limits');
    await pool.query('UPDATE user_mfa SET last_step=-1 WHERE user_id=$1', [owner.userId]);
    const again = await post('auth/login', { email: ownerEmail, password, deviceName: 'Owner MFA recovery' });
    const challenge = again.json().challengeToken as string;
    const recovered = await post('auth/mfa/recover', { challengeToken: challenge, recoveryCode: ownerFactor.pair.recoveryCodes![0]! });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().enrollmentRequired, true);
    assert.equal(recovered.json().accessToken, undefined);
    assert.equal(await sessions.resolve(hashSessionToken(ownerFactor.pair.accessToken)), null);
    assert.equal((await post('auth/mfa/recover', { challengeToken: challenge, recoveryCode: ownerFactor.pair.recoveryCodes![0]! })).statusCode, 401);
    const newFactor = await factor(recovered.json().challengeToken);
    pass('MFA recovery one-use; sessions revoked; new factor required');
    await pool.query("UPDATE tribe_memberships SET status='pending' WHERE id=$1", [member.id]);
    assert.equal((await post(`tribes/${tribe}/memberships/${member.id}/activate`, { evidenceReference: 'Reactivation review' }, newFactor.pair.accessToken)).statusCode, 204);
    const prePromotion = await sessions.issue(memberIdentity.userId, 'Pre-promotion');
    assert.equal((await post(`tribes/${tribe}/memberships/${member.id}/role`, { role: 'administrator' }, newFactor.pair.accessToken)).statusCode, 204);
    assert.equal(await sessions.resolve(hashSessionToken(prePromotion.accessToken)), null);
    await assert.rejects(sessions.issue(memberIdentity.userId, 'No MFA'));
    pass('owner-only role grant revokes sessions and enforces MFA server-side');
    // Constraints and concurrent invitation consumption against a second independently authorized issuer.
    const concurrentEmail = 'concurrent-' + suffix + '@example.invalid';
    assert.equal((await post(`tribes/${tribe}/invitations`, { email: concurrentEmail, memberNumber: 'CON-' + suffix }, newFactor.pair.accessToken)).statusCode, 200);
    const concurrentToken = await messageToken(concurrentEmail, 'Trueda Tribe ID invitation');
    const concurrent = await Promise.all([post('auth/enroll', { invitationToken: concurrentToken, password, displayName: 'Example Test Identity 3' }), post('auth/enroll', { invitationToken: concurrentToken, password, displayName: 'Example Test Identity 4' }, undefined, other)]);
    assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [204, 400]);
    pass('concurrent invitation acceptance yields exactly one account/membership');
    const adminLogin = await post('auth/login', { email, password: newPassword + ' again', deviceName: 'Promoted admin' });
    assert.equal(adminLogin.statusCode, 200);
    assert.equal(adminLogin.json().enrollmentRequired, true);
    const adminFactor = await factor(adminLogin.json().challengeToken);
    assert.equal((await post(`tribes/${tribe}/memberships/${member.id}/role`, { role: 'owner' }, adminFactor.pair.accessToken)).statusCode, 403);
    pass('administrator cannot grant privileged roles');
    const revokedEmail = 'revoked-' + suffix + '@example.invalid';
    const revoked = await post(`tribes/${tribe}/invitations`, { email: revokedEmail, memberNumber: 'REV-' + suffix }, adminFactor.pair.accessToken);
    assert.equal(revoked.statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/tribes/${tribe}/invitations/${revoked.json().invitationId}`, headers: { authorization: 'Bearer ' + adminFactor.pair.accessToken } })).statusCode, 204);
    assert.equal((await post('auth/enroll', { invitationToken: await messageToken(revokedEmail, 'Trueda Tribe ID invitation'), password, displayName: 'Revoked' })).statusCode, 400);
    pass('administrator invitation authority and invitation revocation');
    const changeEmail = 'change-' + suffix + '@example.invalid', newEmail = 'changed-' + suffix + '@example.invalid';
    await service.invite(await identity(newFactor.pair.accessToken), tribe, changeEmail, 'CHANGE-' + suffix, 'email-change-invite');
    await service.enroll(await messageToken(changeEmail, 'Trueda Tribe ID invitation'), password, 'Email change test', 'email-change-enroll');
    const expiryToken = await messageToken(changeEmail, 'Verify your Trueda Tribe ID email');
    await pool.query("UPDATE account_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [hashSessionToken(expiryToken)]);
    assert.equal((await post('auth/verification/confirm', { token: expiryToken })).statusCode, 400);
    await service.requestToken(changeEmail, 'verify_email', 'email-resend');
    await service.verifyEmail(await messageToken(changeEmail, 'Verify your Trueda Tribe ID email'), 'email-verify');
    const changeLogin = await service.login(changeEmail, password, 'Email change device', 'email-login');
    assert.ok('accessToken' in changeLogin);
    const changeIdentity = await identity(changeLogin.accessToken);
    await assert.rejects(service.requestEmailChange(changeIdentity, 'wrong password', newEmail, 'email-change-wrong'));
    await service.requestEmailChange(changeIdentity, password, newEmail, 'email-change-request');
    assert.equal((await pool.query<{
        email: string;
    }>('SELECT email FROM users WHERE id=$1', [changeIdentity.userId])).rows[0]!.email, changeEmail);
    const emailToken = await messageToken(newEmail, 'Verify your new Trueda Tribe ID email');
    assert.equal((await post('auth/email/change/confirm', { token: emailToken })).statusCode, 204);
    assert.equal(await sessions.resolve(hashSessionToken(changeLogin.accessToken)), null);
    assert.equal((await pool.query<{
        email: string;
    }>('SELECT email FROM users WHERE id=$1', [changeIdentity.userId])).rows[0]!.email, newEmail);
    assert.equal((await post('auth/email/change/confirm', { token: emailToken })).statusCode, 400);
    pass('expired verification; email change requires password/new-mailbox proof and revokes sessions');
    await service.requestToken(newEmail, 'reset_password', 'expired-reset-request');
    const expiredReset = await messageToken(newEmail, 'Reset your Trueda Tribe ID password');
    await pool.query("UPDATE account_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [hashSessionToken(expiredReset)]);
    assert.equal((await post('auth/recovery/confirm', { token: expiredReset, newPassword: password + ' expired' })).statusCode, 400);
    pass('expired password reset token rejected');
    const existingEmail = 'existing-' + suffix + '@example.invalid';
    const existingId = (await pool.query<{
        id: string;
    }>("INSERT INTO users(email,password_hash,email_verified_at) VALUES($1,$2,clock_timestamp()) RETURNING id", [existingEmail, await service.passwords.hash(password)])).rows[0]!.id;
    const existingPair = await sessions.issue(existingId, 'Existing global account');
    await service.invite(await identity(newFactor.pair.accessToken), tribe, existingEmail, 'EXISTING-' + suffix, 'existing-invite');
    const existingToken = await messageToken(existingEmail, 'Trueda Tribe ID invitation');
    const originalHash = (await pool.query<{
        password_hash: string;
    }>('SELECT password_hash FROM users WHERE id=$1', [existingId])).rows[0]!.password_hash;
    assert.equal((await post('auth/enroll', { invitationToken: existingToken, password: password + ' overwrite', displayName: 'Example Test Identity 5' })).statusCode, 409);
    assert.equal((await post('auth/invitations/accept', { invitationToken: existingToken, displayName: 'Example Test Identity 5' }, existingPair.accessToken)).statusCode, 204);
    assert.equal((await pool.query<{
        password_hash: string;
    }>('SELECT password_hash FROM users WHERE id=$1', [existingId])).rows[0]!.password_hash, originalHash);
    pass('existing global account accepts invitation without credential replacement');
    const apiIpKey = (await import('node:crypto')).createHash('sha256').update('127.0.0.1:auth:login').digest('hex');
    await pool.query("INSERT INTO request_limits(key,window_start,count) VALUES($1,date_trunc('minute',clock_timestamp()),31) ON CONFLICT(key) DO UPDATE SET window_start=EXCLUDED.window_start,count=31", [apiIpKey]);
    assert.equal((await post('auth/login', { email: existingEmail, password, deviceName: 'Budget' })).statusCode, 429);
    assert.equal((await post('auth/logout', {}, existingPair.accessToken)).statusCode, 204);
    pass('login admission budget does not starve logout');
    const rows = (await pool.query<{
        payload_ciphertext: string;
    }>('SELECT payload_ciphertext FROM auth_outbox WHERE payload_ciphertext IS NOT NULL')).rows;
    assert.ok(rows.every(row => !row.payload_ciphertext.includes(password)));
    const auditRows = (await pool.query('SELECT * FROM auth_security_events')).rows;
    assert.ok(auditRows.some(row => row.user_id === null && row.outcome === 'denied'));
    assert.ok(auditRows.some(row => row.user_id === memberIdentity.userId));
    assert.ok(!JSON.stringify(auditRows).includes(password));
    pass('encrypted outbox; known/unknown security events omit credentials');
    await transaction(pool, async (db) => {
        await db.query('SAVEPOINT constraints');
        await assert.rejects(db.query("UPDATE users SET account_status='unknown' WHERE id=$1", [memberIdentity.userId]), { code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT constraints');
        await assert.rejects(db.query("UPDATE tribe_memberships SET role='superuser' WHERE id=$1", [member.id]), { code: '23514' });
        await db.query('ROLLBACK TO SAVEPOINT constraints');
    });
    pass('authentication and role database constraints');
    console.log(`Completed ${checks} authentication/security integration groups.`);
}
finally {
    await Promise.all([app.close(), other.close(), pool.end()]);
}
