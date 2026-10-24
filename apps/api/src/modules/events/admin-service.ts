import type {Pool,PoolClient} from 'pg';
import type {EventDraftRequest,ManagedEventView} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {transaction} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {NotificationPublisher} from '../notifications/publisher.js';
export type EventDraftInput=EventDraftRequest;
export type ManagedEvent=ManagedEventView;
const fields=['title','description','location','startsAt','endsAt','timezone','capacity'] as const;
const invalid=()=>new ServiceError(400,'VALIDATION_FAILED','Provide valid event fields, dates, timezone, and capacity.');
const missing=()=>new ServiceError(404,'EVENT_NOT_FOUND','Event is unavailable.');
function date(value:unknown):string {
 if(typeof value!=='string'||value.length>40) throw invalid();
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match) throw invalid();
 const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||m<1||m>12||d<1||d>days[m-1]!||Number(match[4])>23||Number(match[5])>59||Number(match[6])>59||!Number.isFinite(Date.parse(value))) throw invalid();
 return new Date(value).toISOString();
}
export function normalizeEventInput(input:unknown,partial=false):Partial<EventDraftInput> {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw invalid();
 const source=input as Record<string,unknown>,keys=Object.keys(source);
 if(!keys.length||keys.some(key=>!fields.includes(key as typeof fields[number]))||!partial&&fields.some(field=>!Object.hasOwn(source,field))) throw invalid();
 const result:Partial<EventDraftInput>={};
 for(const field of fields) {
  if(!Object.hasOwn(source,field)) continue;
  const value=source[field];
  if(field==='capacity') {if(value!==null&&(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)) throw invalid();result.capacity=value as number|null;}
  else if(field==='startsAt'||field==='endsAt') result[field]=date(value);
  else if(field==='timezone') {
   if(typeof value!=='string'||value.length>100||!/^\w[\w+/-]*$/.test(value)) throw invalid();
   try {new Intl.DateTimeFormat('en',{timeZone:value}).format();} catch {throw invalid();}
   result.timezone=value;
  } else {
   const max=field==='title'?200:field==='description'?10000:300;
   if(typeof value!=='string'||value.length>max||(field!=='description'&&!value.trim())) throw invalid();
   result[field]=field==='description'?value:value.trim();
  }
 }
 if(result.startsAt&&result.endsAt&&Date.parse(result.endsAt)<=Date.parse(result.startsAt)) throw invalid();
 return result;
}
export class EventManagementService {
 constructor(private readonly pool:Pool,private readonly notifications=new NotificationPublisher(null)) {}
 private async authority(db:PoolClient,identity:SessionIdentity,tribeId:string) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
  const session=await db.query<{mfa_verified_at:Date|null}>(`SELECT s.mfa_verified_at FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId]);
  if(!session.rowCount) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
  const member=(await db.query<{role:string}>("SELECT role FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0];
  if(!member||!['administrator','owner'].includes(member.role)||!session.rows[0]!.mfa_verified_at) throw new ServiceError(403,'AUTHORITY_REQUIRED','An authorized Tribe authority with MFA is required.');
 }
 private projection="id,title,description,location,starts_at AS \"startsAt\",ends_at AS \"endsAt\",timezone,capacity,status";
 private view(row:Record<string,unknown>):ManagedEvent {return {...row,startsAt:(row.startsAt as Date).toISOString(),endsAt:(row.endsAt as Date).toISOString()} as unknown as ManagedEvent;}
 private async audit(db:PoolClient,identity:SessionIdentity,tribeId:string,eventId:string,action:string,names:string[]=[]) {
  await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'event',$4,$5::jsonb)",[tribeId,identity.userId,action,eventId,JSON.stringify({changedFields:names})]);
 }
 async list(identity:SessionIdentity,tribeId:string) {
  return transaction(this.pool,async db=>{await this.authority(db,identity,tribeId);return {events:(await db.query(`SELECT ${this.projection} FROM events WHERE tribe_id=$1 ORDER BY starts_at,id LIMIT 100`,[tribeId])).rows.map(row=>this.view(row))};});
 }
 async create(identity:SessionIdentity,tribeId:string,input:unknown) {
  const data=normalizeEventInput(input) as EventDraftInput;
  return transaction(this.pool,async db=>{
   await this.authority(db,identity,tribeId);
   const eventId=(await db.query<{id:string}>("INSERT INTO events(tribe_id,title,description,location,starts_at,ends_at,timezone,capacity,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING id",[tribeId,data.title,data.description,data.location,data.startsAt,data.endsAt,data.timezone,data.capacity])).rows[0]!.id;
   await this.audit(db,identity,tribeId,eventId,'event.created',[...fields]);return {eventId};
  });
 }
 async edit(identity:SessionIdentity,tribeId:string,eventId:string,input:unknown) {
  const data=normalizeEventInput(input,true);
  await transaction(this.pool,async db=>{
   await this.authority(db,identity,tribeId);
   const existing=(await db.query(`SELECT ${this.projection} FROM events WHERE tribe_id=$1 AND id=$2 FOR UPDATE`,[tribeId,eventId])).rows[0];
   if(!existing) throw missing();
   const current=this.view(existing),merged={...current,...data};
   if(Date.parse(merged.endsAt)<=Date.parse(merged.startsAt)) throw invalid();
   if(data.capacity!==undefined&&data.capacity!==null) {
    const occupied=Number((await db.query<{count:string}>("SELECT count(*) FROM event_registrations WHERE tribe_id=$1 AND event_id=$2 AND status IN ('registered','attended')",[tribeId,eventId])).rows[0]!.count);
    if(data.capacity<occupied) throw new ServiceError(409,'EVENT_CAPACITY_CONFLICT','Capacity cannot be lower than current registrations.');
   }
   const columns={title:'title',description:'description',location:'location',startsAt:'starts_at',endsAt:'ends_at',timezone:'timezone',capacity:'capacity'};
   const names=fields.filter(field=>Object.hasOwn(data,field));
   await db.query(`UPDATE events SET ${names.map((field,index)=>`${columns[field]}=$${index+3}`).join(',')} WHERE tribe_id=$1 AND id=$2`,[tribeId,eventId,...names.map(field=>data[field])]);
   await this.audit(db,identity,tribeId,eventId,'event.updated',names);
   if(current.status==='published'&&names.some(field=>data[field]!==current[field])) await this.notifications.publish(db,{tribeId,kind:'event.updated',resourceId:eventId,title:merged.title});
  });
 }
 async transition(identity:SessionIdentity,tribeId:string,eventId:string,operation:'publish'|'cancel') {
  await transaction(this.pool,async db=>{
   await this.authority(db,identity,tribeId);
   const existing=(await db.query<{status:string;title:string}>('SELECT status,title FROM events WHERE tribe_id=$1 AND id=$2 FOR UPDATE',[tribeId,eventId])).rows[0];if(!existing) throw missing();
   const status=operation==='publish'?'published':'cancelled';if(existing.status===status) return;
   await db.query('UPDATE events SET status=$3 WHERE tribe_id=$1 AND id=$2',[tribeId,eventId,status]);
   await this.audit(db,identity,tribeId,eventId,operation==='publish'?'event.published':'event.cancelled',['status']);
   await this.notifications.publish(db,{tribeId,kind:operation==='publish'?'event.published':'event.cancelled',resourceId:eventId,title:existing.title});
  });
 }
}
