import type {Pool} from 'pg';
import type {ObjectStore} from '../../infrastructure/storage/r2.js';
import type {SharedMemberProfile} from '@trueda-tribe-id/contracts';
import type {SessionIdentity} from '../authentication/session.js';
import {transaction} from '../auth/support.js';
import {lockLivePreferenceSession} from '../notifications/settings-service.js';
import {readSkills,readTeams,readAchievements} from './reader.js';
import {ServiceError} from '../../infrastructure/security/error.js';
const unavailable=()=>new ServiceError(404,'PROFILE_NOT_FOUND','Shared profile is unavailable.');
export class SharedProfileService {
 constructor(private readonly pool:Pool,private readonly objectStore:ObjectStore|null=null) {}
 async read(identity:SessionIdentity,tribeId:string,membershipId:string):Promise<SharedMemberProfile> {
  return transaction(this.pool,async db=>{
   await lockLivePreferenceSession(db,identity);
   const rows=(await db.query<{id:string;user_id:string;status:string;enabled:boolean}>(`SELECT m.id,m.user_id,m.status,(u.account_status='enabled' AND u.email_verified_at IS NOT NULL) AS enabled FROM tribe_memberships m JOIN users u ON u.id=m.user_id WHERE m.tribe_id=$1 AND (m.user_id=$2 OR m.id=$3) ORDER BY m.id FOR NO KEY UPDATE OF m`,[tribeId,identity.userId,membershipId])).rows;
   const viewer=rows.find(row=>row.user_id===identity.userId),target=rows.find(row=>row.id===membershipId);
   if(!viewer||viewer.status!=='active'||!target||target.status!=='active'||!target.enabled) throw unavailable();
   const profile=(await db.query<Omit<SharedMemberProfile,'skills'|'teams'|'achievements'>&{_avatarStorageKey:string|null}>(`SELECT p.display_name AS "displayName",NULL::text AS "avatarUrl",p.bio,p.location,p.occupation,a.storage_key AS "_avatarStorageKey" FROM profiles p JOIN tribe_memberships m ON m.id=p.membership_id AND m.tribe_id=p.tribe_id JOIN users u ON u.id=m.user_id JOIN member_settings s ON s.membership_id=p.membership_id LEFT JOIN assets a ON a.id=p.avatar_asset_id AND a.tribe_id=p.tribe_id AND a.uploaded_by=m.user_id AND a.status='ready' WHERE p.membership_id=$1 AND p.tribe_id=$2 AND m.status='active' AND u.account_status='enabled' AND u.email_verified_at IS NOT NULL AND s.profile_visibility='tribe' AND s.profile_sharing_consent_at IS NOT NULL FOR SHARE OF p,s`,[membershipId,tribeId])).rows[0];
   if(!profile) throw unavailable();
   const {_avatarStorageKey,...shared}=profile;
   // Optout blocks future signatures; an already issued private capability can remain valid for at most 60 seconds.
   if(_avatarStorageKey&&this.objectStore) shared.avatarUrl=await this.objectStore.presignDownload(_avatarStorageKey,60);
   const [skills,teams,achievements]=await Promise.all([readSkills(db,membershipId,tribeId,target.user_id),readTeams(db,membershipId,tribeId,target.user_id),readAchievements(db,membershipId,tribeId,target.user_id)]);
   return {...shared,skills:skills.rows.map(row=>row.name),teams:teams.rows.map(row=>row.name),achievements:achievements.rows};
  });
 }
}
