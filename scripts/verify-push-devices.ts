import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
import {PushDeviceService} from '../apps/api/src/modules/notifications/device-service.js';
import {NotificationPublisher} from '../apps/api/src/modules/notifications/publisher.js';
import {NotificationDeliveryWorker,type InformationalEnvelope} from '../apps/api/src/modules/notifications/delivery.js';
import {transaction} from '../apps/api/src/modules/auth/support.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const key=randomBytes(32).toString('base64'),pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),service=new PushDeviceService(pool,key),publisher=new NotificationPublisher(key);
const app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL,AUTH_ENABLED:'true',AUTH_ENCRYPTION_KEY:key,AUTH_RATE_LIMIT_KEY:randomBytes(32).toString('base64'),SMTP_URL:'smtp://127.0.0.1:1',AUTH_MAIL_MODE:'local-capture',MAIL_FROM:'fixture@example.invalid'}));
const tribe=randomUUID();
async function device(userId:string) {
 const token=createSessionToken(),id=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'push fixture',now()) RETURNING id",[userId])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[id,hashSessionToken(token)]);return {userId,id,token};
}
async function member() {
 const id=randomUUID();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-only',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[tribe,id,id])).rows[0].id as string;
 return {id,membership,device:await device(id)};
}
type Device=Awaited<ReturnType<typeof device>>;
const token=(name:string)=>'ExpoPushToken['+name+'-'+randomUUID()+']';
async function request(device:Device,method:'PUT'|'DELETE',pushToken?:string,extra?:Record<string,unknown>) {return app.inject({method,url:'/api/v1/me/push-device',headers:{authorization:'Bearer '+device.token},...(method==='PUT'?{payload:{provider:'expo',platform:'android',token:pushToken,...extra}}:extra?{payload:extra}:{})});}
async function registrations() {return (await pool.query('SELECT * FROM push_device_registrations ORDER BY id')).rows;}
async function notify(membershipId:string,resourceId:string) {
 await transaction(pool,db=>publisher.publish(db,{tribeId:tribe,kind:'registration.registered',resourceId,title:'Never in push payload',membershipId}));
}
try {
 await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[tribe,'Push fixture',tribe]);
 const a=await member(),b=await member(),a2=await device(a.id),push=token('owned'),other=token('other');
 let response=await request(a.device,'PUT',push);assert.equal(response.statusCode,204);assert.equal(response.body,'');
 assert.equal((await request(a.device,'PUT',push)).statusCode,204);assert.equal((await registrations()).length,1);
 const stored=(await registrations())[0]!;assert.ok(!JSON.stringify(stored).includes(push));assert.notEqual(stored.token_hash,createHash('sha256').update(push).digest('hex'));
 assert.equal((await service.targets(a.membership))[0]!.token,push);
 assert.equal((await request(b.device,'PUT',push)).statusCode,409);
 assert.equal((await request(a.device,'PUT',push,{sessionId:b.device.id})).statusCode,400);
 assert.equal((await request(a2,'PUT',other)).statusCode,204);assert.equal((await registrations()).length,2);
 assert.equal((await request(a.device,'DELETE')).statusCode,204);assert.equal((await request(a.device,'DELETE')).statusCode,204);assert.equal((await registrations()).length,1);assert.equal((await registrations())[0].session_id,a2.id);
 assert.equal((await request(a.device,'PUT',other)).statusCode,204);assert.equal((await registrations()).length,1);assert.equal((await registrations())[0].session_id,a.device.id);
 assert.equal((await request(b.device,'DELETE')).statusCode,204);assert.equal((await registrations()).length,1);
 const auditBefore=Number((await pool.query("SELECT count(*) FROM auth_security_events WHERE action='push_device.registered'")).rows[0].count);
 await pool.query("CREATE FUNCTION reject_push_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit unavailable'; END $$");await pool.query("CREATE TRIGGER reject_push_audit_fixture BEFORE INSERT ON auth_security_events FOR EACH ROW WHEN (NEW.action='push_device.registered') EXECUTE FUNCTION reject_push_audit_fixture()");
 assert.equal((await request(a.device,'PUT',push)).statusCode,500);assert.equal((await service.targets(a.membership))[0]!.token,other);
 await pool.query('DROP TRIGGER reject_push_audit_fixture ON auth_security_events');await pool.query('DROP FUNCTION reject_push_audit_fixture()');
 assert.equal(Number((await pool.query("SELECT count(*) FROM auth_security_events WHERE action='push_device.registered'")).rows[0].count),auditBefore);
 const raced=token('race');assert.deepEqual((await Promise.all([request(a.device,'PUT',raced),request(a2,'PUT',raced)])).map(result=>result.statusCode),[204,204]);assert.equal((await registrations()).length,1);
 const bound=(await registrations())[0].session_id as string,current=bound===a.device.id?a.device:a2;
 await pool.query('INSERT INTO member_settings(membership_id,push_notifications) VALUES($1,true)',[a.membership]);
 const event=(await pool.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at,status) VALUES($1,'Push event','Example City',now()+interval '1 day',now()+interval '2 days','published') RETURNING id",[tribe])).rows[0].id as string;
 const sent:InformationalEnvelope[]=[];const worker=new NotificationDeliveryWorker(pool,key,{push:{send:async message=>{sent.push(message);return {status:'submitted',reference:'local-ticket'};}}});
 await notify(a.membership,event);assert.equal((await worker.run()).results.submitted,1);assert.equal(sent.length,1);assert.equal(sent[0]!.recipient.devices?.[0]!.token,raced);assert.deepEqual(Object.keys(sent[0]!.data).sort(),['notificationId','tribeId']);
 await notify(a.membership,event);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{authorization:'Bearer '+current.token}})).statusCode,204);
 assert.equal((await registrations()).length,0);assert.equal((await worker.run()).results.suppressed,1);assert.equal(sent.length,1);
 assert.equal((await request(current,'PUT',raced)).statusCode,401);
 assert.equal((await request(b.device,'PUT',raced)).statusCode,204);assert.equal((await registrations())[0].session_id,b.device.id);
 await pool.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[b.id]);assert.equal((await service.targets(b.membership)).length,0);assert.equal((await request(b.device,'DELETE')).statusCode,401);
 const c=await member();assert.equal((await request(c.device,'PUT',token('c'))).statusCode,204);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[c.id]);assert.equal((await service.targets(c.membership)).length,0);assert.equal((await request(c.device,'PUT',token('blocked'))).statusCode,401);
 const d=await member();await request(d.device,'PUT',token('d'));await pool.query("UPDATE device_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[d.device.id]);assert.equal((await service.targets(d.membership)).length,0);assert.equal((await request(d.device,'DELETE')).statusCode,401);
 const e=await member(),f=await member(),foreignRace=token('foreign-race');assert.deepEqual((await Promise.all([request(e.device,'PUT',foreignRace),request(f.device,'PUT',foreignRace)])).map(result=>result.statusCode).sort(),[204,409]);
 const g=await member();await pool.query("UPDATE tribe_memberships SET role='owner' WHERE id=$1",[g.membership]);await pool.query('UPDATE device_sessions SET mfa_verified_at=NULL WHERE id=$1',[g.device.id]);assert.equal((await request(g.device,'PUT',token('missing-mfa'))).statusCode,401);
 const h=await member(),h2=await device(h.id);await request(h.device,'PUT',token('logout-all-a'));await request(h2,'PUT',token('logout-all-b'));
 assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout-all',headers:{authorization:'Bearer '+h.device.token}})).statusCode,204);assert.equal((await service.targets(h.membership)).length,0);assert.equal(Number((await pool.query('SELECT count(*) FROM push_device_registrations WHERE session_id=ANY($1::uuid[])',[[h.device.id,h2.id]])).rows[0].count),0);
 const logs=JSON.stringify((await pool.query("SELECT * FROM auth_security_events WHERE action LIKE 'push_device.%'")).rows);for(const secret of [push,other,raced,a.device.token])assert.ok(!logs.includes(secret));
 console.log('PASS push registry strict owned-session routes, encrypted/HMAC token storage, safe dedup/rebind/conflict, idempotent unregister, atomic audit rollback, concurrent registration, and logout/revocation/stale-account/expiry worker suppression without external provider traffic');
} finally {await app.close();await pool.end();}
