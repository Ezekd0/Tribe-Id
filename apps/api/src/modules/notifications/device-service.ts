import {createHmac,hkdfSync} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {PushDeviceRegistrationRequest} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {SecretBox} from '../auth/crypto.js';
import {transaction,audit} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
export interface PushDeviceTarget {id:string;platform:'android'|'ios';token:string}
const invalid=()=>new ServiceError(400,'VALIDATION_FAILED','Provide an Expo token and supported platform only.');
export function normalizePushDevice(input:unknown):PushDeviceRegistrationRequest {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw invalid();
 const data=input as Record<string,unknown>;
 if(Object.keys(data).length!==3||Object.keys(data).some(key=>!['provider','platform','token'].includes(key))||data.provider!=='expo'||!['android','ios'].includes(data.platform as string)||typeof data.token!=='string'||data.token.length>256) throw invalid();
 // Expo's documented wrapper and SDK-supported UUID form; reject whitespace/control characters.
 if(!/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(data.token)&&!/^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(data.token)) throw invalid();
 return {provider:'expo',platform:data.platform as 'android'|'ios',token:data.token};
}
export class PushDeviceService {
 private readonly box:SecretBox;
 private readonly indexKey:Buffer;
 constructor(private readonly pool:Pool,key:string) {this.box=new SecretBox(key);this.indexKey=Buffer.from(hkdfSync('sha256',Buffer.from(key,'base64'),'trueda-push-device','token-index:v1',32));}
 private hash(token:string) {return createHmac('sha256',this.indexKey).update(token).digest('hex');}
 private async session(db:PoolClient,identity:SessionIdentity) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
  if(!(await db.query(`SELECT s.id FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rowCount) throw new ServiceError(401,'SESSION_REQUIRED','A valid device session is required.');
 }
 async register(identity:SessionIdentity,input:unknown,requestId='internal-push-registration') {
  const data=normalizePushDevice(input),hash=this.hash(data.token);
  try {await transaction(this.pool,async db=>{
   await this.session(db,identity);
   const existing=(await db.query<{session_id:string;user_id:string;live:boolean}>('SELECT d.session_id,s.user_id,s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AS live FROM push_device_registrations d JOIN device_sessions s ON s.id=d.session_id WHERE d.token_hash=$1 FOR UPDATE OF d',[hash])).rows[0];
   if(existing&&existing.user_id!==identity.userId&&existing.live) throw new ServiceError(409,'PUSH_TOKEN_UNAVAILABLE','This push token cannot be registered.');
   if(existing&&existing.session_id!==identity.sessionId) await db.query('DELETE FROM push_device_registrations WHERE token_hash=$1',[hash]);
   const current=(await db.query<{token_hash:string;platform:string}>('SELECT token_hash,platform FROM push_device_registrations WHERE session_id=$1',[identity.sessionId])).rows[0];
   if(current?.token_hash===hash&&current.platform===data.platform) return;
   if(!current) {
    const count=Number((await db.query<{count:string}>('SELECT count(*) FROM push_device_registrations d JOIN device_sessions s ON s.id=d.session_id WHERE s.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()',[identity.userId])).rows[0]!.count);
    if(count>=100) throw new ServiceError(409,'PUSH_DEVICE_LIMIT','Remove a registered device before adding another.');
   }
   const ciphertext=this.box.seal(data.token,'push-device-token:v1:'+identity.sessionId);
   await db.query("INSERT INTO push_device_registrations(session_id,provider,platform,token_hash,token_ciphertext) VALUES($1,'expo',$2,$3,$4) ON CONFLICT(session_id) DO UPDATE SET platform=EXCLUDED.platform,token_hash=EXCLUDED.token_hash,token_ciphertext=EXCLUDED.token_ciphertext,updated_at=clock_timestamp()",[identity.sessionId,data.platform,hash,ciphertext]);
   await audit(db,'push_device.registered','success',requestId,identity.userId);
  });} catch(error) {if(error&&typeof error==='object'&&'code' in error&&error.code==='23505') throw new ServiceError(409,'PUSH_TOKEN_UNAVAILABLE','This push token cannot be registered.');throw error;}
 }
 async unregister(identity:SessionIdentity,requestId='internal-push-unregistration') {await transaction(this.pool,async db=>{await this.session(db,identity);if((await db.query('DELETE FROM push_device_registrations WHERE session_id=$1',[identity.sessionId])).rowCount) await audit(db,'push_device.unregistered','success',requestId,identity.userId);});}
 async targets(membershipId:string):Promise<PushDeviceTarget[]> {
  const rows=(await this.pool.query<{id:string;platform:'android'|'ios';session_id:string;token_ciphertext:string}>(`SELECT d.id,d.platform,d.session_id,d.token_ciphertext FROM push_device_registrations d JOIN device_sessions s ON s.id=d.session_id JOIN users u ON u.id=s.user_id JOIN tribe_memberships m ON m.user_id=u.id
   WHERE m.id=$1 AND m.status='active' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} ORDER BY d.id LIMIT 100`,[membershipId])).rows;
  return rows.map(row=>({id:row.id,platform:row.platform,token:this.box.open(row.token_ciphertext,'push-device-token:v1:'+row.session_id)}));
 }
}
