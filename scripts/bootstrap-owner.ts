import { Pool } from 'pg';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { IdentityService } from '../apps/api/src/modules/auth/identity-service.js';
import { MobileSessionRepository } from '../apps/api/src/modules/auth/repository.js';
// No default identity or credential. Password is supplied via private stdin, never argv/logs.
const env = readEnvironment();
if (!env.auth || !env.databaseUrl || process.env.BOOTSTRAP_CONFIRM !== 'establish-initial-owner')
    throw new Error('Explicit controlled bootstrap confirmation and configured authentication required');
const tribeId = process.env.BOOTSTRAP_TRIBE_ID, email = process.env.BOOTSTRAP_EMAIL, number = process.env.BOOTSTRAP_MEMBER_NUMBER, reference = process.env.BOOTSTRAP_APPROVAL_REFERENCE;
if (!tribeId || !email || !number || !reference)
    throw new Error('Explicit Tribe, email, member number and approval reference required');
let password = '';
for await (const chunk of process.stdin) {
    password += chunk.toString();
    if (Buffer.byteLength(password) > 1024)
        throw new Error('Password input too large');
}
password = password.replace(/\r?\n$/, '');
const pool = new Pool({ connectionString: env.databaseUrl, max: 2 });
try {
    console.log(await new IdentityService(pool, new MobileSessionRepository(pool), env.auth).bootstrap(tribeId, email, password, number, reference));
}
finally {
    password = '';
    await pool.end();
}
