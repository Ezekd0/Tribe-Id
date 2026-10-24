import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { createSessionToken, hashSessionToken } from '../apps/api/src/modules/authentication/session.js';

if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true') throw new Error('Explicit disposable database required');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const env=readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL});
env.auth={encryptionKey:randomBytes(32).toString('base64'),rateLimitKey:randomBytes(32).toString('base64'),mailFrom:'test@example.invalid',smtpUrl:'smtps://mail.example.invalid',mailMode:'local-capture'};
const app=await buildApp(env);
const tribe=randomUUID();
async function user(){return (await pool.query("INSERT INTO users(email,password_hash,email_verified_at) VALUES($1,'test-no-credential',now()) RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id as string;}
async function member(userId:string,status='pending',role='member',exitDays:number|null=null){return (await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role,exited_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::int IS NULL THEN NULL ELSE now()-$6*interval '1 day' END) RETURNING id",[tribe,userId,randomUUID(),status,role,exitDays])).rows[0].id as string;}
async function cleanup(){
  const child=spawn(process.execPath,['packages/database/cleanup.mjs'],{env:{...process.env,AUTH_AUDIT_RETENTION_DAYS:'90'},stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,'Disposable retention cleanup must pass');
}
try {
 await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[tribe,'History fixture',tribe]);
 const owner=await user(),target=await user(),ownerMembership=await member(owner,'active','owner'),targetMembership=await member(target);
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'History fixture',now()) RETURNING id",[owner])).rows[0].id;
 const token=createSessionToken();await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
 const headers={authorization:'Bearer '+token};
 const path=`/api/v1/tribes/${tribe}/memberships/${targetMembership}`;
 async function activate(reference:string){assert.equal((await app.inject({method:'POST',url:path+'/activate',headers,payload:{evidenceReference:reference}})).statusCode,204);}
 async function state(status:string){assert.equal((await app.inject({method:'POST',url:path+'/status',headers,payload:{status}})).statusCode,204);}
 await activate('approved-fixture-one');await state('suspended');await state('pending');await activate('approved-fixture-two');await state('revoked');
 const history=(await pool.query('SELECT * FROM membership_verification_history WHERE membership_id=$1 ORDER BY recorded_at,id',[targetMembership])).rows;
 assert.equal(history.length,5);assert.deepEqual(history.filter(row=>row.event_type==='approved').map(row=>row.evidence_reference),['approved-fixture-one','approved-fixture-two']);
 assert.ok(history.every(row=>row.actor_user_id===owner&&row.tribe_id===tribe&&row.membership_id===targetMembership));
 assert.equal((await pool.query('SELECT 1 FROM membership_verifications WHERE membership_id=$1',[targetMembership])).rowCount,0);
 assert.ok((await pool.query('SELECT exited_at FROM tribe_memberships WHERE id=$1',[targetMembership])).rows[0].exited_at);
 await assert.rejects(pool.query("UPDATE membership_verification_history SET evidence_reference='changed' WHERE membership_id=$1",[targetMembership]),{code:'23514'});
 await state('pending');await activate('approved-fixture-three');
 assert.equal((await pool.query('SELECT exited_at FROM tribe_memberships WHERE id=$1',[targetMembership])).rows[0].exited_at,null);
 assert.equal((await pool.query('SELECT 1 FROM membership_verification_history WHERE membership_id=$1',[targetMembership])).rowCount,7);
 const oldExit=await member(await user(),'revoked','member',366),recentExit=await member(await user(),'revoked','member',364),active=await member(await user(),'active');
 for(const id of [oldExit,recentExit,active])await pool.query("INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status,evidence_reference,recorded_at) VALUES($1,$2,$3,'approved','active','retention-test',now()-interval '1000 days')",[id,tribe,owner]);
 const auditOld=randomUUID(),auditRecent=randomUUID();
 await pool.query("INSERT INTO auth_security_events(action,outcome,request_id,created_at) VALUES('retention.fixture','success',$1,now()-interval '91 days'),('retention.fixture','success',$2,now()-interval '89 days')",[auditOld,auditRecent]);
 await cleanup();await cleanup();
 assert.equal((await pool.query('SELECT 1 FROM membership_verification_history WHERE membership_id=$1',[oldExit])).rowCount,0);
 for(const id of [recentExit,active,targetMembership])assert.ok((await pool.query('SELECT 1 FROM membership_verification_history WHERE membership_id=$1',[id])).rowCount);
 assert.equal((await pool.query('SELECT 1 FROM auth_security_events WHERE request_id=$1',[auditOld])).rowCount,0);
 assert.equal((await pool.query('SELECT 1 FROM auth_security_events WHERE request_id=$1',[auditRecent])).rowCount,1);
 assert.ok(ownerMembership);
 console.log('PASS append-only attributed approval/state history, reactivation preserves evidence, 90-day auth retention, active/recent-exit preservation, 365-day exit cleanup and idempotency');
} finally {await app.close();await pool.end();}
