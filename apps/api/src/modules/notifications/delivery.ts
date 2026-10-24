import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {SecretBox} from '../auth/crypto.js';
import {PushDeviceService,type PushDeviceTarget} from './device-service.js';
export type NotificationChannel='email'|'push';
export interface InformationalEnvelope {idempotencyKey:string;recipient:{membershipId:string;email?:string;devices?:PushDeviceTarget[]};title:string;body:string;data:{notificationId:string;tribeId:string}}
export type InformationalResult={status:'delivered'}|{status:'submitted';reference:string}|{status:'failed'};
/** Inject adapters explicitly. A push provider acceptance is submitted, not delivered. */
export interface InformationalTransport {send(message:InformationalEnvelope,signal:AbortSignal):Promise<InformationalResult>}
interface Job {id:string;notification_id:string;membership_id:string;tribe_id:string;channel:NotificationChannel;payload_ciphertext:string;attempts:number;lease_token:string}
export class NotificationDeliveryWorker {
 private readonly box:SecretBox;
 private readonly devices:PushDeviceService;
 constructor(private readonly pool:Pool,key:string,private readonly transports:Partial<Record<NotificationChannel,InformationalTransport>>) {this.box=new SecretBox(key);this.devices=new PushDeviceService(pool,key);}
 async claim(limit=50):Promise<Job[]> {
  if(!Number.isInteger(limit)||limit<1||limit>50) throw new Error('Notification batch must be 1–50');
  const channels=(['email','push'] as const).filter(channel=>this.transports[channel]);
  if(!channels.length) return [];
  // An eighth attempt abandoned by a crashed worker must become terminal too.
  await this.pool.query("UPDATE notification_delivery_jobs SET status='failed',payload_ciphertext=NULL,lease_token=NULL,lease_until=NULL,last_error='transport',updated_at=clock_timestamp() WHERE status='leased' AND lease_until<=clock_timestamp() AND attempts>=8");
  return (await this.pool.query<Job>(`WITH candidates AS (
   SELECT id FROM notification_delivery_jobs WHERE channel=ANY($1::text[]) AND attempts<8 AND ((status='pending' AND next_attempt_at<=clock_timestamp()) OR (status='leased' AND lease_until<=clock_timestamp()))
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
  ) UPDATE notification_delivery_jobs j SET status='leased',lease_token=$3,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=clock_timestamp() FROM candidates c WHERE j.id=c.id RETURNING j.*`,[channels,limit,randomUUID()])).rows;
 }
 private async finish(job:Job,status:'delivered'|'submitted'|'suppressed'|'retry'|'failed',error:string|null=null,reference:string|null=null) {
  const terminal=status!=='retry';
  return Boolean((await this.pool.query(`UPDATE notification_delivery_jobs SET status=$3,payload_ciphertext=CASE WHEN $4 THEN NULL ELSE payload_ciphertext END,
   next_attempt_at=clock_timestamp()+least(3600,power(2,attempts)*30)*interval '1 second',lease_token=NULL,lease_until=NULL,last_error=$5,submitted_reference=$6,updated_at=clock_timestamp()
   WHERE id=$1 AND status='leased' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.lease_token,status==='retry'?'pending':status,terminal,error,reference])).rowCount);
 }
 async process(job:Job) {
  const validLease=await this.pool.query("SELECT id FROM notification_delivery_jobs WHERE id=$1 AND status='leased' AND lease_token=$2 AND lease_until>clock_timestamp()",[job.id,job.lease_token]);
  if(!validLease.rowCount) return 'stale' as const;
  let data:{notificationId:string;tribeId:string};
  try {
   const decoded=JSON.parse(this.box.open(job.payload_ciphertext,'informational-notification:v1')) as Record<string,unknown>;
   if(!decoded||typeof decoded!=='object'||Object.keys(decoded).length!==2||decoded.notificationId!==job.notification_id||decoded.tribeId!==job.tribe_id) throw new Error('Invalid informational payload');
   data={notificationId:job.notification_id,tribeId:job.tribe_id};
  } catch {return await this.finish(job,'failed','payload')?'failed' as const:'stale' as const;}
  const recipient=(await this.pool.query<{email:string;email_consent:boolean;push_consent:boolean}>(`SELECT u.email,(COALESCE(s.email_notifications,false) AND s.informational_email_consent_at IS NOT NULL) AS email_consent,COALESCE(s.push_notifications,false) AS push_consent
   FROM notifications n JOIN notification_events e ON e.id=n.source_event_id JOIN tribe_memberships m ON m.id=n.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN member_settings s ON s.membership_id=m.id
   WHERE n.id=$1 AND m.id=$2 AND m.tribe_id=$3 AND e.tribe_id=$3 AND m.status='active' AND u.account_status='enabled' AND u.email_verified_at IS NOT NULL
   AND (e.resource_type<>'announcement' OR EXISTS(SELECT 1 FROM announcements a WHERE a.id=e.resource_id AND a.tribe_id=$3 AND a.status='published'))
   AND (e.resource_type<>'event' OR EXISTS(SELECT 1 FROM events v WHERE v.id=e.resource_id AND v.tribe_id=$3 AND (e.kind<>'event.published' OR v.status='published')))
   AND (e.kind NOT IN ('event.updated','event.cancelled') OR EXISTS(SELECT 1 FROM event_registrations r WHERE r.tribe_id=$3 AND r.event_id=e.resource_id AND r.membership_id=m.id AND r.status IN ('registered','attended')))`,[job.notification_id,job.membership_id,job.tribe_id])).rows[0];
  if(!recipient) return await this.finish(job,'suppressed','recipient_unavailable')?'suppressed' as const:'stale' as const;
  if(!(job.channel==='email'?recipient.email_consent:recipient.push_consent)) return await this.finish(job,'suppressed','consent_withdrawn')?'suppressed' as const:'stale' as const;
  let devices:PushDeviceTarget[]|undefined;
  if(job.channel==='push') {
   try {devices=await this.devices.targets(job.membership_id);} catch {return await this.finish(job,'failed','payload')?'failed' as const:'stale' as const;}
   if(!devices.length) return await this.finish(job,'suppressed','recipient_unavailable')?'suppressed' as const:'stale' as const;
  }
  const transport=this.transports[job.channel];
  if(!transport) throw new Error('Claim only configured transports');
  if(!(await this.pool.query("SELECT id FROM notification_delivery_jobs WHERE id=$1 AND status='leased' AND lease_token=$2 AND lease_until>clock_timestamp()",[job.id,job.lease_token])).rowCount) return 'stale' as const;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Transport timeout'));},10000);});
   const result=await Promise.race([transport.send({idempotencyKey:job.id,recipient:{membershipId:job.membership_id,...(job.channel==='email'?{email:recipient.email}:{devices:devices!})},title:'Tribe ID update',body:'Open Tribe ID to view your update.',data},controller.signal),timeout]);
   if(result.status!=='delivered'&&result.status!=='failed'&&(result.status!=='submitted'||typeof result.reference!=='string'||result.reference.length<1||result.reference.length>256)) throw new Error('Invalid transport acknowledgement');
   return await this.finish(job,result.status,null,result.status==='submitted'?result.reference:null)?result.status:'stale' as const;
  } catch {return await this.finish(job,job.attempts>=8?'failed':'retry','transport')?(job.attempts>=8?'failed':'retry'):'stale' as const;}
  finally {if(timer) clearTimeout(timer);}
 }
 async run(limit=50) {
  if(!Number.isInteger(limit)||limit<1||limit>50) throw new Error('Notification batch must be 1–50');
  let claimed=0;const results:Record<string,number>={};
  // Claim just before each bounded send so later jobs cannot lose leases while waiting in this process.
  while(claimed<limit) {const [job]=await this.claim(1);if(!job) break;claimed++;const result=await this.process(job);results[result]=(results[result]??0)+1;}
  return {claimed,results};
 }
}
