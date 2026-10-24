import type { Pool } from 'pg';
import type { ProfileView, IDCardView, AnnouncementView, EventView } from '@trueda-tribe-id/contracts';
export function readCard(pool:Pool, membershipId:string, tribeId:string, userId:string) {
 return pool.query<IDCardView>(`SELECT id, CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE status END AS status,
        to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "issuedAt", to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expiresAt"
        FROM id_cards WHERE membership_id=$1 AND tribe_id=$2 ORDER BY issued_at DESC, id DESC LIMIT 1`, [membershipId, tribeId]);
}
