import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),foreignTribe=randomUUID();
async function member(scope:string,role='member',mfa=true) {
 const id=randomUUID(),token=createSessionToken();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role) VALUES($1,$2,$3,'active',$4) RETURNING id",[scope,id,id,role])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Event admin fixture',CASE WHEN $2 THEN now() END) RETURNING id",[id,mfa])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);return {id,token,membership,session};
}
const data={title:'Managed event',description:'<b>Plain text</b> private body '+randomUUID(),location:'Example City',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+90000000).toISOString(),timezone:'Africa/Lagos',capacity:2};
async function request(token:string,method:'GET'|'POST'|'PATCH',suffix='',payload?:unknown,scope=tribe) {return app.inject({method,url:`/api/v1/tribes/${scope}/admin/events${suffix}`,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload:payload as Record<string,unknown>})});}
async function register(token:string,eventId:string) {return app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/events/${eventId}/registration`,headers:{authorization:'Bearer '+token}});}
async function registrations(eventId:string) {return (await pool.query('SELECT * FROM event_registrations WHERE event_id=$1 ORDER BY membership_id',[eventId])).rows;}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Event admin test',id]);
 const admin=await member(tribe,'administrator'),owner=await member(tribe,'owner'),a=await member(tribe),b=await member(tribe),foreign=await member(foreignTribe,'owner'),nonmfa=await member(tribe,'administrator',false);
 for(const actor of [a,foreign]) {assert.equal((await request(actor.token,'GET')).statusCode,403);assert.equal((await request(actor.token,'POST','',data)).statusCode,403);}
 assert.equal((await request(nonmfa.token,'POST','',data)).statusCode,401);
 const created=await request(admin.token,'POST','',data);assert.equal(created.statusCode,200);const eventId=created.json().eventId as string;
 const listed=await request(owner.token,'GET');assert.equal(listed.statusCode,200);assert.equal(listed.headers['cache-control'],'no-store');
 assert.deepEqual(listed.json(),{events:[{...data,id:eventId,status:'draft'}]});
 const feed=()=>app.inject({url:`/api/v1/tribes/${tribe}/events`,headers:{authorization:'Bearer '+a.token}});
 assert.deepEqual((await feed()).json(),{events:[]});assert.equal((await register(a.token,eventId)).json().error.code,'EVENT_NOT_FOUND');
 assert.equal((await request(admin.token,'POST',`/${eventId}/publish`)).statusCode,204);assert.equal((await request(admin.token,'POST',`/${eventId}/publish`)).statusCode,204);
 assert.equal((await feed()).json().events.length,1);assert.equal((await register(a.token,eventId)).statusCode,204);
 const registrationBefore=await registrations(eventId);
 assert.equal((await request(admin.token,'PATCH',`/${eventId}`,{title:'Changed',startsAt:new Date(Date.now()+172800000).toISOString(),endsAt:new Date(Date.now()+180000000).toISOString(),timezone:'Europe/London'})).statusCode,204);
 assert.deepEqual(await registrations(eventId),registrationBefore);
 // Both branches serialize on the same event row: either capacity wins or reservation wins.
 const race=await Promise.all([request(admin.token,'PATCH',`/${eventId}`,{capacity:1}),register(b.token,eventId)]);
 assert.deepEqual(race.map(r=>r.statusCode).sort(),[204,409]);
 const row=(await pool.query('SELECT capacity FROM events WHERE id=$1',[eventId])).rows[0];const occupied=(await registrations(eventId)).filter(r=>r.status==='registered'||r.status==='attended').length;
 assert.ok(occupied<=row.capacity);
 if(race[0].statusCode===409) assert.equal(race[0].json().error.code,'EVENT_CAPACITY_CONFLICT');else assert.equal(race[1].json().error.code,'EVENT_FULL');
 await pool.query("UPDATE event_registrations SET status='attended' WHERE event_id=$1 AND membership_id=$2",[eventId,a.membership]);
 assert.equal((await request(owner.token,'PATCH',`/${eventId}`,{capacity:null})).statusCode,204);
 // Ensure two occupied slots to reject a reduction below registered + attended.
 if(await registrations(eventId).then(rows=>!rows.some(r=>r.membership_id===b.membership))) assert.equal((await register(b.token,eventId)).statusCode,204);
 const stable=await registrations(eventId);
 const rejected=await request(admin.token,'PATCH',`/${eventId}`,{capacity:1});assert.equal(rejected.statusCode,409);assert.equal(rejected.json().error.code,'EVENT_CAPACITY_CONFLICT');
 assert.equal((await request(admin.token,'POST',`/${eventId}/cancel`)).statusCode,204);assert.deepEqual(await registrations(eventId),stable);assert.deepEqual((await feed()).json(),{events:[]});assert.equal((await register(a.token,eventId)).json().error.code,'EVENT_CLOSED');
 assert.equal((await request(owner.token,'POST',`/${eventId}/cancel`)).statusCode,204);
 assert.equal((await request(a.token,'PATCH',`/${eventId}`,{title:'Denied'})).statusCode,403);assert.equal((await request(foreign.token,'POST',`/${eventId}/publish`)).statusCode,403);
 assert.equal((await request(owner.token,'PATCH',`/${randomUUID()}`,{title:'Missing'})).statusCode,404);assert.equal((await request(owner.token,'PATCH',`/${eventId}`,{title:'Foreign'},foreignTribe)).statusCode,403);
 for(const payload of [{title:'Valid',status:'published'},{capacity:'1'},{capacity:0},{capacity:2147483648},{startsAt:'2026-02-30T12:00:00Z'},{startsAt:'2026-01-01'},{endsAt:'2000-01-01T00:00:00Z'},{timezone:'Fake/Zone'},{timezone:'+01:00'},{description:'a'.repeat(10001)},{title:''},{}]) assert.equal((await request(admin.token,'PATCH',`/${eventId}`,payload)).statusCode,400);
 const countBefore=(await pool.query('SELECT count(*)::int AS count FROM events')).rows[0].count;
 await pool.query("CREATE FUNCTION reject_event_management_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");
 await pool.query("CREATE TRIGGER reject_event_management_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action IN ('event.created','event.updated')) EXECUTE FUNCTION reject_event_management_audit_fixture()");
 assert.equal((await request(admin.token,'POST','',data)).statusCode,500);assert.equal((await pool.query('SELECT count(*)::int AS count FROM events')).rows[0].count,countBefore);
 assert.equal((await request(admin.token,'PATCH',`/${eventId}`,{title:'Must rollback'})).statusCode,500);assert.equal((await pool.query('SELECT title FROM events WHERE id=$1',[eventId])).rows[0].title,'Changed');
 await pool.query('DROP TRIGGER reject_event_management_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_event_management_audit_fixture()');
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action IN ('event.created','event.updated','event.published','event.cancelled') AND metadata ? 'changedFields'")).rows;
 for(const action of ['event.created','event.updated','event.published','event.cancelled']) assert.ok(logs.some(row=>row.action===action));
 assert.equal(logs.filter(row=>row.action==='event.published').length,1);assert.equal(logs.filter(row=>row.action==='event.cancelled').length,1);
 for(const secret of [data.description,admin.token,a.token,'@example.invalid']) assert.ok(!JSON.stringify(logs).includes(secret));
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[admin.membership]);assert.equal((await request(admin.token,'GET')).statusCode,403);await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[admin.membership]);
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[admin.session]);assert.equal((await request(admin.token,'GET')).statusCode,401);
 // Bounded administrative listing, stable ordering, and scope filtering.
 await pool.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at) SELECT $1,'List fixture','Example City',now()+n*interval '1 day',now()+n*interval '1 day'+interval '1 hour' FROM generate_series(1,105) n",[tribe]);
 const bounded=await request(owner.token,'GET');assert.equal(bounded.json().events.length,100);
 const ordered=(await pool.query('SELECT id FROM events WHERE tribe_id=$1 ORDER BY starts_at,id LIMIT 100',[tribe])).rows.map(row=>row.id);assert.deepEqual(bounded.json().events.map((event:{id:string})=>event.id),ordered);
 console.log('PASS real PostgreSQL scoped MFA event draft/edit/publish/cancel, bounded plain-text lists, preserved registrations, registration-vs-capacity race, attended capacity, strict fields/date/timezone validation, published feed isolation and atomic audit rollback');
} finally {await app.close();await pool.end();}
