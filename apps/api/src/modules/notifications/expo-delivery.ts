import {randomUUID,createHmac,hkdfSync} from 'node:crypto';
import type {Pool} from 'pg';
import {SecretBox} from '../auth/crypto.js';
import type {InformationalEnvelope,InformationalTransport,InformationalResult} from './delivery.js';
import {ExpoProvider,ExpoRequestError,type ExpoOutcome,type ExpoError} from './expo-provider.js';
interface Attempt {id:string;device_id:string;token_hash:string;attempts:number;ticket_id:string|null;lease_token:string;accepted_at:Date|null;receipt_attempts:number;notification_id?:string;tribe_id?:string;job_id:string}
/** Device-level durable deduplication. Provider timeouts remain explicitly at-least-once. */
export class ExpoPushTransport implements InformationalTransport {
 private hash(token:string){return createHmac('sha256',Buffer.from(hkdfSync('sha256',Buffer.from(this.key,'base64'),'trueda-push-device','token-index:v1',32))).update(token).digest('hex');}
 constructor(private readonly pool:Pool,private readonly provider:ExpoProvider,private readonly key:string){}
 async send(message:InformationalEnvelope,signal:AbortSignal):Promise<InformationalResult> {
  const devices=message.recipient.devices??[];
  for(const device of devices)await this.pool.query(`INSERT INTO push_delivery_attempts(job_id,device_id,token_hash)
   SELECT $1,d.id,d.token_hash FROM push_device_registrations d WHERE d.id=$2 AND d.token_hash=$3 ON CONFLICT(job_id,device_id) DO NOTHING`,[message.idempotencyKey,device.id,this.hash(device.token)]);
  // Never resend accepted devices when another device failed or a parent lease was reclaimed.
  const lease=randomUUID();
  const rows=(await this.pool.query<Attempt>(`UPDATE push_delivery_attempts SET status='attempted',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
   WHERE job_id=$1 AND attempts<8 AND next_attempt_at<=clock_timestamp() AND (status IN ('queued','retry_scheduled') OR(status='attempted' AND lease_until<=clock_timestamp())) RETURNING *`,[message.idempotencyKey,lease])).rows;
  const eligible:Attempt[]=[];const tokens:string[]=[];
  for(const row of rows){const target=devices.find(device=>device.id===row.device_id);const current=await this.pool.query('SELECT id FROM push_device_registrations WHERE id=$1 AND token_hash=$2 AND EXISTS(SELECT 1 FROM push_delivery_attempts p WHERE p.id=$3 AND p.lease_token=$4 AND p.lease_until>clock_timestamp())',[row.device_id,row.token_hash,row.id,row.lease_token]);
   if(!target||!current.rowCount||this.hash(target.token)!==row.token_hash){await this.set(row,'suppressed','unavailable');continue;}eligible.push(row);tokens.push(target.token);}
  if(eligible.length){let outcomes:ExpoOutcome[];
   try{outcomes=await this.provider.send(tokens.map(to=>({to,data:message.data})),signal);}catch(error){const known=error instanceof ExpoRequestError?error:new ExpoRequestError('transport',true);outcomes=eligible.map(()=>({status:'rejected',code:known.code,retry:known.retry}));}
   for(let index=0;index<eligible.length;index++){const row=eligible[index]!,result=outcomes[index]!;
    if(result.status==='accepted')await this.set(row,'provider_accepted',null,result.id);
    else {if(result.code==='DeviceNotRegistered')await this.invalidate(row);await this.set(row,result.retry&&row.attempts<8?'retry_scheduled':result.retry?'permanently_failed':'provider_rejected',result.code);}
   }
  }
  await this.pool.query("UPDATE push_delivery_attempts SET status='permanently_failed',lease_token=NULL,lease_until=NULL,error_code='transport',updated_at=clock_timestamp() WHERE job_id=$1 AND attempts>=8 AND status='attempted' AND lease_until<=clock_timestamp()",[message.idempotencyKey]);
  const states=(await this.pool.query<{status:string}>('SELECT status FROM push_delivery_attempts WHERE job_id=$1',[message.idempotencyKey])).rows;
  if(states.some(row=>['queued','attempted','retry_scheduled'].includes(row.status)))throw new Error('Push retry pending');
  return states.some(row=>['provider_accepted','provider_handoff','receipt_unknown'].includes(row.status))?{status:'submitted',reference:'expo:'+message.idempotencyKey}:{status:'failed'};
 }
 private async invalidate(row:Attempt){await this.pool.query('DELETE FROM push_device_registrations WHERE id=$1 AND token_hash=$2 AND EXISTS(SELECT 1 FROM push_delivery_attempts p WHERE p.id=$3 AND p.lease_token=$4 AND p.lease_until>clock_timestamp())',[row.device_id,row.token_hash,row.id,row.lease_token]);}
 private async set(row:Attempt,status:string,code:ExpoError|null,ticket:string|null=null){await this.pool.query(`UPDATE push_delivery_attempts SET status=$3,error_code=$4,ticket_id=$5,
  accepted_at=CASE WHEN $3='provider_accepted' THEN clock_timestamp() ELSE accepted_at END,
  next_attempt_at=clock_timestamp()+CASE WHEN $3='provider_accepted' THEN interval '15 minutes' ELSE least(3600,power(2,attempts)*30)*interval '1 second' END,
  lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,[row.id,row.lease_token,status,code,ticket]);}
 async receipts(limit=50){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Receipt batch must be 1–100');
  await this.pool.query(`UPDATE push_delivery_attempts p SET status=CASE WHEN j.status='suppressed' THEN 'suppressed' ELSE 'permanently_failed' END,error_code='unavailable',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() FROM notification_delivery_jobs j WHERE p.job_id=j.id AND j.status IN ('failed','suppressed') AND p.status IN ('queued','attempted','retry_scheduled') AND(p.lease_until IS NULL OR p.lease_until<=clock_timestamp())`);
  const lease=randomUUID();const rows=(await this.pool.query<Attempt>(`WITH due AS(SELECT id FROM push_delivery_attempts WHERE status='provider_accepted' AND next_attempt_at<=clock_timestamp() AND(lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $1)
   UPDATE push_delivery_attempts p SET lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',receipt_attempts=receipt_attempts+1 FROM due WHERE p.id=due.id RETURNING p.*`,[limit,lease])).rows;
  if(!rows.length)return {checked:0};
  let results:Record<string,'ok'|ExpoOutcome>={};
  try{results=await this.provider.receipts(rows.map(row=>row.ticket_id!),AbortSignal.timeout(10000));}catch{/* Safe aggregate retry, no raw provider data. */}
  for(const row of rows){const receipt=results[row.ticket_id!];
   if(receipt==='ok'){await this.set(row,'provider_handoff',null,row.ticket_id);continue;}
   if(receipt&&receipt.status==='rejected'&&!receipt.retry){if(receipt.code==='DeviceNotRegistered')await this.invalidate(row);await this.set(row,'provider_rejected',receipt.code,row.ticket_id);continue;}
   if(receipt&&receipt.status==='rejected'&&receipt.code==='MessageRateExceeded'){
    // A definitive negative receipt may be retried; a missing receipt must never trigger a resend.
    const parent=(await this.pool.query<{notification_id:string;tribe_id:string}>('SELECT notification_id,tribe_id FROM notification_delivery_jobs WHERE id=$1',[row.job_id])).rows[0];
    if(parent&&row.attempts<8){const payload=new SecretBox(this.key).seal(JSON.stringify({notificationId:parent.notification_id,tribeId:parent.tribe_id}),'informational-notification:v1');
     await this.pool.query(`WITH eligible AS MATERIALIZED(SELECT id FROM push_delivery_attempts WHERE id=$2 AND lease_token=$5 AND lease_until>clock_timestamp() FOR UPDATE),resumed AS(UPDATE notification_delivery_jobs SET status='pending',lease_token=NULL,lease_until=NULL,payload_ciphertext=$3,next_attempt_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE id=$1 AND status IN ('submitted','pending','leased') AND attempts<8 AND EXISTS(SELECT 1 FROM eligible) AND EXISTS(SELECT 1 FROM push_delivery_attempts p WHERE p.id=$2 AND p.lease_token=$5 AND p.lease_until>clock_timestamp()) RETURNING id)
      UPDATE push_delivery_attempts SET status=CASE WHEN EXISTS(SELECT 1 FROM resumed) THEN 'retry_scheduled' ELSE 'permanently_failed' END,error_code=$4,ticket_id=NULL,next_attempt_at=clock_timestamp()+interval '2 minutes',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$2 AND lease_token=$5 AND lease_until>clock_timestamp()`,[row.job_id,row.id,payload,receipt.code,row.lease_token]);
    }else await this.set(row,'permanently_failed',receipt.code,row.ticket_id);
    continue;
   }
   // Missing receipts expire locally before Expo removes them at 24h. Never resend an accepted push merely because its receipt is missing.
   const expired=!row.accepted_at||Date.now()-row.accepted_at.getTime()>23*3600000;
   await this.pool.query(`UPDATE push_delivery_attempts SET status=$3,error_code=$4,next_attempt_at=clock_timestamp()+interval '15 minutes',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,[row.id,row.lease_token,expired?'receipt_unknown':'provider_accepted',expired?'receipt_expired':null]);
  }
  return {checked:rows.length};
 }
 async metrics(){return (await this.pool.query<{status:string;count:string;attempts:string;receipt_attempts:string;oldest_age_seconds:string}>("SELECT status,count(*)::text AS count,sum(attempts)::text AS attempts,sum(receipt_attempts)::text AS receipt_attempts,greatest(0,extract(epoch FROM(clock_timestamp()-min(created_at))))::bigint::text AS oldest_age_seconds FROM push_delivery_attempts GROUP BY status ORDER BY status")).rows;}
}
