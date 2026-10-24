import type { Pool } from 'pg';
import type { ProfileView, IDCardView, AnnouncementView, EventView } from '@trueda-tribe-id/contracts';
export function readProfile(pool:Pick<Pool, 'query'>, membershipId:string, tribeId:string, userId:string) {
 return pool.query<Omit<ProfileView, 'skills'|'teams'|'achievements'>>(`SELECT p.bio, u.email, p.phone, p.date_of_birth::text AS "dateOfBirth", p.location, p.occupation
        FROM profiles p JOIN tribe_memberships m ON m.id=p.membership_id JOIN users u ON u.id=m.user_id
        WHERE p.membership_id=$1 AND p.tribe_id=$2 AND m.user_id=$3`, [membershipId, tribeId, userId]);
}
export function readSkills(pool:Pick<Pool, 'query'>, membershipId:string, tribeId:string, userId:string) {
 return pool.query<{name:string}>('SELECT s.name FROM member_skills ms JOIN skills s ON s.id=ms.skill_id WHERE ms.membership_id=$1 ORDER BY s.name', [membershipId]);
}
export function readTeams(pool:Pick<Pool, 'query'>, membershipId:string, tribeId:string, userId:string) {
 return pool.query<{name:string}>('SELECT t.name FROM team_memberships tm JOIN teams t ON t.id=tm.team_id AND t.tribe_id=tm.tribe_id WHERE tm.membership_id=$1 AND tm.tribe_id=$2 ORDER BY t.name', [membershipId, tribeId]);
}
export function readAchievements(pool:Pick<Pool, 'query'>, membershipId:string, tribeId:string, userId:string) {
 return pool.query<ProfileView['achievements'][number]>(`SELECT a.id, a.name, a.description, to_char(ma.awarded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "awardedAt"
        FROM member_achievements ma JOIN achievements a ON a.id=ma.achievement_id AND a.tribe_id=ma.tribe_id WHERE ma.membership_id=$1 AND ma.tribe_id=$2 ORDER BY ma.awarded_at DESC`, [membershipId, tribeId]);
}
