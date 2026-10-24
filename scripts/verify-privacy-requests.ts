import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true')throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),foreignTribe=randomUUID();
async function member(scope:string,role='member',mfa=true){
 const id=randomUUID(),token=createSessionToken();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role) VALUES($1,$2,$3,'active',$4) RETURNING id",[scope,id,'MEM-'+id,role])).rows[0].id as string;
 await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name,bio,phone,date_of_birth) VALUES($1,$2,'Requesting member','Private bio','1234567890','1990-01-01')",[membership,scope]);
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Privacy request fixture',CASE WHEN $2 THEN now() END) RETURNING id",[id,mfa])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);return{id,token,membership,session};
}
async function create(token:string,type:unknown,scope=tribe){return app.inject({method:'POST',url:`/api/v1/tribes/${scope}/privacy-requests`,headers:{authorization:'Bearer '+token},payload:{type}});}
async function list(token:string,admin=false,query='',scope=tribe){return app.inject({url:`/api/v1/tribes/${scope}/${admin?'admin/':''}privacy-requests${query}`,headers:{authorization:'Bearer '+token}});}
async function review(token:string,id:string,scope=tribe){return app.inject({method:'POST',url:`/api/v1/tribes/${scope}/admin/privacy-requests/${id}/review`,headers:{authorization:'Bearer '+token}});}
async function row(id:string){return(await pool.query('SELECT * FROM member_privacy_requests WHERE id=$1',[id])).rows[0];}
try{
 for(const id of [tribe,foreignTribe])await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Privacy requests test',id]);
 const a=await member(tribe),peer=await member(tribe),admin=await member(tribe,'administrator'),owner=await member(tribe,'owner'),foreign=await member(foreignTribe,'owner'),nonmfa=await member(tribe,'administrator',false);
 const profileBefore=(await pool.query('SELECT * FROM profiles WHERE membership_id=$1',[a.membership])).rows[0],membershipBefore=(await pool.query('SELECT * FROM tribe_memberships WHERE id=$1',[a.membership])).rows[0],userBefore=(await pool.query('SELECT * FROM users WHERE id=$1',[a.id])).rows[0];
 assert.deepEqual((await list(a.token)).json(),{requests:[]});
 const duplicate=await Promise.all([create(a.token,'export'),create(a.token,'export')]);assert.deepEqual(duplicate.map(r=>r.statusCode),[200,200]);assert.deepEqual(duplicate[0].json(),duplicate[1].json());
 const exportRequest=duplicate[0].json();assert.equal(exportRequest.type,'export');assert.equal(exportRequest.status,'pending');assert.equal(exportRequest.reviewedAt,null);assert.deepEqual(Object.keys(exportRequest).sort(),['createdAt','id','reviewedAt','status','type']);
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='privacy.requested'")).rows[0].count,1);
 const deletion=(await create(a.token,'deletion')).json();assert.equal(deletion.status,'pending');
 assert.deepEqual((await list(peer.token)).json(),{requests:[]});assert.equal((await list(a.token)).json().requests.length,2);
 const adminView=await list(admin.token,true);assert.equal(adminView.statusCode,200);assert.equal(adminView.headers['cache-control'],'no-store');assert.equal(adminView.json().requests.length,2);
 for(const request of adminView.json().requests){assert.equal(request.membershipId,a.membership);assert.equal(request.displayName,'Requesting member');assert.equal(request.memberNumber,'MEM-'+a.id);assert.deepEqual(Object.keys(request).sort(),['createdAt','displayName','id','memberNumber','membershipId','reviewedAt','status','type']);}
 for(const secret of [a.id+'@example.invalid','1234567890','1990-01-01','Private bio',a.token])assert.ok(!adminView.body.includes(secret));
 assert.equal((await list(a.token,true)).statusCode,403);assert.equal((await list(foreign.token,true)).statusCode,403);assert.equal((await list(nonmfa.token,true)).statusCode,401);assert.equal((await review(a.token,exportRequest.id)).statusCode,403);assert.equal((await review(foreign.token,exportRequest.id)).statusCode,403);
 assert.equal((await review(admin.token,randomUUID())).statusCode,404);
 const foreignRequest=(await create(foreign.token,'deletion',foreignTribe)).json();assert.equal((await review(admin.token,foreignRequest.id)).statusCode,404);assert.equal((await create(a.token,'export',foreignTribe)).statusCode,404);assert.equal((await list(a.token,false,'',foreignTribe)).statusCode,404);
 for(const type of ['erase','EXPORT',null,1,{},[]])assert.equal((await create(a.token,type)).statusCode,400);
 for(const payload of [{type:'export',userId:peer.id},{type:'deletion',membershipId:peer.membership},{type:'export',status:'reviewed'},{type:'export',reason:'Unbounded private note'}])assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/privacy-requests`,headers:{authorization:'Bearer '+a.token},payload})).statusCode,400);
 for(const query of ['?limit=101','?limit=0','?offset=10001','?status=fulfilled','?userId=foreign'])assert.equal((await list(admin.token,true,query)).statusCode,400);
 assert.equal((await list(a.token,false,'?status=pending')).statusCode,400);
 const reviewRace=await Promise.all([review(admin.token,exportRequest.id),review(owner.token,exportRequest.id)]);assert.deepEqual(reviewRace.map(r=>r.statusCode),[204,204]);
 const reviewed=await row(exportRequest.id);assert.ok(reviewed.reviewed_at);assert.ok([admin.id,owner.id].includes(reviewed.reviewed_by_user_id));assert.equal((await review(owner.token,exportRequest.id)).statusCode,204);assert.deepEqual(await row(exportRequest.id),reviewed);
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='privacy.reviewed' AND resource_id=$1",[exportRequest.id])).rows[0].count,1);
 assert.equal((await list(a.token)).json().requests.find((r:{id:string})=>r.id===exportRequest.id).status,'reviewed');assert.equal((await list(admin.token,true)).json().requests.length,1);assert.equal((await list(admin.token,true,'?status=reviewed')).json().requests.length,1);assert.equal((await list(admin.token,true,'?status=all')).json().requests.length,2);
 // Acknowledgement is not fulfillment: account, profile and membership remain byte-for-byte unchanged.
 assert.deepEqual((await pool.query('SELECT * FROM users WHERE id=$1',[a.id])).rows[0],userBefore);assert.deepEqual((await pool.query('SELECT * FROM tribe_memberships WHERE id=$1',[a.membership])).rows[0],membershipBefore);assert.deepEqual((await pool.query('SELECT * FROM profiles WHERE membership_id=$1',[a.membership])).rows[0],profileBefore);
 const again=await create(a.token,'export');assert.equal(again.statusCode,200);assert.notEqual(again.json().id,exportRequest.id);
 await pool.query("CREATE FUNCTION reject_privacy_request_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");await pool.query("CREATE TRIGGER reject_privacy_request_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action IN ('privacy.requested','privacy.reviewed')) EXECUTE FUNCTION reject_privacy_request_audit_fixture()");
 assert.equal((await create(peer.token,'deletion')).statusCode,500);assert.equal((await pool.query('SELECT count(*)::int AS count FROM member_privacy_requests WHERE membership_id=$1',[peer.membership])).rows[0].count,0);
 assert.equal((await review(admin.token,deletion.id)).statusCode,500);assert.equal((await row(deletion.id)).reviewed_at,null);assert.equal((await row(deletion.id)).reviewed_by_user_id,null);
 await pool.query('DROP TRIGGER reject_privacy_request_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_privacy_request_audit_fixture()');
 // Administrators may acknowledge an existing request after membership exit; they still cannot fulfill it.
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[a.membership]);assert.equal((await create(a.token,'export')).statusCode,404);assert.equal((await list(a.token)).statusCode,404);assert.equal((await review(admin.token,deletion.id)).statusCode,204);assert.ok((await row(deletion.id)).reviewed_at);
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 const body=await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/admin/privacy-requests/${again.json().id}/review`,headers:{authorization:'Bearer '+admin.token},payload:{fulfilled:true}});assert.equal(body.statusCode,400);assert.equal((await row(again.json().id)).reviewed_at,null);
 await pool.query("INSERT INTO member_privacy_requests(membership_id,tribe_id,request_type,created_at,reviewed_at,reviewed_by_user_id) SELECT $1,$2,'export','2026-01-01T00:00:00Z'::timestamptz+n*interval '1 second','2026-01-02T00:00:00Z'::timestamptz,$3 FROM generate_series(1,105) n",[a.membership,tribe,admin.id]);
 assert.equal((await list(a.token)).json().requests.length,50);assert.equal((await list(a.token,false,'?limit=100')).json().requests.length,100);assert.deepEqual((await list(a.token,false,'?offset=10000')).json(),{requests:[]});assert.equal((await list(admin.token,true,'?status=all&limit=100')).json().requests.length,100);
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action IN ('privacy.requested','privacy.reviewed')")).rows;for(const log of logs)assert.deepEqual(log.metadata,{});for(const secret of [a.token,'Private bio','1234567890','@example.invalid'])assert.ok(!JSON.stringify(logs).includes(secret));
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[admin.membership]);assert.equal((await list(admin.token,true)).statusCode,403);await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[admin.membership]);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[a.id]);assert.equal((await list(a.token)).statusCode,401);await pool.query("UPDATE users SET account_status='enabled' WHERE id=$1",[a.id]);await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[admin.session]);assert.equal((await list(admin.token,true)).statusCode,401);
 assert.equal((await app.inject({url:`/api/v1/tribes/${tribe}/privacy-requests`})).statusCode,401);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM auth_outbox')).rows[0].count,0);assert.equal((await pool.query('SELECT count(*)::int AS count FROM notifications')).rows[0].count,0);
 console.log('PASS real PostgreSQL own export/deletion requests, concurrent duplicate pending reuse, bounded scoped MFA review acknowledgement, non-fulfillment invariants, strict input/privacy guards, concurrency and transactional audit rollback');
}finally{await app.close();await pool.end();}
