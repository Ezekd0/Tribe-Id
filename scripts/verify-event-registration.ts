import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}), app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),foreignTribe=randomUUID();
async function member(scope:string) {
 const id=randomUUID(),token=createSessionToken();
 await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[scope,id,id])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Event fixture') RETURNING id",[id])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
 return {id,token,membership,session};
}
async function event(capacity:number|null=1,status='published',future=true) {
 return (await pool.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at,capacity,status,timezone) VALUES($1,'Event fixture','Example City',now()+$2::interval,now()+interval '2 days',$3,$4,'Africa/Lagos') RETURNING id",[tribe,future?'1 day':'-1 hour',capacity,status])).rows[0].id as string;
}
async function change(token:string,eventId:string,method:'POST'|'DELETE'='POST',scope=tribe) {return app.inject({method,url:`/api/v1/tribes/${scope}/events/${eventId}/registration`,headers:{authorization:'Bearer '+token}});}
async function status(eventId:string,membership:string) {return (await pool.query('SELECT status FROM event_registrations WHERE event_id=$1 AND membership_id=$2',[eventId,membership])).rows[0]?.status;}
async function audits(eventId:string) {return (await pool.query('SELECT * FROM audit_logs WHERE resource_id=$1 ORDER BY created_at',[eventId])).rows;}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Event test',id]);
 const a=await member(tribe),b=await member(tribe),foreign=await member(foreignTribe);
 const last=await event();
 const race=await Promise.all([change(a.token,last),change(b.token,last)]);
 assert.deepEqual(race.map(r=>r.statusCode).sort(),[204,409]);
 const winner=race[0].statusCode===204?a:b,loser=winner===a?b:a;
 assert.equal(race.find(r=>r.statusCode===409)!.json().error.code,'EVENT_FULL');
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM event_registrations WHERE event_id=$1 AND status IN ('registered','attended')",[last])).rows[0].count,1);
 assert.equal((await change(winner.token,last)).statusCode,204); assert.equal((await audits(last)).length,1);
 assert.equal((await change(winner.token,last,'DELETE')).statusCode,204);
 assert.equal((await change(winner.token,last,'DELETE')).statusCode,204); assert.equal((await audits(last)).length,2);
 assert.equal((await change(loser.token,last)).statusCode,204);
 assert.equal((await change(winner.token,last)).json().error.code,'EVENT_FULL');
 assert.equal((await change(loser.token,last,'DELETE')).statusCode,204);
 assert.equal((await change(winner.token,last)).statusCode,204); assert.equal(await status(last,winner.membership),'registered');
 const duplicate=await event();
 assert.deepEqual((await Promise.all([change(a.token,duplicate),change(a.token,duplicate)])).map(r=>r.statusCode),[204,204]);
 assert.equal((await audits(duplicate)).length,1);
 const absentCancel=await event(); assert.equal((await change(a.token,absentCancel,'DELETE')).statusCode,204); assert.equal((await audits(absentCancel)).length,0);
 const attended=await event();
 await pool.query("INSERT INTO event_registrations(tribe_id,event_id,membership_id,status) VALUES($1,$2,$3,'attended')",[tribe,attended,a.membership]);
 assert.equal((await change(b.token,attended)).json().error.code,'EVENT_FULL'); assert.equal((await change(a.token,attended)).statusCode,204); assert.equal(await status(attended,a.membership),'attended');
 const unlimited=await event(null); assert.deepEqual((await Promise.all([change(a.token,unlimited),change(b.token,unlimited)])).map(r=>r.statusCode),[204,204]);
 for(const id of [await event(1,'published',false),await event(1,'cancelled'),await event(1,'completed')]) for(const method of ['POST','DELETE'] as const) {
  const response=await change(a.token,id,method); assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'EVENT_CLOSED');
 }
 for(const id of [randomUUID(),await event(1,'draft')]) assert.equal((await change(a.token,id)).json().error.code,'EVENT_NOT_FOUND');
 assert.equal((await change(foreign.token,last)).statusCode,404); assert.equal((await change(a.token,last,'POST',foreignTribe)).statusCode,404);
 for(const state of ['pending','suspended','revoked']) {await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[a.membership,state]); assert.equal((await change(a.token,last)).statusCode,404);}
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 const safeEvent=await event();
 const injected=await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/events/${safeEvent}/registration`,headers:{authorization:'Bearer '+a.token},payload:{membershipId:b.membership}}); assert.equal(injected.statusCode,400); assert.equal(await status(safeEvent,b.membership),undefined);
 const logged=await audits(last); assert.equal(logged[0].action,'event.registered'); assert.equal(logged[0].actor_user_id,winner.id); assert.equal(logged[0].tribe_id,tribe); assert.deepEqual(logged[0].metadata,{membershipId:winner.membership});
 assert.ok(!JSON.stringify(logged).includes(winner.token)); assert.ok(!JSON.stringify(logged).includes('@example.invalid'));
 // Force audit failure to prove the inserted reservation cannot survive without its audit.
 await pool.query("CREATE FUNCTION reject_event_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");
 await pool.query("CREATE TRIGGER reject_event_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='event.registered') EXECUTE FUNCTION reject_event_audit_fixture()");
 assert.equal((await change(a.token,safeEvent)).statusCode,500); assert.equal(await status(safeEvent,a.membership),undefined);
 await pool.query('DROP TRIGGER reject_event_audit_fixture ON audit_logs'); await pool.query('DROP FUNCTION reject_event_audit_fixture()');
 // The cutoff is evaluated after lock acquisition, rather than before waiting on the event row.
 const cutoff=await event(); const blocker=await pool.connect();
 try {
  await blocker.query('BEGIN'); await blocker.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[cutoff]);
  const waiting=change(a.token,cutoff);
  let blocked=false;
  for(let attempt=0;attempt<100&&!blocked;attempt++) blocked=Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM events WHERE tribe_id=%'")).rowCount);
  assert.ok(blocked,'Registration must wait for the held event lock');
  await blocker.query("UPDATE events SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[cutoff]); await blocker.query('COMMIT');
  const response=await waiting; assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'EVENT_CLOSED'); assert.equal(await status(cutoff,a.membership),undefined);
 } finally {await blocker.query('ROLLBACK');blocker.release();}
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[a.session]); assert.equal((await change(a.token,last)).statusCode,401);
 console.log('PASS real PostgreSQL event last-slot race, duplicate idempotency, cancel/re-register capacity, attended/unlimited capacity, cutoff/status/scope/inactive/session guards, body rejection and atomic safe audit rollback');
} finally {await app.close();await pool.end();}
