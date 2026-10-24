import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),foreignTribe=randomUUID();
async function actor(scope:string,role='member',mfa=true) {
 const id=randomUUID(),token=createSessionToken();
 await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-only',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role,joined_at) VALUES($1,$2,$3,'active',$4,now()) RETURNING id",[scope,id,id,role])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Administration fixture',CASE WHEN $2 THEN now() END) RETURNING id",[id,mfa])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
 return {id,token,membership,session};
}
type Actor=Awaited<ReturnType<typeof actor>>;
async function request(actor:Actor,resource:string,scope=tribe) {return app.inject({url:`/api/v1/tribes/${scope}/admin/${resource}`,headers:{authorization:'Bearer '+actor.token}});}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Admin test '+id,id]);
 const owner=await actor(tribe,'owner'),admin=await actor(tribe,'administrator'),member=await actor(tribe),foreign=await actor(foreignTribe,'owner'),noMfa=await actor(tribe,'administrator',false);
 await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name,bio,phone,date_of_birth,location,occupation) VALUES($1,$2,'Visible Name','secret-bio','+12025550123','1990-01-01','secret-location','secret-occupation')",[member.membership,tribe]);
 const context=await request(owner,'context');assert.equal(context.statusCode,200);assert.deepEqual(context.json(),{tribeId:tribe,tribeName:'Admin test '+tribe,membershipId:owner.membership,role:'owner'});
 assert.equal((await request(admin,'context')).json().role,'administrator');
 const members=await request(admin,'members');assert.equal(members.statusCode,200);assert.equal(members.json().members.length,4);
 const visible=members.json().members.find((entry:{membershipId:string})=>entry.membershipId===member.membership);
 assert.deepEqual(Object.keys(visible).sort(),['displayName','emailVerified','joinedAt','memberNumber','membershipId','role','status']);
 assert.equal(visible.displayName,'Visible Name');assert.equal(visible.emailVerified,true);assert.ok(visible.joinedAt);
 for(const secret of ['secret-bio','+12025550123','1990-01-01','secret-location','secret-occupation',member.id+'@example.invalid','password_hash']) assert.ok(!members.body.includes(secret));
 await pool.query('UPDATE users SET email_verified_at=NULL WHERE id=$1',[member.id]);
 assert.equal((await request(owner,'members?search=Visible')).json().members[0].emailVerified,false);
 await pool.query("UPDATE tribe_memberships SET status='pending',joined_at=NULL WHERE id=$1",[member.membership]);
 const filtered=(await request(owner,'members?status=pending&role=member&search=Visible')).json().members;assert.equal(filtered.length,1);assert.equal(filtered[0].joinedAt,null);
 assert.equal((await request(owner,'members?search=%25%27%20OR%20true')).json().members.length,0);
 await pool.query("WITH added AS (INSERT INTO users(email,password_hash) SELECT gen_random_uuid()::text||'@example.invalid','fixture-only' FROM generate_series(1,105) RETURNING id) INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) SELECT $1,id,'bulk-'||id::text,'pending' FROM added",[tribe]);
 assert.equal((await request(owner,'members')).json().members.length,50);
 const first=(await request(owner,'members?limit=100')).json().members;assert.equal(first.length,100);
 const remainder=(await request(owner,'members?limit=100&offset=100')).json().members;assert.equal(remainder.length,9);
 assert.equal(new Set([...first,...remainder].map((entry:{membershipId:string})=>entry.membershipId)).size,109);
 const invitationIds:string[]=[];
 for(const [scope,inviter,state] of [[tribe,owner.id,'open'],[tribe,owner.id,'consumed'],[tribe,admin.id,'revoked'],[foreignTribe,foreign.id,'open']] as const) {
  const id=randomUUID();invitationIds.push(id);
  await pool.query("INSERT INTO member_invitations(id,tribe_id,email,member_number,invited_by,token_hash,consumed_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7='consumed' THEN now() END,CASE WHEN $7='revoked' THEN now() END)",[id,scope,id+'@example.invalid','INV-'+id,inviter,randomBytes(32).toString('hex'),state]);
 }
 const invitations=(await request(admin,'invitations')).json().invitations;assert.equal(invitations.length,3);
 for(const invitation of invitations) {assert.deepEqual(Object.keys(invitation).sort(),['consumedAt','email','expiresAt','id','memberNumber','revokedAt']);assert.ok(invitation.expiresAt);assert.ok(!Object.hasOwn(invitation,'token_hash'));}
 assert.ok(!invitations.some((invitation:{id:string})=>invitation.id===invitationIds[3]));
 assert.equal((await request(owner,'invitations?search='+invitationIds[0])).json().invitations.length,1);
 assert.equal((await request(owner,'invitations?search=%25%27%20OR%20true')).json().invitations.length,0);
 assert.equal((await request(owner,'invitations?limit=1&offset=1')).json().invitations.length,1);
 // Restore ordinary member authentication so role denial is tested independently of email verification.
 await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[member.id]);await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[member.membership]);
 for(const resource of ['context','members','invitations']) {
  assert.equal((await request(member,resource)).statusCode,403);assert.equal((await request(foreign,resource)).statusCode,403);
  assert.equal((await request(noMfa,resource)).statusCode,401);assert.equal((await request(owner,resource,foreignTribe)).statusCode,403);
 }
 assert.equal((await request(member,'members?role=owner')).statusCode,403);
 for(const state of ['pending','suspended','revoked']) {await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[owner.membership,state]);assert.equal((await request(owner,'context')).statusCode,403);}
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[owner.membership]);
 for(const resource of ['context?role=owner','members?limit=101','members?limit=1&limit=2','members?offset=10001','members?search='+('x'.repeat(201)),'members?email=secret','invitations?status=open']) assert.equal((await request(owner,resource)).statusCode,400);
 await pool.query('UPDATE device_sessions SET mfa_verified_at=NULL WHERE id=$1',[admin.session]);assert.equal((await request(admin,'members')).statusCode,401);
 await pool.query('UPDATE device_sessions SET mfa_verified_at=now() WHERE id=$1',[admin.session]);
 await pool.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[admin.id]);assert.equal((await request(admin,'members')).statusCode,401);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[owner.id]);assert.equal((await request(owner,'context')).statusCode,401);
 await pool.query("UPDATE users SET account_status='enabled' WHERE id=$1",[owner.id]);
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[owner.session]);assert.equal((await request(owner,'invitations')).statusCode,401);
 console.log('PASS administrative context/member/invitation own-tenant projections, no member PII/token disclosure, bounded pagination/literal search, strict queries and live scoped authority/MFA/account/session guards');
} finally {await app.close();await pool.end();}
