import type {Pool,PoolClient} from 'pg';
import type {NotificationInboxResponse,NotificationInboxItem} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {transaction} from '../auth/support.js';
import {lockLivePreferenceSession} from './settings-service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
export function inboxPagination(input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw new ServiceError(400,'VALIDATION_FAILED','Use a bounded notification limit and offset.');
 const source=input as Record<string,unknown>;
 if(Object.keys(source).some(key=>key!=='limit'&&key!=='offset')) throw new ServiceError(400,'VALIDATION_FAILED','Only notification limit and offset are supported.');
 const number=(key:'limit'|'offset',fallback:number,max:number,min:number)=>{
  const value=source[key];if(value===undefined) return fallback;
  if(typeof value!=='string'||!/^\d{1,5}$/.test(value)||Number(value)<min||Number(value)>max) throw new ServiceError(400,'VALIDATION_FAILED','Use a bounded notification limit and offset.');return Number(value);
 };
 return {limit:number('limit',50,100,1),offset:number('offset',0,10000,0)};
}
export class NotificationInboxService {
 constructor(private readonly pool:Pool) {}
 private async membership(db:PoolClient,identity:SessionIdentity,tribeId:string) {
  await lockLivePreferenceSession(db,identity);
  const id=(await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0]?.id;
  if(!id) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');return id;
 }
 async list(identity:SessionIdentity,tribeId:string,limit=50,offset=0):Promise<NotificationInboxResponse> {
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000) throw new ServiceError(400,'VALIDATION_FAILED','Use a bounded notification limit and offset.');
  return transaction(this.pool,async db=>{
   const membershipId=await this.membership(db,identity,tribeId);
   const rows=(await db.query<{id:string;title:string;body:string;read_at:Date|null;created_at:Date;source_type:string|null;source_id:string|null}>('SELECT id,title,body,read_at,created_at,source_type,source_id FROM notifications WHERE membership_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',[membershipId,limit,offset])).rows;
   const notifications:NotificationInboxItem[]=rows.map(row=>{
    const item:NotificationInboxItem={id:row.id,title:row.title,body:row.body,readAt:row.read_at?.toISOString()??null,createdAt:row.created_at.toISOString()};
    if((row.source_type==='announcement'||row.source_type==='event')&&typeof row.source_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.source_id)) item.source={type:row.source_type,id:row.source_id};
    return item;
   });return {notifications};
  });
 }
 async get(identity:SessionIdentity,tribeId:string,notificationId:string):Promise<NotificationInboxItem> {
  return transaction(this.pool,async db=>{
   const membershipId=await this.membership(db,identity,tribeId);
   const row=(await db.query<{id:string;title:string;body:string;read_at:Date|null;created_at:Date;source_type:string|null;source_id:string|null}>('SELECT id,title,body,read_at,created_at,source_type,source_id FROM notifications WHERE id=$1 AND membership_id=$2',[notificationId,membershipId])).rows[0];
   if(!row)throw new ServiceError(404,'NOTIFICATION_NOT_FOUND','Notification is unavailable.');
   const item:NotificationInboxItem={id:row.id,title:row.title,body:row.body,readAt:row.read_at?.toISOString()??null,createdAt:row.created_at.toISOString()};
   if((row.source_type==='announcement'||row.source_type==='event')&&typeof row.source_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.source_id))item.source={type:row.source_type,id:row.source_id};
   return item;
  });
 }
 async markRead(identity:SessionIdentity,tribeId:string,notificationId:string) {
  await transaction(this.pool,async db=>{
   const membershipId=await this.membership(db,identity,tribeId);
   const existing=(await db.query<{read_at:Date|null}>('SELECT read_at FROM notifications WHERE id=$1 AND membership_id=$2 FOR UPDATE',[notificationId,membershipId])).rows[0];
   if(!existing) throw new ServiceError(404,'NOTIFICATION_NOT_FOUND','Notification is unavailable.');if(existing.read_at) return;
   await db.query('UPDATE notifications SET read_at=clock_timestamp() WHERE id=$1 AND membership_id=$2',[notificationId,membershipId]);
   await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'notification.read','notification',$3,'{}')",[tribeId,identity.userId,notificationId]);
  });
 }
}
