import { Pool } from 'pg';
import { transaction, audit } from '../apps/api/src/modules/auth/support.js';
// Global account operations belong to controlled deployment operators, not scoped Tribe admins.
const id = process.env.ACCOUNT_USER_ID, state = process.env.ACCOUNT_STATE, reference = process.env.ACCOUNT_APPROVAL_REFERENCE;
if (!process.env.DATABASE_URL || !id || !['enabled', 'disabled'].includes(state ?? '') || !reference || process.env.ACCOUNT_STATE_CONFIRM !== 'controlled-account-operation')
    throw new Error('Explicit operator approval, identity, state and database required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
    await transaction(pool, async (db) => {
        const user = await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id]);
        if (!user.rowCount)
            throw new Error('Account not found');
        await db.query('UPDATE users SET account_status=$2,credential_version=credential_version+1 WHERE id=$1', [id, state]);
        await db.query('UPDATE device_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [id]);
        await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1', [id]);
        await db.query('UPDATE account_tokens SET consumed_at=clock_timestamp() WHERE user_id=$1', [id]);
        await db.query('UPDATE auth_challenges SET consumed_at=clock_timestamp() WHERE user_id=$1', [id]);
        await audit(db, 'account.' + state, 'success', reference, id);
    });
    console.log('Account state updated; sessions and outstanding credentials invalidated.');
}
finally {
    await pool.end();
}
