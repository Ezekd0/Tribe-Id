import type {Pool,PoolClient} from 'pg';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {transaction} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {AnnouncementRepository,type AnnouncementInput,type AnnouncementList,type AnnouncementStatus} from './repository.js';
import {NotificationPublisher} from '../notifications/publisher.js';
const invalid=()=>new ServiceError(400,'VALIDATION_FAILED','Provide only bounded announcement title, body and category fields.');
export function validateAnnouncement(input:unknown,partial=false):Partial<AnnouncementInput> {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw invalid();
 const value=input as Record<string,unknown>,keys=Object.keys(value);
 if(!keys.length||keys.some(key=>!['title','body','category'].includes(key))||!partial&&['title','body','category'].some(key=>!Object.hasOwn(value,key))) throw invalid();
 for(const [key,max] of [['title',200],['body',20000]] as const) if(Object.hasOwn(value,key)&&(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max)) throw invalid();
 if(Object.hasOwn(value,'category')&&!['important','event','general'].includes(value.category as string)) throw invalid();
 return value as Partial<AnnouncementInput>;
}
export function validateAnnouncementList(input:unknown):AnnouncementList {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw invalid();
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['limit','offset','status','search'].includes(key))) throw invalid();
 const result:AnnouncementList={limit:50,offset:0};
 for(const [key,min,max] of [['limit',1,100],['offset',0,10000]] as const) if(Object.hasOwn(value,key)) {
  const field=value[key];if(typeof field!=='string'||!/^\d+$/.test(field)||Number(field)<min||Number(field)>max) throw invalid();result[key]=Number(field);
 }
 if(Object.hasOwn(value,'status')) {if(typeof value.status!=='string'||!['draft','published','archived'].includes(value.status)) throw invalid();result.status=value.status as AnnouncementStatus;}
 if(Object.hasOwn(value,'search')) {if(typeof value.search!=='string'||value.search.length>200) throw invalid();result.search=value.search;}
 return result;
}
export class AnnouncementManagementService {
 constructor(private readonly pool:Pool,private readonly notifications=new NotificationPublisher(null)) {}
 private async authority(db:PoolClient,identity:SessionIdentity,tribeId:string) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
  const session=(await db.query<{mfa:boolean}>(`SELECT s.mfa_verified_at IS NOT NULL AS mfa FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rows[0];
  if(!session) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
  const membership=(await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE tribe_id=$1 AND user_id=$2 AND status='active' AND role IN ('owner','administrator') FOR NO KEY UPDATE",[tribeId,identity.userId])).rows[0];
  if(!membership||!session.mfa) throw new ServiceError(403,'AUTHORITY_REQUIRED','An authorized Tribe authority with MFA is required.');
  return membership.id;
 }
 async list(identity:SessionIdentity,tribeId:string,query:AnnouncementList) {
  return transaction(this.pool,async db=>{await this.authority(db,identity,tribeId);return {announcements:await new AnnouncementRepository(db).list(tribeId,query)};});
 }
 async change(identity:SessionIdentity,tribeId:string,operation:'create'|'edit'|'publish'|'archive',id?:string,input?:unknown) {
  const fields=operation==='create'||operation==='edit'?validateAnnouncement(input,operation==='edit'):undefined;
  return transaction(this.pool,async db=>{
   const author=await this.authority(db,identity,tribeId),repository=new AnnouncementRepository(db);
   let announcement;
   if(operation==='create') announcement=await repository.create(tribeId,author,fields as AnnouncementInput);
   else {
    if(!id) throw new ServiceError(404,'ANNOUNCEMENT_NOT_FOUND','Announcement is unavailable.');
    const current=await repository.lock(tribeId,id);
    if(!current) throw new ServiceError(404,'ANNOUNCEMENT_NOT_FOUND','Announcement is unavailable.');
    if((operation==='archive'&&current.status==='archived')||(operation==='publish'&&current.status==='published')) return {announcement:current};
    if(current.status==='archived') throw new ServiceError(409,'ANNOUNCEMENT_ARCHIVED','Archived announcements cannot be modified.');
    announcement=operation==='edit'?await repository.edit(tribeId,id,fields!):await repository.transition(tribeId,id,operation==='publish'?'published':'archived');
   }
   await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'announcement',$4,$5::jsonb)",[tribeId,identity.userId,'announcement.'+({create:'created',edit:'updated',publish:'published',archive:'archived'} as const)[operation],announcement.id,JSON.stringify(fields?{fields:Object.keys(fields).sort()}:{})]);
   if(operation==='publish') await this.notifications.publish(db,{tribeId,kind:'announcement.published',resourceId:announcement.id,title:announcement.title});
   return {announcement};
  });
 }
}
