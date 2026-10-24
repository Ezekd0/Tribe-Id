import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
import {SecretBox} from '../apps/api/src/modules/auth/crypto.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10});
const encryptionKey=randomBytes(32).toString('base64'),box=new SecretBox(encryptionKey);
const env=readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL});
env.auth={encryptionKey,rateLimitKey:randomBytes(32).toString('base64'),mailFrom:'fixture@example.invalid',smtpUrl:'smtps://mail.example.invalid',mailMode:'local-capture'};
const app=await buildApp(env),tribe=randomUUID(),foreignTribe=randomUUID();
async function member(scope:string,role='member',mfa=true) {
 const id=randomUUID(),token=createSessionToken();
 await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role) VALUES($1,$2,$3,'active',$4) RETURNING id",[scope,id,'MEM-'+id,role])).rows[0].id as string;
 await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name,phone,date_of_birth) VALUES($1,$2,'Approved display name','1234567890','1990-01-01')",[membership,scope]);
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Card fixture',CASE WHEN $2 THEN now() END) RETURNING id",[id,mfa])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
 return {id,token,membership,session};
}
async function lifecycle(token:string,membership:string,operation:'issue'|'reissue'|'revoke'='issue',scope=tribe) {return app.inject({method:operation==='revoke'?'DELETE':'POST',url:`/api/v1/tribes/${scope}/memberships/${membership}/id-card`+(operation==='reissue'?'/reissue':''),headers:{authorization:'Bearer '+token}});}
async function proof(token:string,scope=tribe) {return app.inject({url:`/api/v1/tribes/${scope}/id-card/proof`,headers:{authorization:'Bearer '+token}});}
async function verify(token:string,value:string,scope=tribe) {return app.inject({method:'POST',url:`/api/v1/tribes/${scope}/id-card/verify`,headers:{authorization:'Bearer '+token},payload:{proof:value}});}
async function cards(membership:string) {return (await pool.query('SELECT * FROM id_cards WHERE membership_id=$1 ORDER BY issued_at,id',[membership])).rows;}
function invalid(response:{statusCode:number;json:()=>any}) {assert.equal(response.statusCode,404);assert.equal(response.json().error.code,'CARD_NOT_FOUND');assert.equal(response.json().error.message,'Card is unavailable.');}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Card test',id]);
 const admin=await member(tribe,'administrator'),owner=await member(tribe,'owner'),a=await member(tribe),viewer=await member(tribe),foreign=await member(foreignTribe,'owner'),nonmfa=await member(tribe,'administrator',false);
 invalid(await proof(a.token));
 assert.equal((await lifecycle(a.token,a.membership)).statusCode,403);
 assert.equal((await lifecycle(foreign.token,a.membership)).statusCode,403);
 assert.equal((await lifecycle(nonmfa.token,a.membership)).statusCode,401);
 invalid(await lifecycle(admin.token,foreign.membership));
 const race=await Promise.all([lifecycle(admin.token,a.membership),lifecycle(owner.token,a.membership)]);
 assert.deepEqual(race.map(r=>r.statusCode).sort(),[204,409]); assert.equal(race.find(r=>r.statusCode===409)!.json().error.code,'CARD_ALREADY_ISSUED');
 let rows=await cards(a.membership);assert.equal(rows.length,1);assert.equal(rows[0].status,'issued');
 assert.equal((await pool.query("SELECT expires_at=issued_at+interval '12 months' AS calendar FROM id_cards WHERE id=$1",[rows[0].id])).rows[0].calendar,true);
 const minted=await proof(a.token);assert.equal(minted.statusCode,200);assert.equal(minted.headers['cache-control'],'no-store');
 const initial=minted.json() as {proof:string;expiresAt:string};
 assert.deepEqual(Object.keys(initial).sort(),['expiresAt','proof']);
 const decrypted=JSON.parse(box.open(initial.proof,'tribe-card-proof:v1:'+tribe));
 assert.deepEqual(Object.keys(decrypted).sort(),['cardId','issuedAt','proofExpiresAt','v']);
 assert.ok(decrypted.proofExpiresAt-Date.now()<=300000);assert.ok(decrypted.proofExpiresAt>Date.now());
 const checked=await verify(viewer.token,initial.proof); assert.equal(checked.statusCode,200);
 assert.deepEqual(checked.json(),{displayName:'Approved display name',memberNumber:'MEM-'+a.id,status:'issued',expiresAt:rows[0].expires_at.toISOString()});
 for(const secret of [a.id+'@example.invalid','1234567890','1990-01-01',initial.proof]) assert.ok(!checked.body.includes(secret));
 const aggregate=await app.inject({url:`/api/v1/tribes/${tribe}/id-card`,headers:{authorization:'Bearer '+a.token}});assert.equal(aggregate.statusCode,200);assert.ok(!aggregate.body.includes(initial.proof));assert.ok(!aggregate.body.includes('verification_token_hash'));assert.ok(!aggregate.body.includes('proof'));
 invalid(await verify(foreign.token,initial.proof,foreignTribe)); invalid(await verify(foreign.token,initial.proof));
 invalid(await verify(viewer.token,'invalid-proof'));invalid(await verify(viewer.token,rows[0].verification_token_hash));
 invalid(await verify(viewer.token,initial.proof.slice(0,10)+(initial.proof[10]==='A'?'B':'A')+initial.proof.slice(11)));
 for(const payload of [{...decrypted,proofExpiresAt:Date.now()-1},{...decrypted,proofExpiresAt:Date.now()+600000},{...decrypted,issuedAt:'2000-01-01T00:00:00.000Z'},{...decrypted,cardId:'------------------------------------'}]) invalid(await verify(viewer.token,box.seal(JSON.stringify(payload),'tribe-card-proof:v1:'+tribe)));
 for(const state of ['suspended','revoked']) {
  await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[a.membership,state]);invalid(await verify(viewer.token,initial.proof));invalid(await proof(a.token));invalid(await lifecycle(admin.token,a.membership,'reissue'));
 }
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[a.id]);invalid(await verify(viewer.token,initial.proof));invalid(await lifecycle(admin.token,a.membership,'reissue'));
 await pool.query("UPDATE users SET account_status='enabled',email_verified_at=NULL WHERE id=$1",[a.id]);invalid(await verify(viewer.token,initial.proof));invalid(await lifecycle(admin.token,a.membership,'reissue'));
 await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[a.id]);
 // Force a reissue audit failure: revoking the old card and inserting its replacement must both roll back.
 await pool.query("CREATE FUNCTION reject_card_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");
 await pool.query("CREATE TRIGGER reject_card_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='card.reissued') EXECUTE FUNCTION reject_card_audit_fixture()");
 assert.equal((await lifecycle(admin.token,a.membership,'reissue')).statusCode,500);assert.equal((await cards(a.membership)).length,1);assert.equal((await verify(viewer.token,initial.proof)).statusCode,200);
 await pool.query('DROP TRIGGER reject_card_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_card_audit_fixture()');
 assert.deepEqual((await Promise.all([lifecycle(admin.token,a.membership,'reissue'),lifecycle(owner.token,a.membership,'reissue')])).map(r=>r.statusCode),[204,204]);
 rows=await cards(a.membership);assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.status==='issued').length,1);assert.equal(rows.filter(r=>r.status==='revoked').length,2);invalid(await verify(viewer.token,initial.proof));
 const current=(await proof(a.token)).json() as {proof:string};assert.equal((await verify(viewer.token,current.proof)).statusCode,200);
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[a.membership]);assert.equal((await lifecycle(admin.token,a.membership,'revoke')).statusCode,204);
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);invalid(await verify(viewer.token,current.proof));invalid(await proof(a.token));
 assert.equal((await lifecycle(owner.token,a.membership,'revoke')).statusCode,204);assert.equal((await cards(a.membership)).length,3);
 assert.equal((await lifecycle(admin.token,a.membership)).statusCode,204);
 let issued=(await cards(a.membership)).find(row=>row.status==='issued');
 await pool.query("UPDATE id_cards SET expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[issued.id]);
 const capped=(await proof(a.token)).json() as {proof:string;expiresAt:string};assert.equal(capped.expiresAt,(await cards(a.membership)).find(row=>row.status==='issued').expires_at.toISOString());
 await pool.query("UPDATE id_cards SET issued_at=clock_timestamp()-interval '13 months',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1",[issued.id]);invalid(await verify(viewer.token,capped.proof));invalid(await proof(a.token));
 assert.equal((await lifecycle(admin.token,a.membership)).statusCode,204);rows=await cards(a.membership);assert.equal(rows.find(row=>row.id===issued.id).status,'expired');assert.equal(rows.filter(row=>row.status==='issued').length,1);
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action LIKE 'card.%' ORDER BY created_at")).rows;
 assert.ok(logs.some(row=>row.action==='card.issued'));assert.ok(logs.some(row=>row.action==='card.reissued'));assert.ok(logs.some(row=>row.action==='card.revoked'));
 for(const row of logs) {assert.equal(row.tribe_id,tribe);assert.equal(row.resource_id,a.membership);assert.deepEqual(row.metadata,{});assert.ok([admin.id,owner.id].includes(row.actor_user_id));}
 for(const secret of [initial.proof,current.proof,capped.proof,a.token,'@example.invalid','1234567890','1990-01-01']) assert.ok(!JSON.stringify(logs).includes(secret));
 const latest=(await proof(a.token)).json() as {proof:string};
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[viewer.membership]);invalid(await verify(viewer.token,latest.proof));
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[viewer.membership]);await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[viewer.session]);assert.equal((await verify(viewer.token,latest.proof)).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/id-card/verify`,payload:{proof:latest.proof}})).statusCode,401);
 console.log('PASS real PostgreSQL card concurrent issue/reissue uniqueness and history, 12-calendar-month expiry, live scoped MFA authority, same-Tribe private AEAD proof/TTL, target/viewer state guards, tamper/revoke/reissue/expiry rejection and atomic audit rollback');
} finally {await app.close();await pool.end();}
