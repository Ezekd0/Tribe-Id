import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),foreignTribe=randomUUID(),base=`/api/v1/tribes/${tribe}/admin/announcements`;
async function actor(scope:string,role='member',mfa=true) {
 const id=randomUUID(),token=createSessionToken();
 await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-only',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status,role) VALUES($1,$2,$3,'active',$4) RETURNING id",[scope,id,id,role])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'Announcement fixture',CASE WHEN $2 THEN now() END) RETURNING id",[id,mfa])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);
 return {id,token,membership,session};
}
type Actor=Awaited<ReturnType<typeof actor>>;
async function request(actor:Actor,method:'POST'|'PATCH'|'GET',suffix='',payload?:unknown,scope=base) {return app.inject({method,url:scope+suffix,headers:{authorization:'Bearer '+actor.token},...(payload===undefined?{}:{payload:payload as Record<string,unknown>})});}
async function row(id:string) {return (await pool.query('SELECT * FROM announcements WHERE id=$1',[id])).rows[0];}
async function audits(id:string) {return (await pool.query('SELECT * FROM audit_logs WHERE resource_id=$1 ORDER BY created_at',[id])).rows;}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Announcement test',id]);
 const owner=await actor(tribe,'owner'),admin=await actor(tribe,'administrator'),member=await actor(tribe),foreign=await actor(foreignTribe,'owner'),noMfa=await actor(tribe,'administrator',false);
 const input={title:'  Plain text announcement ',body:'Private draft\n<plain text>\n',category:'general'};
 const created=await request(owner,'POST','',input);assert.equal(created.statusCode,201);
 const announcement=created.json().announcement,id=announcement.id as string;
 assert.equal(announcement.status,'draft');assert.equal(announcement.authorMembershipId,owner.membership);assert.equal(announcement.publishedAt,null);assert.equal(announcement.body,input.body);
 assert.equal((await request(admin,'GET')).json().announcements.length,1);
 const feed=async()=>app.inject({url:`/api/v1/tribes/${tribe}/announcements`,headers:{authorization:'Bearer '+member.token}});
 assert.equal((await feed()).json().announcements.length,0);
 assert.equal((await request(admin,'PATCH','/'+id,{title:'Updated title'})).statusCode,200);
 const publishRace=await Promise.all([request(admin,'POST','/'+id+'/publish'),request(owner,'POST','/'+id+'/publish')]);
 assert.deepEqual(publishRace.map(response=>response.statusCode),[200,200]);
 const published=publishRace[0]!;assert.ok(published.json().announcement.publishedAt);
 assert.equal(publishRace[1]!.json().announcement.publishedAt,published.json().announcement.publishedAt);
 const publishedAt=published.json().announcement.publishedAt;
 assert.equal((await feed()).json().announcements.length,1);
 assert.equal((await request(owner,'POST','/'+id+'/publish')).json().announcement.publishedAt,publishedAt);
 assert.equal((await audits(id)).length,3);
 assert.equal((await request(owner,'PATCH','/'+id,{body:'Public revised plain text'})).statusCode,200);
 assert.equal((await row(id)).body,'Public revised plain text');
 assert.deepEqual((await Promise.all([request(owner,'POST','/'+id+'/archive'),request(admin,'POST','/'+id+'/archive')])).map(response=>response.statusCode),[200,200]);
 assert.equal((await audits(id)).length,5);
 assert.equal((await feed()).json().announcements.length,0);
 assert.equal((await request(owner,'POST','/'+id+'/publish')).statusCode,409);
 assert.equal((await request(owner,'PATCH','/'+id,{title:'cannot edit'})).statusCode,409);
 assert.equal((await request(admin,'GET','?status=archived&search=Updated&limit=1&offset=0')).json().announcements.length,1);
 assert.equal((await request(admin,'GET',"?search=%25%27%20OR%20true")).json().announcements.length,0);
 for(const caller of [member,foreign]) for(const method of ['GET','POST'] as const) assert.equal((await request(caller,method,'',method==='POST'?input:undefined)).statusCode,403);
 for(const method of ['GET','POST'] as const) assert.equal((await request(noMfa,method,'',method==='POST'?input:undefined)).statusCode,401);
 assert.equal((await request(owner,'GET','',undefined,`/api/v1/tribes/${foreignTribe}/admin/announcements`)).statusCode,403);
 const foreignCreated=await request(foreign,'POST','',input,`/api/v1/tribes/${foreignTribe}/admin/announcements`);
 const foreignId=foreignCreated.json().announcement.id as string;
 for(const suffix of ['/'+foreignId,'/'+foreignId+'/publish','/'+foreignId+'/archive']) assert.equal((await request(owner,suffix.endsWith(foreignId)?'PATCH':'POST',suffix,suffix.endsWith(foreignId)?{title:'bad'}:undefined)).statusCode,404);
 for(const status of ['pending','suspended','revoked']) {await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[owner.membership,status]);assert.equal((await request(owner,'POST','',input)).statusCode,403);}
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[owner.membership]);
 for(const payload of [{...input,status:'published'},{...input,authorMembershipId:member.membership},{...input,tribeId:foreignTribe},{...input,title:12},{...input,body:null},{...input,category:['general']},{...input,body:'x'.repeat(20001)}]) assert.equal((await request(owner,'POST','',payload)).statusCode,400);
 assert.equal((await request(owner,'PATCH','/'+id,{})).statusCode,400);
 assert.equal((await request(owner,'POST','/'+id+'/archive',{})).statusCode,400);
 assert.equal((await request(owner,'GET','?limit=101')).statusCode,400);assert.equal((await request(owner,'GET','?sort=title')).statusCode,400);
 const logged=await audits(id);assert.equal(logged[0].actor_user_id,owner.id);assert.equal(logged[0].tribe_id,tribe);assert.deepEqual(logged[0].metadata,{fields:['body','category','title']});
 assert.ok(!JSON.stringify(logged).includes(input.body));assert.ok(!JSON.stringify(logged).includes(owner.token));
 const rollbackId=(await request(owner,'POST','',input)).json().announcement.id as string;
 await pool.query("CREATE FUNCTION reject_announcement_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit unavailable'; END $$");
 await pool.query("CREATE TRIGGER reject_announcement_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource_type='announcement') EXECUTE FUNCTION reject_announcement_audit_fixture()");
 const count=Number((await pool.query('SELECT count(*) FROM announcements')).rows[0].count);
 assert.equal((await request(owner,'POST','',input)).statusCode,500);assert.equal(Number((await pool.query('SELECT count(*) FROM announcements')).rows[0].count),count);
 assert.equal((await request(owner,'PATCH','/'+rollbackId,{title:'must rollback'})).statusCode,500);assert.equal((await row(rollbackId)).title,input.title);
 assert.equal((await request(owner,'POST','/'+rollbackId+'/publish')).statusCode,500);assert.equal((await row(rollbackId)).status,'draft');
 assert.equal((await request(owner,'POST','/'+rollbackId+'/archive')).statusCode,500);assert.equal((await row(rollbackId)).status,'draft');
 await pool.query('DROP TRIGGER reject_announcement_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_announcement_audit_fixture()');
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[owner.session]);assert.equal((await request(owner,'GET')).statusCode,401);
 console.log('PASS announcement draft/publish/edit/archive, member published-only feed, scoped admin/owner live-MFA guards, strict mass-assignment rejection, bounded literal search, idempotency and transactional audit rollback');
} finally {await app.close();await pool.end();}
