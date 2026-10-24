import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),otherTribe=randomUUID();
async function member(scope:string) {
 const id=randomUUID(),token=createSessionToken();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[scope,id,id])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Inbox fixture') RETURNING id",[id])).rows[0].id as string;await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);return {id,token,membership,session};
}
async function list(token:string,query='',scope=tribe) {return app.inject({url:`/api/v1/tribes/${scope}/notifications${query}`,headers:{authorization:'Bearer '+token}});}
async function get(token:string,id:string,scope=tribe,query=''){return app.inject({url:`/api/v1/tribes/${scope}/notifications/${id}${query}`,headers:{authorization:'Bearer '+token}});}
async function read(token:string,notificationId:string,scope=tribe) {return app.inject({method:'POST',url:`/api/v1/tribes/${scope}/notifications/${notificationId}/read`,headers:{authorization:'Bearer '+token}});}
async function item(id:string) {return (await pool.query('SELECT * FROM notifications WHERE id=$1',[id])).rows[0];}
try {
 for(const id of [tribe,otherTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Inbox test',id]);
 const a=await member(tribe),peer=await member(tribe),foreign=await member(otherTribe);
 assert.deepEqual((await list(a.token)).json(),{notifications:[]});
 const rows=(await pool.query("INSERT INTO notifications(membership_id,title,body,created_at) SELECT $1,'Own title '||n,'Own plain text '||n,'2026-01-01T00:00:00Z'::timestamptz+n*interval '1 second' FROM generate_series(1,105) n RETURNING *",[a.membership])).rows;
 const announcementSource=randomUUID(),eventSource=randomUUID();
 await pool.query("UPDATE notifications SET source_type='announcement',source_id=$2 WHERE id=$1",[rows[0].id,announcementSource]);
 await pool.query("UPDATE notifications SET source_type='event',source_id=$2 WHERE id=$1",[rows[1].id,eventSource]);
 const peerItem=(await pool.query("INSERT INTO notifications(membership_id,title,body) VALUES($1,'Private peer title','Private peer body') RETURNING id",[peer.membership])).rows[0].id as string;
 const foreignItem=(await pool.query("INSERT INTO notifications(membership_id,title,body) VALUES($1,'Private foreign title','Private foreign body') RETURNING id",[foreign.membership])).rows[0].id as string;
 const single=await get(a.token,rows[0].id);assert.equal(single.statusCode,200);assert.equal(single.headers['cache-control'],'no-store');assert.deepEqual(single.json().source,{type:'announcement',id:announcementSource});assert.equal((await item(rows[0].id)).read_at,null);
 for(const notificationId of [peerItem,foreignItem,randomUUID()])assert.equal((await get(a.token,notificationId)).statusCode,404);
 assert.equal((await get(a.token,rows[0].id,otherTribe)).statusCode,404);assert.equal((await get(a.token,rows[0].id,tribe,'?membershipId=other')).statusCode,400);
 const first=await list(a.token);assert.equal(first.statusCode,200);assert.equal(first.headers['cache-control'],'no-store');assert.equal(first.json().notifications.length,50);
 const ordered=[...rows].sort((x,y)=>y.created_at.getTime()-x.created_at.getTime()||String(y.id).localeCompare(x.id));
 assert.deepEqual(first.json().notifications,ordered.slice(0,50).map(row=>({id:row.id,title:row.title,body:row.body,createdAt:row.created_at.toISOString(),readAt:null})));
 for(const secret of ['Private peer','Private foreign',peerItem,foreignItem,'membershipId','membership_id','@example.invalid']) assert.ok(!first.body.includes(secret));
 assert.deepEqual((await list(a.token,'?limit=100&offset=5')).json().notifications.map((n:{id:string})=>n.id),ordered.slice(5,105).map(row=>row.id));
 const sources=(await list(a.token,'?limit=100&offset=5')).json().notifications;
 assert.deepEqual(sources.find((row:{id:string})=>row.id===rows[0].id).source,{type:'announcement',id:announcementSource});
 assert.deepEqual(sources.find((row:{id:string})=>row.id===rows[1].id).source,{type:'event',id:eventSource});
 assert.ok(!Object.hasOwn(sources.find((row:{id:string})=>row.id===rows[2].id),'source'));
 assert.deepEqual((await list(a.token,'?offset=10000')).json(),{notifications:[]});
 for(const query of ['?limit=101','?limit=0','?offset=10001','?limit=1.5','?limit=-1','?offset=-1','?limit=abc','?userId=foreign','?limit=1&limit=2']) assert.equal((await list(a.token,query)).statusCode,400);
 for(const id of [peerItem,foreignItem,randomUUID()]) {const denied=await read(a.token,id);assert.equal(denied.statusCode,404);assert.equal(denied.json().error.code,'NOTIFICATION_NOT_FOUND');}
 assert.equal((await item(peerItem)).read_at,null);assert.equal((await item(foreignItem)).read_at,null);
 const id=ordered[0].id as string;
 assert.deepEqual((await Promise.all([read(a.token,id),read(a.token,id)])).map(response=>response.statusCode),[204,204]);
 const readAt=(await item(id)).read_at;assert.ok(readAt);assert.equal((await read(a.token,id)).statusCode,204);assert.deepEqual((await item(id)).read_at,readAt);
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action='notification.read'")).rows;assert.equal(logs.length,1);assert.equal(logs[0].actor_user_id,a.id);assert.equal(logs[0].tribe_id,tribe);assert.equal(logs[0].resource_id,id);assert.deepEqual(logs[0].metadata,{});assert.ok(!JSON.stringify(logs).includes('Own plain text'));assert.ok(!JSON.stringify(logs).includes(a.token));
 assert.equal((await list(a.token,'?limit=1')).json().notifications[0].readAt,readAt.toISOString());
 const unreadId=ordered[1].id as string;
 await pool.query("CREATE FUNCTION reject_notification_read_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");await pool.query("CREATE TRIGGER reject_notification_read_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='notification.read') EXECUTE FUNCTION reject_notification_read_fixture()");
 assert.equal((await read(a.token,unreadId)).statusCode,500);assert.equal((await item(unreadId)).read_at,null);
 await pool.query('DROP TRIGGER reject_notification_read_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_notification_read_fixture()');
 for(const state of ['pending','suspended','revoked']) {await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[a.membership,state]);assert.equal((await list(a.token)).statusCode,404);assert.equal((await get(a.token,unreadId)).statusCode,404);assert.equal((await read(a.token,unreadId)).statusCode,404);}
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 assert.equal((await list(a.token,'',otherTribe)).statusCode,404);assert.equal((await read(a.token,unreadId,otherTribe)).statusCode,404);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[a.id]);assert.equal((await list(a.token)).statusCode,401);await pool.query("UPDATE users SET account_status='enabled',email_verified_at=NULL WHERE id=$1",[a.id]);assert.equal((await list(a.token)).statusCode,401);await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[a.id]);
 const bodyAttempt=await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/notifications/${unreadId}/read`,headers:{authorization:'Bearer '+a.token},payload:{membershipId:peer.membership}});assert.equal(bodyAttempt.statusCode,400);assert.equal((await item(unreadId)).read_at,null);
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[a.session]);assert.equal((await list(a.token)).statusCode,401);assert.equal((await get(a.token,unreadId)).statusCode,401);assert.equal((await read(a.token,unreadId)).statusCode,401);
 assert.equal((await app.inject({url:`/api/v1/tribes/${tribe}/notifications`})).statusCode,401);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM notifications')).rows[0].count,107);assert.equal((await pool.query('SELECT count(*)::int AS count FROM auth_outbox')).rows[0].count,0);
 console.log('PASS real PostgreSQL own scoped inbox stable bounded pagination, private peer/foreign isolation, strict query/body rejection, concurrent idempotent read with safe audit rollback, live membership/account/session guards and no publisher');
} finally {await app.close();await pool.end();}
