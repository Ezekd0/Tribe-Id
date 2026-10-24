import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {NotificationPublisher} from '../apps/api/src/modules/notifications/publisher.js';
import {NotificationDeliveryWorker,type InformationalEnvelope} from '../apps/api/src/modules/notifications/delivery.js';
import {AnnouncementManagementService} from '../apps/api/src/modules/announcements/service.js';
import {EventManagementService} from '../apps/api/src/modules/events/admin-service.js';
import {EventRegistrationService} from '../apps/api/src/modules/events/service.js';
import {transaction} from '../apps/api/src/modules/auth/support.js';
import {SecretBox} from '../apps/api/src/modules/auth/crypto.js';
import {PushDeviceService} from '../apps/api/src/modules/notifications/device-service.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:12,statement_timeout:10000}),key=randomBytes(32).toString('base64'),publisher=new NotificationPublisher(key);
const announcements=new AnnouncementManagementService(pool,publisher),events=new EventManagementService(pool,publisher),registration=new EventRegistrationService(pool,publisher);
const tribe=randomUUID(),foreignTribe=randomUUID();
async function member(scope:string,role='member',status='active',enabled=true,verified=true) {
 const id=randomUUID();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at,account_status) VALUES($1,$2,'fixture-only',CASE WHEN $3 THEN now() END,$4)",[id,id+'@example.invalid',verified,enabled?'enabled':'disabled']);
 const membership=(await pool.query('INSERT INTO tribe_memberships(tribe_id,user_id,member_number,role,status) VALUES($1,$2,$3,$4,$5) RETURNING id',[scope,id,id,role,status])).rows[0].id as string;
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name,mfa_verified_at) VALUES($1,'notification fixture',now()) RETURNING id",[id])).rows[0].id as string;
 return {membership,identity:{userId:id,sessionId:session,email:id+'@example.invalid'}};
}
type Member=Awaited<ReturnType<typeof member>>;
async function preference(member:Member,email:boolean,push:boolean,consent=email) {await pool.query('INSERT INTO member_settings(membership_id,email_notifications,push_notifications,informational_email_consent_at) VALUES($1,$2,$3,CASE WHEN $4 THEN now() END) ON CONFLICT(membership_id) DO UPDATE SET email_notifications=$2,push_notifications=$3,informational_email_consent_at=CASE WHEN $4 THEN now() END',[member.membership,email,push,consent]);}
async function draft(actor:Member,title='Private event title') {return (await announcements.change(actor.identity,tribe,'create',undefined,{title,body:'Private announcement body',category:'general'})).announcement.id;}
async function count(table:'notifications'|'notification_events'|'notification_delivery_jobs',where='',values:unknown[]=[]) {return Number((await pool.query(`SELECT count(*) FROM ${table} ${where}`,values)).rows[0].count);}
async function audience(kind:string,resourceId:string) {return (await pool.query<{membership_id:string}>('SELECT n.membership_id FROM notifications n JOIN notification_events e ON e.id=n.source_event_id WHERE e.kind=$1 AND e.resource_id=$2 ORDER BY n.membership_id',[kind,resourceId])).rows.map(row=>row.membership_id);}
async function bounded<T>(operation:Promise<T>):Promise<T> {let timer:ReturnType<typeof setTimeout>|undefined;try {return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Concurrent publisher timed out')),15000);})]);} finally {if(timer)clearTimeout(timer);}}
try {
 for(const id of [tribe,foreignTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Notification fixture',id]);
 const owner=await member(tribe,'owner'),admin=await member(tribe,'administrator'),a=await member(tribe),b=await member(tribe),attended=await member(tribe);
 const excluded=[await member(tribe,'member','suspended'),await member(tribe,'member','active',false),await member(tribe,'member','active',true,false),await member(foreignTribe)];
 await preference(a,true,true);await preference(b,true,false,false);await preference(attended,false,true);
 const expected=[owner,admin,a,b,attended].map(member=>member.membership).sort();
 const announcement=await draft(owner);
 await bounded(Promise.all([announcements.change(owner.identity,tribe,'publish',announcement),announcements.change(admin.identity,tribe,'publish',announcement)]));
 assert.deepEqual(await audience('announcement.published',announcement),expected);
 assert.equal(await count('notification_events'),1);assert.equal(await count('notification_delivery_jobs'),3);
 await announcements.change(owner.identity,tribe,'edit',announcement,{title:'Edited announcement'});assert.equal(await count('notification_events'),1);
 assert.equal(await count('notifications','WHERE membership_id=ANY($1::uuid[])',[excluded.map(member=>member.membership)]),0);
 const ciphertext=(await pool.query('SELECT payload_ciphertext FROM notification_delivery_jobs LIMIT 1')).rows[0].payload_ciphertext as string;
 const payload=JSON.parse(new SecretBox(key).open(ciphertext,'informational-notification:v1'));
 assert.deepEqual(Object.keys(payload).sort(),['notificationId','tribeId']);assert.ok(!ciphertext.includes('Private announcement body'));
 const duplicateEvent=randomUUID();
 await transaction(pool,async db=>{const event={id:duplicateEvent,tribeId:tribe,kind:'announcement.published' as const,resourceId:announcement,title:'Duplicate-proof'};await publisher.publish(db,event);await publisher.publish(db,event);});
 assert.equal(await count('notifications','WHERE source_event_id=$1',[duplicateEvent]),5);
 const left=await draft(owner,'Concurrent left'),right=await draft(admin,'Concurrent right');
 await bounded(Promise.all([announcements.change(owner.identity,tribe,'publish',left),announcements.change(admin.identity,tribe,'publish',right)]));
 assert.deepEqual(await audience('announcement.published',left),expected);assert.deepEqual(await audience('announcement.published',right),expected);
 const missing=await draft(owner),before=await count('notification_events');
 await assert.rejects(new AnnouncementManagementService(pool).change(owner.identity,tribe,'publish',missing),{statusCode:503,code:'NOTIFICATION_DELIVERY_UNAVAILABLE'});
 assert.equal((await pool.query('SELECT status FROM announcements WHERE id=$1',[missing])).rows[0].status,'draft');assert.equal(await count('notification_events'),before);
 const fresh=await draft(owner);
 await pool.query("CREATE FUNCTION reject_notification_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Notification unavailable'; END $$");await pool.query('CREATE TRIGGER reject_notification_fixture BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_notification_fixture()');
 await assert.rejects(announcements.change(owner.identity,tribe,'publish',fresh));
 assert.equal((await pool.query('SELECT status FROM announcements WHERE id=$1',[fresh])).rows[0].status,'draft');assert.equal(await count('notification_events'),before);
 assert.equal(Number((await pool.query("SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='announcement.published'",[fresh])).rows[0].count),0);
 await pool.query('DROP TRIGGER reject_notification_fixture ON notifications');await pool.query('DROP FUNCTION reject_notification_fixture()');
 const event=(await events.create(owner.identity,tribe,{title:'Registered event',description:'Private detail',location:'Example City',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),timezone:'Africa/Lagos',capacity:null})).eventId;
 await events.transition(owner.identity,tribe,event,'publish');assert.deepEqual(await audience('event.published',event),expected);
 await registration.change(a.identity,tribe,event,'register');await registration.change(a.identity,tribe,event,'register');assert.deepEqual(await audience('registration.registered',event),[a.membership]);
 await pool.query("INSERT INTO event_registrations(event_id,tribe_id,membership_id,status) VALUES($1,$2,$3,'attended')",[event,tribe,attended.membership]);
 await events.edit(owner.identity,tribe,event,{location:'Example Updated City'});assert.deepEqual(await audience('event.updated',event),[a.membership,attended.membership].sort());
 const afterEdit=await count('notification_events');await events.edit(owner.identity,tribe,event,{location:'Example Updated City'});assert.equal(await count('notification_events'),afterEdit);
 await registration.change(a.identity,tribe,event,'cancel');await registration.change(a.identity,tribe,event,'cancel');assert.deepEqual(await audience('registration.cancelled',event),[a.membership]);
 await events.transition(owner.identity,tribe,event,'cancel');await events.transition(owner.identity,tribe,event,'cancel');assert.deepEqual(await audience('event.cancelled',event),[attended.membership]);
 const cancelled=(await pool.query("SELECT n.body FROM notifications n JOIN notification_events e ON e.id=n.source_event_id WHERE e.resource_id=$1 AND e.kind='event.cancelled'",[event])).rows[0].body as string;assert.match(cancelled,/event.*cancelled/);
 console.log('PASS atomic notification audiences, idempotent publication/registration, distinct cancellation copy, consent defaults, encrypted payloads and concurrent broadcasts without crossed membership deadlocks');
 // Exercise delivery in a controlled job set; no adapters access any network.
 const deviceService=new PushDeviceService(pool,key);
 for(const recipient of [a,attended]) await deviceService.register(recipient.identity,{provider:'expo',platform:'android',token:'ExpoPushToken['+randomUUID()+']'});
 await pool.query("UPDATE notification_delivery_jobs SET status='suppressed',payload_ciphertext=NULL WHERE status='pending'");
 const workerSource=await draft(owner,'Never included in external payload');await announcements.change(owner.identity,tribe,'publish',workerSource);
 const delivered:InformationalEnvelope[]=[];
 const worker=new NotificationDeliveryWorker(pool,key,{email:{send:async message=>{delivered.push(message);return {status:'delivered'};}},push:{send:async message=>{delivered.push(message);return {status:'submitted',reference:'local-ticket-'+message.idempotencyKey};}}});
 assert.equal((await worker.run()).claimed,3);assert.equal(delivered.length,3);
 for(const message of delivered) {assert.deepEqual(Object.keys(message.data).sort(),['notificationId','tribeId']);assert.equal(message.title,'Tribe ID update');assert.ok(!JSON.stringify(message).includes('Never included'));assert.ok(!JSON.stringify(message).includes('Private detail'));}
 assert.equal(await count('notification_delivery_jobs',"WHERE status='delivered'"),1);assert.equal(await count('notification_delivery_jobs',"WHERE status='submitted'"),2);
 assert.equal(await count('notification_delivery_jobs',"WHERE status IN ('delivered','submitted') AND payload_ciphertext IS NOT NULL"),0);
 assert.equal((await worker.run()).claimed,0);
 const withdrawal=await draft(owner);await announcements.change(owner.identity,tribe,'publish',withdrawal);await preference(a,false,false);await preference(attended,false,false);
 const withdrawalResult=await worker.run();assert.equal(withdrawalResult.results.suppressed,3);assert.equal(delivered.length,3);
 await preference(a,true,false);
 const retrySource=await draft(owner);await announcements.change(owner.identity,tribe,'publish',retrySource);
 const failing=new NotificationDeliveryWorker(pool,key,{email:{send:async()=>{throw new Error('Sensitive provider text must never persist');}}});
 assert.equal((await failing.run()).results.retry,1);
 const retryJob=(await pool.query("SELECT id,attempts,last_error,next_attempt_at>clock_timestamp() AS delayed FROM notification_delivery_jobs WHERE status='pending'")).rows[0];assert.equal(retryJob.attempts,1);assert.equal(retryJob.last_error,'transport');assert.equal(retryJob.delayed,true);
 await pool.query("UPDATE notification_delivery_jobs SET attempts=7,next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[retryJob.id]);
 assert.equal((await failing.run()).results.failed,1);assert.equal((await pool.query('SELECT payload_ciphertext FROM notification_delivery_jobs WHERE id=$1',[retryJob.id])).rows[0].payload_ciphertext,null);
 const leaseSource=await draft(owner);await announcements.change(owner.identity,tribe,'publish',leaseSource);
 const [oldLease]=await worker.claim(1);assert.ok(oldLease);
 await pool.query("UPDATE notification_delivery_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[oldLease.id]);
 const [newLease]=await worker.claim(1);assert.ok(newLease);assert.equal(oldLease.id,newLease.id);assert.notEqual(oldLease.lease_token,newLease.lease_token);
 assert.equal(await worker.process(oldLease),'stale');assert.equal(await worker.process(newLease),'delivered');
 const raceSource=await draft(owner);await announcements.change(owner.identity,tribe,'publish',raceSource);
 const claimRace=await Promise.all([worker.claim(1),worker.claim(1)]);assert.equal(claimRace.flat().length,1);
 const raced=claimRace.flat()[0]!;await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[a.membership]);assert.equal(await worker.process(raced),'suppressed');
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 const corruptSource=await draft(owner);await announcements.change(owner.identity,tribe,'publish',corruptSource);
 const [corrupted]=await worker.claim(1);assert.ok(corrupted);corrupted.payload_ciphertext='invalid';assert.equal(await worker.process(corrupted),'failed');
 await preference(a,false,true);const pushSource=await draft(owner);await announcements.change(owner.identity,tribe,'publish',pushSource);
 const emailOnly=new NotificationDeliveryWorker(pool,key,{email:{send:async()=>({status:'delivered'})}});assert.equal((await emailOnly.run()).claimed,0);assert.equal(await count('notification_delivery_jobs',"WHERE status='pending' AND channel='push'"),1);
 console.log('PASS local injected informational transports, submitted-not-delivered push, no external content/traffic, opt-out suppression, bounded retry exhaustion, expired lease fencing, concurrent claims and absent-push-adapter pending state');
} finally {await pool.end();}
