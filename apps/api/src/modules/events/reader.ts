import type { Pool } from 'pg';
import type { ProfileView, IDCardView, AnnouncementView, EventView } from '@trueda-tribe-id/contracts';
export function readEvents(pool:Pool, membershipId:string, tribeId:string, userId:string) {
 return pool.query<EventView>(`SELECT e.id, e.title, e.location, to_char(e.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startsAt",
        to_char(e.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "endsAt", e.timezone, r.status AS "registrationStatus"
        FROM events e LEFT JOIN event_registrations r ON r.event_id=e.id AND r.tribe_id=e.tribe_id AND r.membership_id=$2
        WHERE e.tribe_id=$1 AND e.status='published' AND e.ends_at>=now() ORDER BY e.starts_at, e.id LIMIT 50`, [tribeId, membershipId]);
}
