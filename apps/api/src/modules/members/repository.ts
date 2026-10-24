import { readProfile, readSkills, readTeams, readAchievements } from '../profiles/reader.js';
import { readCard } from '../tribe-id/reader.js';
import { readAnnouncements } from '../announcements/reader.js';
import { readEvents } from '../events/reader.js';
import type { MemberView, MemberIdentity, SessionView } from '@trueda-tribe-id/contracts';
import type { Pool } from 'pg';
import type {ObjectStore} from '../../infrastructure/storage/r2.js';
import type { MembershipContext } from '../../security/authorization.js';
export type MemberResource = 'member-view' | 'hub' | 'profile' | 'id-card' | 'announcements' | 'events';
export function projectResource(view: MemberView, resource: MemberResource) {
  switch (resource) {
    case 'profile': return { identity: view.identity, profile: view.profile };
    case 'id-card': return { identity: view.identity, card: view.card, location: view.profile?.location ?? null };
    case 'announcements': return { announcements: view.announcements };
    case 'events': return { events: view.events };
    case 'hub': return { identity: view.identity, card: view.card, announcements: view.announcements.slice(0, 1), events: view.events.slice(0, 2) };
    default: return view;
  }
}
export type MemberResourceView = ReturnType<typeof projectResource>;
export interface MemberRepository {
  memberships(userId: string): Promise<SessionView['memberships']>;
  membership(userId: string, tribeId: string): Promise<MembershipContext | null>;
  resource?(userId: string, tribeId: string, resource: MemberResource): Promise<MemberResourceView | null>;
  view(userId: string, tribeId: string): Promise<MemberView | null>;
}
export class PostgresMemberRepository implements MemberRepository {
  constructor(private pool: Pool,private objectStore:ObjectStore|null=null) {}
  async memberships(userId: string) {
    const result = await this.pool.query<SessionView['memberships'][number]>(`SELECT t.id AS "tribeId", t.name AS "tribeName"
      FROM tribe_memberships m JOIN tribes t ON t.id=m.tribe_id
      WHERE m.user_id=$1 AND m.status='active' ORDER BY m.created_at, m.id`, [userId]);
    return result.rows;
  }
  async membership(userId: string, tribeId: string) {
    const result = await this.pool.query<MembershipContext>(`SELECT user_id AS "userId", tribe_id AS "tribeId", role, status
      FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2`, [userId, tribeId]);
    return result.rows[0] ?? null;
  }
  async view(userId: string, tribeId: string): Promise<MemberView | null> {
    return this.read(userId, tribeId, 'member-view');
  }
  async resource(userId: string, tribeId: string, resource: MemberResource): Promise<MemberResourceView | null> {
    const view = await this.read(userId, tribeId, resource);
    return view ? projectResource(view, resource) : null;
  }
  private async read(userId: string, tribeId: string, resource: MemberResource): Promise<MemberView | null> {
    const member = await this.pool.query<MemberIdentity&{_avatarStorageKey?:string|null}>(`SELECT m.id AS "membershipId", t.id AS "tribeId", t.name AS "tribeName",
      m.member_number AS "memberNumber", m.role, m.status,
      to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "joinedAt",
      COALESCE(p.display_name, 'Tribe Member') AS "displayName", NULL::text AS "avatarUrl",a.storage_key AS "_avatarStorageKey"
      FROM tribe_memberships m JOIN tribes t ON t.id=m.tribe_id LEFT JOIN profiles p ON p.membership_id=m.id AND p.tribe_id=m.tribe_id
      LEFT JOIN assets a ON a.id=p.avatar_asset_id AND a.tribe_id=m.tribe_id AND a.uploaded_by=m.user_id AND a.status='ready'
      WHERE m.user_id=$1 AND m.tribe_id=$2 AND m.status='active'`, [userId, tribeId]);
    const row=member.rows[0];if(!row)return null;
    const {_avatarStorageKey,...identity}=row;
    if(_avatarStorageKey&&this.objectStore)identity.avatarUrl=await this.objectStore.presignDownload(_avatarStorageKey,60);
    const membershipId = identity.membershipId;
    const full = resource === 'member-view';
    const profile = full || resource === 'profile';
    const cardResource = full || resource === 'hub' || resource === 'id-card';
    const [profileResult, skills, teams, achievements, card, announcements, events] = await Promise.all([
      profile || resource === 'id-card' ? readProfile(this.pool, membershipId, tribeId, userId) : null,
      profile ? readSkills(this.pool, membershipId, tribeId, userId) : null,
      profile ? readTeams(this.pool, membershipId, tribeId, userId) : null,
      profile ? readAchievements(this.pool, membershipId, tribeId, userId) : null,
      cardResource ? readCard(this.pool, membershipId, tribeId, userId) : null,
      full || resource === 'hub' || resource === 'announcements' ? readAnnouncements(this.pool, membershipId, tribeId, userId) : null,
      full || resource === 'hub' || resource === 'events' ? readEvents(this.pool, membershipId, tribeId, userId) : null
    ]);
    const profileRow = profileResult?.rows[0];
    return { identity, profile: profileRow ? { ...profileRow, skills:skills?.rows.map(s=>s.name)??[], teams:teams?.rows.map(t=>t.name)??[], achievements:achievements?.rows??[] } : null,
      card:card?.rows[0]??null, announcements:announcements?.rows??[], events:events?.rows??[] };
  }
}
