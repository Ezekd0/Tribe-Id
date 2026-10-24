import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { createSessionToken, hashSessionToken } from '../apps/api/src/modules/authentication/session.js';
if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool = new Pool({connectionString:process.env.DATABASE_URL});
const app = await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(), otherTribe=randomUUID();
async function member(scope:string,withProfile=true) {
    const id=randomUUID(), token=createSessionToken();
    await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
    const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[scope,id,'MEM-'+id])).rows[0].id as string;
    if(withProfile) await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name,bio,phone,location,occupation,date_of_birth) VALUES($1,$2,'Protected legal name','Original bio','1234567890','Original location','Original job','1990-01-01')",[membership,scope]);
    const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Profile integration') RETURNING id",[id])).rows[0].id as string;
    await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
    return {id,token,membership,session};
}
async function patch(token:string,scope:string,payload:unknown) { return app.inject({method:'PATCH',url:`/api/v1/tribes/${scope}/profile`,headers:{authorization:'Bearer '+token},payload:payload as Record<string,unknown>}); }
async function profile(id:string) { return (await pool.query('SELECT * FROM profiles WHERE membership_id=$1',[id])).rows[0]; }
async function audits() { return (await pool.query("SELECT * FROM audit_logs WHERE action='profile.updated' ORDER BY created_at,id")).rows; }
try {
    for(const id of [tribe,otherTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Profile test',id]);
    const own=await member(tribe), peer=await member(tribe), foreign=await member(otherTribe), missing=await member(tribe,false);
    const before=await profile(own.membership), protectedBefore=(await pool.query('SELECT * FROM tribe_memberships WHERE id=$1',[own.membership])).rows[0];
    const bio='  Preserve bio whitespace\nSensitive bio '+randomUUID();
    assert.equal((await patch(own.token,tribe,{bio,phone:'+1 (202) 555-0123',location:'  Example City  ',occupation:'  Engineer  '})).statusCode,204);
    const after=await profile(own.membership);
    assert.equal(after.bio,bio); assert.equal(after.phone,'+12025550123'); assert.equal(after.location,'Example City'); assert.equal(after.occupation,'Engineer');
    assert.equal(after.display_name,before.display_name); assert.equal(after.date_of_birth.toISOString(),before.date_of_birth.toISOString());
    assert.ok(after.updated_at>before.updated_at);
    assert.deepEqual((await pool.query('SELECT * FROM tribe_memberships WHERE id=$1',[own.membership])).rows[0],protectedBefore);
    assert.equal((await profile(peer.membership)).bio,'Original bio');
    let rows=await audits(); assert.equal(rows.length,1);
    assert.equal(rows[0].actor_user_id,own.id); assert.equal(rows[0].tribe_id,tribe); assert.equal(rows[0].resource_id,own.membership); assert.equal(rows[0].resource_type,'profile');
    assert.deepEqual(rows[0].metadata,{changedFields:['bio','phone','location','occupation']});
    for(const secret of [bio,'+12025550123',own.token,'Engineer','Example City']) assert.ok(!JSON.stringify(rows).includes(secret));
    assert.equal((await patch(own.token,tribe,{phone:'   ',location:' ',occupation:null})).statusCode,204);
    assert.equal((await profile(own.membership)).phone,null); assert.equal((await profile(own.membership)).location,null); assert.equal((await profile(own.membership)).occupation,null); assert.equal((await profile(own.membership)).bio,bio);
    const validCount=(await audits()).length, stable=await profile(own.membership);
    for(const field of ['displayName','dateOfBirth','email','memberNumber','status','role','roles','verification','membershipId','userId','avatarAssetId']) {
        const response=await patch(own.token,tribe,{bio:'Must rollback',[field]:peer.membership});
        assert.equal(response.statusCode,400,field); assert.equal(response.json().error.code,'VALIDATION_FAILED');
    }
    for(const payload of [{},{bio:null},{bio:'a'.repeat(2001)},{phone:'123'},{phone:'+1234567890123456'},{phone:'1234567ext89'},{phone:'a'.repeat(26)},{location:'a'.repeat(201)},{occupation:5},{phone:5},{bio:['no']}]) assert.equal((await patch(own.token,tribe,payload)).statusCode,400);
    assert.deepEqual(await profile(own.membership),stable); assert.equal((await audits()).length,validCount);
    assert.equal((await patch(foreign.token,tribe,{bio:'Foreign attempt'})).statusCode,404);
    assert.equal((await patch(own.token,otherTribe,{bio:'Other scope'})).statusCode,404);
    assert.equal((await patch(missing.token,tribe,{bio:'Missing'})).statusCode,404);
    for(const status of ['pending','suspended','revoked']) {
        await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[own.membership,status]);
        assert.equal((await patch(own.token,tribe,{bio:'Inactive attempt'})).statusCode,404);
    }
    await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[own.membership]);
    assert.deepEqual(await profile(own.membership),stable); assert.equal((await audits()).length,validCount);
    // A failing audit sink must roll back the profile mutation in the same transaction.
    await pool.query("CREATE FUNCTION reject_profile_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");
    await pool.query("CREATE TRIGGER reject_profile_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='profile.updated') EXECUTE FUNCTION reject_profile_audit_fixture()");
    const failed=await patch(own.token,tribe,{bio:'Must roll back on audit failure'});
    assert.equal(failed.statusCode,500); assert.equal(failed.json().error.message,'An unexpected error occurred.');
    assert.deepEqual(await profile(own.membership),stable); assert.equal((await audits()).length,validCount);
    await pool.query('DROP TRIGGER reject_profile_audit_fixture ON audit_logs');
    await pool.query('DROP FUNCTION reject_profile_audit_fixture()');
    const pair=await Promise.all([patch(own.token,tribe,{bio:'Concurrent bio'}),patch(own.token,tribe,{location:'Concurrent location'})]);
    assert.deepEqual(pair.map(r=>r.statusCode),[204,204]);
    assert.equal((await profile(own.membership)).bio,'Concurrent bio'); assert.equal((await profile(own.membership)).location,'Concurrent location');
    assert.equal((await patch(own.token,tribe,{bio:'Last committed'})).statusCode,204); assert.equal((await profile(own.membership)).bio,'Last committed');
    await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[own.session]);
    assert.equal((await patch(own.token,tribe,{bio:'Revoked'})).statusCode,401);
    assert.equal((await profile(own.membership)).bio,'Last committed');
    console.log('PASS real PostgreSQL profile own-only partial update, normalization, protected/invalid rejection, scope/inactive/missing/revoked denial, concurrent disjoint updates, safe transactional audit and unchanged membership');
} finally { await app.close(); await pool.end(); }
