import type {Pool,PoolClient} from 'pg';
import type {PrivacyRequestType,PrivacyRequestView,PrivacyRequestListResponse,ManagedPrivacyRequestsResponse,ManagedPrivacyRequestView} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {transaction} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
const invalid=()=>new ServiceError(400,'VALIDATION_FAILED','Provide only an export or deletion request type.');
const unavailable=()=>new ServiceError(404,'PRIVACY_REQUEST_NOT_FOUND','Privacy request is unavailable.');
export function privacyRequestType(input:unknown):PrivacyRequestType {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'type')) throw invalid();
 const type=(input as {type:unknown}).type;if(type!=='export'&&type!=='deletion') throw invalid();return type;
}
export function privacyRequestPagination(input:unknown,admin=false) {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw new ServiceError(400,'VALIDATION_FAILED','Use bounded privacy request filters.');
 const data=input as Record<string,unknown>,allowed=admin?['status','limit','offset']:['limit','offset'];
 if(Object.keys(data).some(key=>!allowed.includes(key))) throw new ServiceError(400,'VALIDATION_FAILED','Use supported privacy request filters.');
 const number=(key:string,fallback:number,min:number,max:number)=>{const value=data[key];if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d{1,5}$/.test(value)||Number(value)<min||Number(value)>max)throw new ServiceError(400,'VALIDATION_FAILED','Use bounded privacy request filters.');return Number(value);};
 const status=data.status??'pending';if(admin&&status!=='pending'&&status!=='reviewed'&&status!=='all') throw new ServiceError(400,'VALIDATION_FAILED','Use pending, reviewed, or all privacy requests.');
 return {limit:number('limit',50,1,100),offset:number('offset',0,0,10000),status:status as 'pending'|'reviewed'|'all'};
}
interface Row {id:string;request_type:PrivacyRequestType;created_at:Date;reviewed_at:Date|null}
export class PrivacyRequestService {
 constructor(private readonly pool:Pool) {}
 private async context(db:PoolClient,identity:SessionIdentity,tribeId:string,admin=false) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
  const session=(await db.query<{mfa_verified_at:Date|null}>(`SELECT s.mfa_verified_at FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rows[0];
  if(!session) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
  const membership=(await db.query<{id:string;role:string}>("SELECT id,role FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0];
  if(admin&&(!membership||!['administrator','owner'].includes(membership.role)||!session.mfa_verified_at)) throw new ServiceError(403,'AUTHORITY_REQUIRED','An authorized Tribe authority with MFA is required.');
  if(!membership) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');return membership.id;
 }
 private view(row:Row):PrivacyRequestView {return {id:row.id,type:row.request_type,status:row.reviewed_at?'reviewed':'pending',createdAt:row.created_at.toISOString(),reviewedAt:row.reviewed_at?.toISOString()??null};}
 private bounds(limit:number,offset:number) {if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new ServiceError(400,'VALIDATION_FAILED','Use bounded privacy request filters.');}
 async create(identity:SessionIdentity,tribeId:string,input:unknown):Promise<PrivacyRequestView> {
  const type=privacyRequestType(input);
  return transaction(this.pool,async db=>{
   const membershipId=await this.context(db,identity,tribeId);
   const pending=(await db.query<Row>('SELECT id,request_type,created_at,reviewed_at FROM member_privacy_requests WHERE membership_id=$1 AND tribe_id=$2 AND request_type=$3 AND reviewed_at IS NULL FOR NO KEY UPDATE',[membershipId,tribeId,type])).rows[0];if(pending)return this.view(pending);
   const row=(await db.query<Row>('INSERT INTO member_privacy_requests(membership_id,tribe_id,request_type) VALUES($1,$2,$3) RETURNING id,request_type,created_at,reviewed_at',[membershipId,tribeId,type])).rows[0]!;
   await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'privacy.requested','privacy_request',$3,'{}')",[tribeId,identity.userId,row.id]);return this.view(row);
  });
 }
 async own(identity:SessionIdentity,tribeId:string,limit=50,offset=0):Promise<PrivacyRequestListResponse> {
  this.bounds(limit,offset);return transaction(this.pool,async db=>{const membershipId=await this.context(db,identity,tribeId);return {requests:(await db.query<Row>('SELECT id,request_type,created_at,reviewed_at FROM member_privacy_requests WHERE membership_id=$1 AND tribe_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4',[membershipId,tribeId,limit,offset])).rows.map(row=>this.view(row))};});
 }
 async pending(identity:SessionIdentity,tribeId:string,status:'pending'|'reviewed'|'all'='pending',limit=50,offset=0):Promise<ManagedPrivacyRequestsResponse> {
  this.bounds(limit,offset);if(!['pending','reviewed','all'].includes(status))throw new ServiceError(400,'VALIDATION_FAILED','Use supported privacy request filters.');
  return transaction(this.pool,async db=>{
   await this.context(db,identity,tribeId,true);
   const rows=(await db.query<Row&{membership_id:string;display_name:string;member_number:string}>(`SELECT r.id,r.request_type,r.created_at,r.reviewed_at,r.membership_id,COALESCE(p.display_name,'Tribe Member') AS display_name,m.member_number
    FROM member_privacy_requests r JOIN tribe_memberships m ON m.id=r.membership_id AND m.tribe_id=r.tribe_id LEFT JOIN profiles p ON p.membership_id=m.id AND p.tribe_id=m.tribe_id
    WHERE r.tribe_id=$1 AND ($2='all' OR ($2='pending' AND r.reviewed_at IS NULL) OR ($2='reviewed' AND r.reviewed_at IS NOT NULL)) ORDER BY r.created_at DESC,r.id DESC LIMIT $3 OFFSET $4`,[tribeId,status,limit,offset])).rows;
   const requests:ManagedPrivacyRequestView[]=rows.map(row=>({...this.view(row),membershipId:row.membership_id,displayName:row.display_name,memberNumber:row.member_number}));return {requests};
  });
 }
 async review(identity:SessionIdentity,tribeId:string,requestId:string) {
  await transaction(this.pool,async db=>{
   await this.context(db,identity,tribeId,true);
   const row=(await db.query<{reviewed_at:Date|null}>('SELECT reviewed_at FROM member_privacy_requests WHERE id=$1 AND tribe_id=$2 FOR NO KEY UPDATE',[requestId,tribeId])).rows[0];if(!row)throw unavailable();if(row.reviewed_at)return;
   await db.query('UPDATE member_privacy_requests SET reviewed_at=clock_timestamp(),reviewed_by_user_id=$3 WHERE id=$1 AND tribe_id=$2',[requestId,tribeId,identity.userId]);
   await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'privacy.reviewed','privacy_request',$3,'{}')",[tribeId,identity.userId,requestId]);
   // This acknowledges administrator review only. It never exports or removes data.
  });
 }
}
