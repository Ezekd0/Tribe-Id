import type {Pool,PoolClient} from 'pg';
import type {SessionIdentity} from '../authentication/session.js';
import {enabledIdentity} from '../auth/repository.js';
import {transaction} from '../auth/support.js';
import {ServiceError} from '../../infrastructure/security/error.js';
export interface AdminContext {tribeId:string;tribeName:string;membershipId:string;role:'administrator'|'owner'}
export interface AdminMember {membershipId:string;displayName:string;memberNumber:string;role:'member'|'administrator'|'owner';status:'pending'|'active'|'suspended'|'revoked';emailVerified:boolean;joinedAt:string|null}
export interface AdminInvitation {id:string;email:string;memberNumber:string;expiresAt:string;consumedAt:string|null;revokedAt:string|null}
export interface AdminListQuery {limit:number;offset:number;search?:string;status?:AdminMember['status'];role?:AdminMember['role']}
const invalid=()=>new ServiceError(400,'VALIDATION_FAILED','Provide only supported bounded administrative list filters.');
export function validateAdminQuery(input:unknown,kind:'members'|'invitations'|'context'):AdminListQuery {
 if(!input||typeof input!=='object'||Array.isArray(input)) throw invalid();
 const value=input as Record<string,unknown>,allowed=kind==='context'?[]:kind==='members'?['limit','offset','search','status','role']:['limit','offset','search'];
 if(Object.keys(value).some(key=>!allowed.includes(key))) throw invalid();
 const result:AdminListQuery={limit:50,offset:0};
 for(const [key,min,max] of [['limit',1,100],['offset',0,10000]] as const) if(Object.hasOwn(value,key)) {const field=value[key];if(typeof field!=='string'||!/^\d+$/.test(field)||Number(field)<min||Number(field)>max) throw invalid();result[key]=Number(field);}
 if(Object.hasOwn(value,'search')) {if(typeof value.search!=='string'||value.search.length>200) throw invalid();result.search=value.search;}
 if(Object.hasOwn(value,'status')) {if(typeof value.status!=='string'||!['pending','active','suspended','revoked'].includes(value.status)) throw invalid();result.status=value.status as AdminMember['status'];}
 if(Object.hasOwn(value,'role')) {if(typeof value.role!=='string'||!['member','administrator','owner'].includes(value.role)) throw invalid();result.role=value.role as AdminMember['role'];}
 return result;
}
export class AdministrationService {
 constructor(private readonly pool:Pool) {}
 private async authority(db:PoolClient,identity:SessionIdentity,tribeId:string):Promise<AdminContext> {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
  const session=(await db.query<{mfa:boolean}>(`SELECT s.mfa_verified_at IS NOT NULL AS mfa FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rows[0];
  if(!session) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
  const context=(await db.query<AdminContext>(`SELECT m.tribe_id AS "tribeId",t.name AS "tribeName",m.id AS "membershipId",m.role FROM tribe_memberships m JOIN tribes t ON t.id=m.tribe_id WHERE m.tribe_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role IN ('administrator','owner') FOR UPDATE OF m`,[tribeId,identity.userId])).rows[0];
  if(!context||!session.mfa) throw new ServiceError(403,'AUTHORITY_REQUIRED','An authorized Tribe authority with MFA is required.');
  return context;
 }
 async context(identity:SessionIdentity,tribeId:string) {return transaction(this.pool,db=>this.authority(db,identity,tribeId));}
 async members(identity:SessionIdentity,tribeId:string,query:AdminListQuery) {
  return transaction(this.pool,async db=>{
   await this.authority(db,identity,tribeId);
   const members=(await db.query<AdminMember>(`SELECT m.id AS "membershipId",COALESCE(p.display_name,'Tribe Member') AS "displayName",m.member_number AS "memberNumber",m.role,m.status,u.email_verified_at IS NOT NULL AS "emailVerified",to_char(m.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "joinedAt"
    FROM tribe_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN profiles p ON p.membership_id=m.id AND p.tribe_id=m.tribe_id
    WHERE m.tribe_id=$1 AND ($2::text IS NULL OR m.status=$2) AND ($3::text IS NULL OR m.role=$3) AND ($4::text IS NULL OR strpos(lower(COALESCE(p.display_name,'Tribe Member')),lower($4))>0 OR strpos(lower(m.member_number),lower($4))>0)
    ORDER BY m.created_at DESC,m.id DESC LIMIT $5 OFFSET $6`,[tribeId,query.status??null,query.role??null,query.search??null,query.limit,query.offset])).rows;
   return {members};
  });
 }
 async invitations(identity:SessionIdentity,tribeId:string,query:AdminListQuery) {
  return transaction(this.pool,async db=>{
   await this.authority(db,identity,tribeId);
   const invitations=(await db.query<AdminInvitation>(`SELECT id,email,member_number AS "memberNumber",to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",to_char(consumed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "consumedAt",to_char(revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "revokedAt"
    FROM member_invitations WHERE tribe_id=$1 AND ($2::text IS NULL OR strpos(lower(email),lower($2))>0 OR strpos(lower(member_number),lower($2))>0) ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,[tribeId,query.search??null,query.limit,query.offset])).rows;
   return {invitations};
  });
 }
}
