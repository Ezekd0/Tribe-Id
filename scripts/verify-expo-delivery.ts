import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createServer} from 'node:net';
import {InformationalEmailTransport} from '../apps/api/src/modules/notifications/email-delivery.js';
import {ExpoProvider} from '../apps/api/src/modules/notifications/expo-provider.js';
import {ExpoPushTransport} from '../apps/api/src/modules/notifications/expo-delivery.js';
import {PushDeviceService} from '../apps/api/src/modules/notifications/device-service.js';
import {NotificationDeliveryWorker} from '../apps/api/src/modules/notifications/delivery.js';
import {SecretBox} from '../apps/api/src/modules/auth/crypto.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true')throw new Error('Explicit disposable database required');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),key=randomBytes(32).toString('base64');
try{
 const user=randomUUID(),tribe=randomUUID(),event=randomUUID(),notification=randomUUID(),job=randomUUID(),announcement=randomUUID();
 await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[tribe,'Expo fixture',tribe]);
 await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture',now())",[user,user+'@example.invalid']);
 const member=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[tribe,user,user])).rows[0].id;
 const sessions:string[]=[];for(let index=0;index<2;index++)sessions.push((await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'fixture') RETURNING id",[user])).rows[0].id);
 const devices=new PushDeviceService(pool,key);for(let index=0;index<2;index++)await devices.register({userId:user,sessionId:sessions[index]!,email:user+'@example.invalid'},{provider:'expo',platform:'android',token:'ExpoPushToken[fixture'+index+']'});
 await pool.query('INSERT INTO member_settings(membership_id,push_notifications) VALUES($1,true)',[member]);
 await pool.query("INSERT INTO announcements(id,tribe_id,author_membership_id,title,body,category,status,published_at) VALUES($1,$2,$3,'fixture','fixture','general','published',now())",[announcement,tribe,member]);
 await pool.query("INSERT INTO notification_events(id,tribe_id,kind,resource_type,resource_id) VALUES($1,$2,'announcement.published','announcement',$3)",[event,tribe,announcement]);
 await pool.query("INSERT INTO notifications(id,membership_id,title,body,source_event_id,source_type,source_id) VALUES($1,$2,'fixture','fixture',$3,'announcement',$4)",[notification,member,event,announcement]);
 await pool.query("INSERT INTO notification_delivery_jobs(id,notification_id,membership_id,tribe_id,channel,payload_ciphertext) VALUES($1,$2,$3,$4,'push',$5)",[job,notification,member,tribe,new SecretBox(key).seal(JSON.stringify({notificationId:notification,tribeId:tribe}),'informational-notification:v1')]);
 let calls=0;let receiptMode='ok';const sent:string[][]=[];
 const provider=new ExpoProvider('fixture-only',async(url,options)=>{const payload=JSON.parse(options!.body as string);if(String(url).endsWith('/send')){calls++;sent.push(payload.map((row:{to:string})=>row.to));assert.ok(!JSON.stringify(payload).includes('email'));return Response.json({data:payload.map((_:unknown,index:number)=>calls===1&&index===1?{status:'error',details:{error:'MessageRateExceeded'}}:{status:'ok',id:'ticket-'+calls+'-'+index})});}if(receiptMode==='stale'){await pool.query("UPDATE push_delivery_attempts SET lease_until=now()-interval '1 second' WHERE job_id=$1",[job]);return Response.json({data:Object.fromEntries(payload.ids.map((id:string)=>[id,{status:'error',details:{error:'MessageRateExceeded'}}]))});}if(receiptMode==='malformed')return Response.json({data:Object.fromEntries(payload.ids.map((id:string)=>[id,{status:'error',details:{error:'UnexpectedSecretProviderError'}}]))});if(receiptMode==='missing')return Response.json({data:{}});return Response.json({data:Object.fromEntries(payload.ids.map((id:string)=>[id,receiptMode==='ok'?{status:'ok'}:{status:'error',details:{error:receiptMode==='retry'?'MessageRateExceeded':'DeviceNotRegistered'}}]))});});
 const transport=new ExpoPushTransport(pool,provider,key),worker=new NotificationDeliveryWorker(pool,key,{push:transport});
 assert.equal((await worker.run()).results.retry,1);assert.equal(calls,1);assert.equal((await worker.run()).claimed,0);
 await pool.query("UPDATE notification_delivery_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[job]);await pool.query("UPDATE push_delivery_attempts SET next_attempt_at=now()-interval '1 second' WHERE status='retry_scheduled'");
 assert.equal((await worker.run()).results.submitted,1);assert.equal(calls,2);assert.equal(sent[1]!.length,1);assert.notEqual(sent[0]![0],sent[1]![0]);
 await pool.query("UPDATE push_delivery_attempts SET next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);assert.equal((await transport.receipts()).checked,2);
 assert.equal(Number((await pool.query("SELECT count(*) FROM push_delivery_attempts WHERE status='provider_handoff'")).rows[0].count),2);
 assert.equal((await pool.query('SELECT status FROM notification_delivery_jobs WHERE id=$1',[job])).rows[0].status,'submitted');assert.equal((await worker.run()).claimed,0);
 // Definitive transient receipts requeue both devices, while accepted handoff remains a distinct state.
 await pool.query("UPDATE push_delivery_attempts SET status='provider_accepted',next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);receiptMode='retry';await transport.receipts();
 assert.equal(Number((await pool.query("SELECT count(*) FROM push_delivery_attempts WHERE status='retry_scheduled'")).rows[0].count),2);
 assert.equal((await pool.query('SELECT status FROM notification_delivery_jobs WHERE id=$1',[job])).rows[0].status,'pending');
 await pool.query("UPDATE notification_delivery_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[job]);await pool.query("UPDATE push_delivery_attempts SET next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);
 assert.equal((await worker.run()).results.submitted,1);assert.equal(calls,3);
 // A response arriving after its receipt lease cannot requeue or alter the parent job.
 await pool.query("UPDATE push_delivery_attempts SET status='provider_accepted',accepted_at=now(),next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);receiptMode='stale';await transport.receipts();assert.equal((await pool.query('SELECT status FROM notification_delivery_jobs WHERE id=$1',[job])).rows[0].status,'submitted');
 // Malformed/unknown receipt errors cannot justify resending an accepted push.
 await pool.query("UPDATE push_delivery_attempts SET status='provider_accepted',accepted_at=now(),next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);receiptMode='malformed';await transport.receipts();assert.equal(calls,3);assert.equal((await pool.query('SELECT status FROM notification_delivery_jobs WHERE id=$1',[job])).rows[0].status,'submitted');
 // Missing receipts never resend an accepted push, and expire as unknown rather than delivered.
 await pool.query("UPDATE push_delivery_attempts SET status='provider_accepted',accepted_at=now(),next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);receiptMode='missing';await transport.receipts();assert.equal(calls,3);
 assert.equal(Number((await pool.query("SELECT count(*) FROM push_delivery_attempts WHERE status='provider_accepted'")).rows[0].count),2);
 await pool.query("UPDATE push_delivery_attempts SET accepted_at=now()-interval '24 hours',next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);await transport.receipts();
 assert.equal(Number((await pool.query("SELECT count(*) FROM push_delivery_attempts WHERE status='receipt_unknown'")).rows[0].count),2);
 // Refresh one token before the old negative receipt: the refreshed generation must survive.
 await devices.register({userId:user,sessionId:sessions[0]!,email:user+'@example.invalid'},{provider:'expo',platform:'android',token:'ExpoPushToken[refreshed]'});
 // Negative receipt disables only the matching token generation; no provider text is stored.
 await pool.query("UPDATE push_delivery_attempts SET status='provider_accepted',next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[job]);receiptMode='invalid';const concurrent=await Promise.all([transport.receipts(),transport.receipts()]);assert.equal(concurrent.reduce((sum,result)=>sum+result.checked,0),2);assert.equal((await devices.targets(member)).length,1);assert.equal((await devices.targets(member))[0]!.token,'ExpoPushToken[refreshed]');
 assert.ok(!(JSON.stringify((await pool.query('SELECT * FROM push_delivery_attempts')).rows)).includes('ExpoPushToken'));
 assert.deepEqual((await transport.metrics()).map(row=>row.status),['provider_rejected']);
 // Real loopback SMTP transport, synthetic address only; no external delivery.
 const captured:string[]=[];const smtp=createServer(socket=>{socket.write('220 localhost QA SMTP\r\n');let buffer='',message='',data=false;socket.on('data',chunk=>{buffer+=chunk.toString();let end:number;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(data){if(line==='.'){captured.push(message);message='';data=false;socket.write('250 accepted\r\n');}else message+=line+'\r\n';}else if(/^EHLO|^HELO/i.test(line))socket.write('250 localhost\r\n');else if(/^DATA/i.test(line)){data=true;socket.write('354 send data\r\n');}else if(/^QUIT/i.test(line))socket.end('221 goodbye\r\n');else socket.write('250 OK\r\n');}});});
 await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));
 try{const address=smtp.address();assert.ok(address&&typeof address!=='string');const email=new InformationalEmailTransport({encryptionKey:key,rateLimitKey:key,mailFrom:'Tribe <notifications@example.invalid>',smtpUrl:'smtp://127.0.0.1:'+address.port,mailMode:'local-capture'});
  const envelope={idempotencyKey:job,recipient:{membershipId:member,email:'fixture@example.invalid'},title:'Private title',body:'Private body',data:{notificationId:notification,tribeId:tribe}};
  assert.equal((await email.send(envelope,new AbortController().signal)).status,'submitted');assert.equal(captured.length,1);assert.match(captured[0]!,/You have a Tribe notification/);assert.match(captured[0]!,new RegExp('Message-ID: <tribe-'+job+'@example.invalid>','i'));assert.ok(!captured[0]!.includes('Private'));
 }finally{await new Promise<void>(resolve=>smtp.close(()=>resolve()));}
 console.log('PASS informational email real loopback SMTP acceptance, generic copy and deterministic Message-ID; acceptance is not confirmed mailbox delivery');
 console.log('PASS Expo device-level partial retry/deduplication, receipt handoff distinct from delivered, missing/expired receipts, concurrent receipt fencing, generation-safe invalid-token retirement, secret-free bounded metrics; no external network');
}finally{await pool.end();}
