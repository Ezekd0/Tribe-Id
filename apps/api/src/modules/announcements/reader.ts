import type { Pool } from 'pg';
import type { ProfileView, IDCardView, AnnouncementView, EventView } from '@trueda-tribe-id/contracts';
export function readAnnouncements(pool:Pool, membershipId:string, tribeId:string, userId:string) {
 return pool.query<AnnouncementView>(`SELECT id, title, body, category, to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt"
        FROM announcements WHERE tribe_id=$1 AND status='published' AND published_at<=now() ORDER BY published_at DESC, id DESC LIMIT 50`, [tribeId]);
}
