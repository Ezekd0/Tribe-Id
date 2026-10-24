import type {Pool,PoolClient} from 'pg';
import type {MemberPreferences,MemberPreferencesUpdate} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {transaction} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
const fields=['emailNotifications','pushNotifications','profileVisibility'] as const;
export function normalizePreferences(input:unknown):MemberPreferencesUpdate {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw new ServiceError(400,'VALIDATION_FAILED','Provide at least one supported preference.');
 const data=input as Record<string,unknown>,keys=Object.keys(data);
 if(!keys.length||keys.some(key=>!fields.includes(key as typeof fields[number]))) throw new ServiceError(400,'VALIDATION_FAILED','Only email notifications, push notifications, and profile visibility can be changed.');
 const result:MemberPreferencesUpdate={};
 for(const field of fields) if(Object.hasOwn(data,field)) {
  const value=data[field];
  if(field==='profileVisibility') {if(value!=='private'&&value!=='tribe') throw new ServiceError(400,'VALIDATION_FAILED','Profile visibility must be private or tribe.');result.profileVisibility=value;}
  else {if(typeof value!=='boolean') throw new ServiceError(400,'VALIDATION_FAILED','Notification preferences must be true or false.');result[field]=value;}
 }
 return result;
}
export async function lockLivePreferenceSession(db:PoolClient,identity:SessionIdentity) {
 await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
 if(!(await db.query(`SELECT s.id FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rowCount) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
}
export class MemberPreferencesService {
 constructor(private readonly pool:Pool) {}
 private async membership(db:PoolClient,identity:SessionIdentity,tribeId:string) {
  await lockLivePreferenceSession(db,identity);
  const id=(await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0]?.id;
  if(!id) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');return id;
 }
 private async read(db:PoolClient,membershipId:string):Promise<MemberPreferences> {
  return (await db.query<MemberPreferences>(`SELECT (email_notifications AND informational_email_consent_at IS NOT NULL) AS "emailNotifications",push_notifications AS "pushNotifications",
   CASE WHEN profile_visibility='tribe' AND profile_sharing_consent_at IS NOT NULL THEN 'tribe' ELSE 'private' END AS "profileVisibility" FROM member_settings WHERE membership_id=$1`,[membershipId])).rows[0]??{emailNotifications:false,pushNotifications:false,profileVisibility:'private'};
 }
 async get(identity:SessionIdentity,tribeId:string) {return transaction(this.pool,async db=>this.read(db,await this.membership(db,identity,tribeId)));}
 async update(identity:SessionIdentity,tribeId:string,input:unknown) {
  const data=normalizePreferences(input);
  return transaction(this.pool,async db=>{
   const membershipId=await this.membership(db,identity,tribeId);
   await db.query('INSERT INTO member_settings(membership_id) VALUES($1) ON CONFLICT(membership_id) DO NOTHING',[membershipId]);
   const names=fields.filter(field=>Object.hasOwn(data,field)),columns={emailNotifications:'email_notifications',pushNotifications:'push_notifications',profileVisibility:'profile_visibility'};
   const clauses=names.map((field,index)=>`${columns[field]}=$${index+2}`);
   if(Object.hasOwn(data,'emailNotifications')) clauses.push(`informational_email_consent_at=CASE WHEN $${names.indexOf('emailNotifications')+2} THEN clock_timestamp() END`);
   if(Object.hasOwn(data,'profileVisibility')) clauses.push(`profile_sharing_consent_at=CASE WHEN $${names.indexOf('profileVisibility')+2}='tribe' THEN clock_timestamp() END`);
   await db.query(`UPDATE member_settings SET ${clauses.join(',')},updated_at=clock_timestamp() WHERE membership_id=$1`,[membershipId,...names.map(field=>data[field])]);
   await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'preferences.updated','membership',$3,$4::jsonb)",[tribeId,identity.userId,membershipId,JSON.stringify({changedFields:names})]);
   return this.read(db,membershipId);
  });
 }
}
