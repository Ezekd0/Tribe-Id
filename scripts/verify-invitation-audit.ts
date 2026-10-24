import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { createSessionToken, hashSessionToken } from '../apps/api/src/modules/authentication/session.js';
if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true')
    throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const env = readEnvironment({ NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL });
env.auth = { encryptionKey: randomBytes(32).toString('base64'), rateLimitKey: randomBytes(32).toString('base64'), mailFrom: 'test@example.invalid', smtpUrl: 'smtps://mail.example.invalid', mailMode: 'local-capture' };
const app = await buildApp(env);
const tribe = randomUUID(), foreignTribe = randomUUID();
async function actor(role: 'member' | 'owner', scope: string) {
    const id = randomUUID(), token = createSessionToken();
    await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())", [id, id + '@example.invalid']);
    await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,role,status) VALUES($1,$2,$3,$4,'active')", [scope,id,id,role]);
    const session = (await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Audit fixture',now()) RETURNING id",[id])).rows[0].id;
    await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
    return { id, token };
}
try {
    for (const id of [tribe, foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Audit fixture',id]);
    const member = await actor('member',tribe), foreign = await actor('owner',foreignTribe), owner = await actor('owner',tribe);
    const email = randomUUID() + '@example.invalid', memberNumber = 'private-number-' + randomUUID(), querySecret = createSessionToken();
    const created = await app.inject({ method:'POST',url:`/api/v1/tribes/${tribe}/invitations`,headers:{authorization:'Bearer '+owner.token},payload:{email,memberNumber} });
    assert.equal(created.statusCode,200);
    const invitationId = created.json().invitationId as string;
    for (const actor of [member,foreign]) {
        for (const method of ['POST','DELETE'] as const) {
            const route = '/api/v1/tribes/:tribeId/invitations' + (method === 'DELETE' ? '/:id' : '');
            const response = await app.inject({method,url:`/api/v1/tribes/${tribe}/invitations${method === 'DELETE' ? '/'+invitationId : ''}?secret=${querySecret}`,headers:{authorization:'Bearer '+actor.token},...(method === 'POST' ? {payload:{email,memberNumber}} : {})});
            assert.equal(response.statusCode,403);
            assert.equal(response.json().error.code,'AUTHORITY_REQUIRED');
            assert.equal(response.json().error.message,'An authorized Tribe authority with MFA is required.');
            const events = (await pool.query('SELECT * FROM auth_security_events WHERE request_id=$1',[response.headers['x-request-id']])).rows;
            assert.equal(events.length,1);
            assert.equal(events[0].user_id,actor.id);
            assert.equal(events[0].action,'request.'+route);
            assert.equal(events[0].outcome,'denied');
            assert.equal(events[0].subject_key,null);
            assert.equal(events[0].tribe_id,null);
            for (const secret of [actor.token,hashSessionToken(actor.token),email,memberNumber,querySecret,invitationId,tribe]) assert.ok(!JSON.stringify(events).includes(secret));
        }
    }
    assert.equal((await pool.query('SELECT revoked_at FROM member_invitations WHERE id=$1',[invitationId])).rows[0].revoked_at,null);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM member_invitations')).rows[0].count,1);
    const revoked = await app.inject({method:'DELETE',url:`/api/v1/tribes/${tribe}/invitations/${invitationId}`,headers:{authorization:'Bearer '+owner.token}});
    assert.equal(revoked.statusCode,204);
    assert.ok((await pool.query('SELECT revoked_at FROM member_invitations WHERE id=$1',[invitationId])).rows[0].revoked_at);
    for (const [response,action] of [[created,'invitation.created'],[revoked,'invitation.revoked']] as const) {
        const rows = (await pool.query('SELECT action,outcome,user_id FROM auth_security_events WHERE request_id=$1',[response.headers['x-request-id']])).rows;
        assert.deepEqual(rows,[{action,outcome:'success',user_id:owner.id}]);
    }
    console.log('PASS invitation create/revoke member and foreign-Tribe denial attribution, template-only audit redaction, unchanged authorized success and no denied mutations');
} finally { await app.close(); await pool.end(); }
