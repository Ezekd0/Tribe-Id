import { MobileSessionRepository } from '../apps/api/src/modules/auth/repository.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresMemberRepository } from '../apps/api/src/modules/members/repository.js';
import { createSessionToken, hashSessionToken } from '../apps/api/src/modules/authentication/session.js';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
if(!process.env.DATABASE_URL)throw new Error('Use a disposable DATABASE_URL for integration verification.');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
// One transaction-scoped SQL client lets this test roll back every record.
let pending:Promise<unknown>=Promise.resolve();
const pool={query:(sql:string,params?:unknown[])=>{const result=pending.then(()=>client.query(sql,params));pending=result.catch(()=>{});return result;}} as unknown as pg.Pool;
const members=new PostgresMemberRepository(pool),sessions=new MobileSessionRepository(pool);
const app=await buildApp(readEnvironment({NODE_ENV:'test'}),{members,sessions});
try{
  await client.query('BEGIN');
  const userId=randomUUID(),tribeId=randomUUID(),otherTribe=randomUUID(),membershipId=randomUUID();
  await client.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES ($1,$2,'integration-test-no-password',now())",[userId,`${userId}@example.invalid`]);
  for(const id of [tribeId,otherTribe])await client.query('INSERT INTO tribes(id,name,slug) VALUES ($1,$2,$3)',[id,'Integration Tribe',id]);
  await client.query("INSERT INTO tribe_memberships(id,tribe_id,user_id,member_number,status,joined_at) VALUES ($1,$2,$3,'TEST-1','active',now())",[membershipId,tribeId,userId]);
  await client.query("INSERT INTO profiles(membership_id,tribe_id,display_name,bio) VALUES ($1,$2,'Integration Member','Test biography')",[membershipId,tribeId]);
  for(const [id,status,offset] of [[randomUUID(),'published',"-1 hour"],[randomUUID(),'draft',"-1 hour"],[randomUUID(),'published',"1 hour"]])await client.query(`INSERT INTO announcements(id,tribe_id,author_membership_id,title,body,category,status,published_at) VALUES ($1,$2,$3,'Test content','Body','general',$4,now()+$5::interval)`,[id,tribeId,membershipId,status,offset]);
  await client.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at,status) VALUES ($1,'Published event','Example City',now()+interval '1 day',now()+interval '2 days','published')",[tribeId]);
  await client.query("INSERT INTO id_cards(membership_id,tribe_id,verification_token_hash,issued_at,expires_at) VALUES ($1,$2,$3,now()-interval '2 days',now()-interval '1 day')",[membershipId,tribeId,hashSessionToken(createSessionToken())]);
  await client.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Integration device')",[userId]);
  const token=createSessionToken();
  await client.query("INSERT INTO access_tokens(session_id,token_hash,expires_at) VALUES ((SELECT id FROM device_sessions WHERE user_id=$1),$2,now()+interval '1 hour')",[userId,hashSessionToken(token)]);
  const headers={authorization:`Bearer ${token}`};
  const view=await app.inject({url:`/api/v1/tribes/${tribeId}/member-view`,headers});
  assert.equal(view.statusCode,200);const data=view.json();assert.equal(data.identity.displayName,'Integration Member');
  assert.equal(data.announcements.length,1);assert.equal(data.events.length,1);assert.equal(data.card.status,'expired');
  assert.ok(!view.body.includes('token_hash'));assert.ok(!view.body.includes('password_hash'));
  const projections={
    'member-view':data,
    hub:{identity:data.identity,card:data.card,announcements:data.announcements.slice(0,1),events:data.events.slice(0,2)},
    profile:{identity:data.identity,profile:data.profile},
    'id-card':{identity:data.identity,card:data.card,location:data.profile?.location??null},
    announcements:{announcements:data.announcements},events:{events:data.events}
  };
  for(const [resource,expected] of Object.entries(projections)){
    const response=await app.inject({url:`/api/v1/tribes/${tribeId}/${resource}`,headers});
    assert.equal(response.statusCode,200);assert.deepEqual(response.json(),expected);
    assert.equal((await app.inject({url:`/api/v1/tribes/${otherTribe}/${resource}`,headers})).statusCode,404);
  }
  await client.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[membershipId]);
  for(const resource of Object.keys(projections))assert.equal((await app.inject({url:`/api/v1/tribes/${tribeId}/${resource}`,headers})).statusCode,404);
  await client.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[membershipId]);
  await client.query('UPDATE users SET email_verified_at=NULL WHERE id=$1',[userId]);
  assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,401);
  await client.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[userId]);
  await client.query("UPDATE access_tokens SET expires_at=created_at+interval '1 microsecond' WHERE session_id IN (SELECT id FROM device_sessions WHERE user_id=$1)",[userId]);
  assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,401);
  await client.query("UPDATE access_tokens SET expires_at=now()+interval '1 hour' WHERE session_id IN (SELECT id FROM device_sessions WHERE user_id=$1)",[userId]);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{...headers,origin:'http://localhost:5173'}})).statusCode,204);
  assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,401);
  console.log('Passed real PostgreSQL member projections, published-only content, expired cards, session expiry/revocation, verified email, inactive membership, and Tribe isolation.');
}finally{await client.query('ROLLBACK').catch(()=>{});await app.close();await client.end();}
