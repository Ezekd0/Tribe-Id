import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {SecretBox} from '../auth/crypto.js';
import {ServiceError} from '../../infrastructure/security/error.js';
export type NotificationEventKind='announcement.published'|'event.published'|'event.updated'|'event.cancelled'|'registration.registered'|'registration.cancelled';
export interface NotificationEvent {id?:string;tribeId:string;kind:NotificationEventKind;resourceId:string;title:string;membershipId?:string}
export function notificationMessage(kind:NotificationEventKind,title:string) {
 const messages:Record<NotificationEventKind,string>={'announcement.published':'A new announcement is available.','event.published':'A new event is available.','event.updated':'An event you registered for has changed.','event.cancelled':'An event you registered for has been cancelled.','registration.registered':'Your event registration is confirmed.','registration.cancelled':'Your event registration has been cancelled.'};
 return {title:title.slice(0,200),body:messages[kind]};
}
/** Call only inside the domain transaction, after an actual mutation. */
export class NotificationPublisher {
 private readonly box:SecretBox|null;
 constructor(key:string|null) {this.box=key?new SecretBox(key):null;}
 async publish(db:PoolClient,event:NotificationEvent) {
  const id=event.id??randomUUID(),type=event.kind==='announcement.published'?'announcement':'event';
  const inserted=await db.query('INSERT INTO notification_events(id,tribe_id,kind,resource_type,resource_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id',[id,event.tribeId,event.kind,type,event.resourceId]);
  if(!inserted.rowCount) {
   const previous=(await db.query<{tribe_id:string;kind:string;resource_id:string}>('SELECT tribe_id,kind,resource_id FROM notification_events WHERE id=$1',[id])).rows[0];
   if(!previous||previous.tribe_id!==event.tribeId||previous.kind!==event.kind||previous.resource_id!==event.resourceId) throw new Error('Conflicting notification event identity');
   return;
  }
  const own=event.kind.startsWith('registration.'),registered=event.kind==='event.updated'||event.kind==='event.cancelled';
  if(own&&!event.membershipId) throw new Error('Registration notification requires acting membership');
  const recipients=(await db.query<{id:string;email:boolean;push:boolean}>(`SELECT m.id,(COALESCE(s.email_notifications,false) AND s.informational_email_consent_at IS NOT NULL) AS email,COALESCE(s.push_notifications,false) AS push
   FROM tribe_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_settings s ON s.membership_id=m.id
   WHERE m.tribe_id=$1 AND m.status='active' AND u.account_status='enabled' AND u.email_verified_at IS NOT NULL
   AND (NOT $2::boolean OR m.id=$3) AND (NOT $4::boolean OR EXISTS(SELECT 1 FROM event_registrations r WHERE r.tribe_id=$1 AND r.event_id=$5 AND r.membership_id=m.id AND r.status IN ('registered','attended'))) ORDER BY m.id`,[event.tribeId,own,event.membershipId??null,registered,event.resourceId])).rows;
  if(!this.box&&recipients.some(recipient=>recipient.email||recipient.push)) throw new ServiceError(503,'NOTIFICATION_DELIVERY_UNAVAILABLE','Informational notification delivery is not configured.');
  const message=notificationMessage(event.kind,event.title);
  const inbox=recipients.map(recipient=>({id:randomUUID(),recipient}));
  if(!inbox.length) return;
  await db.query('INSERT INTO notifications(id,membership_id,title,body,source_event_id,source_type,source_id) SELECT recipient.id,recipient.membership_id,$3,$4,$5,$6,$7 FROM unnest($1::uuid[],$2::uuid[]) AS recipient(id,membership_id)',[inbox.map(item=>item.id),inbox.map(item=>item.recipient.id),message.title,message.body,id,type,event.resourceId]);
  const jobs: {notificationId:string;membershipId:string;channel:string;ciphertext:string}[]=[];
  for(const item of inbox) for(const channel of ['email','push'] as const) if(item.recipient[channel]) jobs.push({notificationId:item.id,membershipId:item.recipient.id,channel,ciphertext:this.box!.seal(JSON.stringify({notificationId:item.id,tribeId:event.tribeId}),'informational-notification:v1')});
  if(jobs.length) await db.query('INSERT INTO notification_delivery_jobs(notification_id,membership_id,tribe_id,channel,payload_ciphertext) SELECT job.notification_id,job.membership_id,$5,job.channel,job.ciphertext FROM unnest($1::uuid[],$2::uuid[],$3::text[],$4::text[]) AS job(notification_id,membership_id,channel,ciphertext)',[jobs.map(job=>job.notificationId),jobs.map(job=>job.membershipId),jobs.map(job=>job.channel),jobs.map(job=>job.ciphertext),event.tribeId]);
 }
}
