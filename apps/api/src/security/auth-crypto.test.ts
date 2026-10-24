import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Passwords, SecretBox, totp, matchTotp, base32 } from '../modules/auth/crypto.js';
import { credentialRedaction } from '../infrastructure/security/redaction.js';
import pino from 'pino';
test('Argon2id salts credentials, rejects wrong password and performs unknown-user work', async () => {
    const passwords = new Passwords();
    const password = 'A long test passphrase 2026!';
    const hash = await passwords.hash(password);
    assert.match(hash, /^\$argon2id\$/);
    assert.notEqual(await passwords.hash(password), hash);
    assert.equal(await passwords.verify(hash, password), true);
    assert.equal(await passwords.verify(hash, 'wrong'), false);
    assert.equal(await passwords.verify(undefined, password), false);
    assert.throws(() => passwords.validate('short'));
    assert.throws(() => passwords.validate('a'.repeat(20)));
});
test('AES-GCM encryption rejects tampering and cross-purpose use', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));
    const sealed = box.seal('private-value', 'one');
    assert.ok(!sealed.includes('private-value'));
    assert.equal(box.open(sealed, 'one'), 'private-value');
    assert.throws(() => box.open(sealed, 'two'));
    assert.throws(() => box.open(sealed.slice(0, -8) + 'AAAAAAAA', 'one'));
});
test('TOTP matches RFC 6238 vectors, enforces replay and bounded clock skew', () => {
    const secret = Buffer.from('12345678901234567890');
    assert.equal(totp(secret, 1), '287082');
    assert.equal(totp(secret, Math.floor(1111111109 / 30)), '081804');
    assert.equal(base32(Buffer.from('foo')), 'MZXW6');
    assert.equal(matchTotp(secret, '287082', -1, 59000), 1);
    assert.equal(matchTotp(secret, '287082', 1, 59000), null);
    assert.equal(matchTotp(secret, 'not-code', -1, 59000), null);
});
test('structured logging redacts nested credential fields', () => {
    let output = '';
    const logger = pino({ redact: credentialRedaction }, { write: (value: string) => {
            output += value;
        } });
    logger.info({ req: { headers: { authorization: 'Bearer SECRET' }, body: { password: 'SECRET', refreshToken: 'SECRET', challengeToken: 'SECRET', code: 'SECRET', nested: { credentials: [{ password: 'SECRET' }] } } }, res: { body: { accessToken: 'SECRET', recoveryCodes: ['SECRET'], nested: { factor: { secret: 'SECRET' } } } }, err: { token: 'SECRET', cause: { connectionString: 'SECRET' } }, secret: 'SECRET', config: { rateLimitKey: 'SECRET', databaseUrl: 'SECRET' } });
    assert.ok(!output.includes('SECRET'));
    assert.ok(output.includes('[Redacted]'));
});
import { rateBudget } from '../modules/auth/rate-budget.js';
test('refresh/logout budgets are independent and unknown paths cannot grow limiter cardinality', () => {
    assert.notEqual(rateBudget('/api/v1/auth/login').key, rateBudget('/api/v1/auth/logout').key);
    assert.notEqual(rateBudget('/api/v1/auth/refresh').key, rateBudget('/api/v1/auth/logout').key);
    assert.deepEqual(rateBudget('/api/v1/auth/made-up-1'), rateBudget('/api/v1/auth/made-up-2'));
    assert.equal(rateBudget('/api/v1/auth/devices/one').key, rateBudget('/api/v1/auth/devices/two').key);
});
