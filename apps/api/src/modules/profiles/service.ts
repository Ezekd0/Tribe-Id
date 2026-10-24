import type { ProfileUpdateRequest } from '@trueda-tribe-id/contracts';
import type { Pool } from 'pg';
import type { SessionIdentity } from '../authentication/session.js';
import { transaction } from '../auth/support.js';
import { enabledIdentity } from '../auth/repository.js';
import { ServiceError } from '../../infrastructure/security/error.js';
const fields = ['bio', 'phone', 'location', 'occupation'] as const;
function invalid(message: string): never { throw new ServiceError(400, 'VALIDATION_FAILED', message); }
export function normalizeProfileUpdate(input: unknown): ProfileUpdateRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Provide at least one editable profile field.');
    const source = input as Record<string, unknown>, keys = Object.keys(source);
    if (!keys.length || keys.some(key => !fields.includes(key as typeof fields[number]))) invalid('Only bio, phone, location, and occupation can be updated.');
    const update: ProfileUpdateRequest = {};
    for (const field of fields) {
        if (!Object.hasOwn(source, field)) continue;
        const value = source[field];
        if (field === 'bio') {
            if (typeof value !== 'string' || value.length > 2000) invalid('Bio must be text of at most 2000 characters.');
            update.bio = value;
        } else if (value === null) update[field] = null;
        else {
            const max = field === 'phone' ? 25 : 200;
            if (typeof value !== 'string' || value.length > max) invalid(`${field === 'phone' ? 'Phone' : field === 'location' ? 'Location' : 'Occupation'} must be text of at most ${max} characters or null.`);
            const text = value.trim();
            if (field === 'phone' && text) {
                if (!/^\+?[\d ()-]+$/.test(text)) invalid('Phone must contain 7 to 15 digits with an optional leading +.');
                const digits = text.replace(/\D/g, '');
                if (digits.length < 7 || digits.length > 15) invalid('Phone must contain 7 to 15 digits with an optional leading +.');
                update.phone = (text.startsWith('+') ? '+' : '') + digits;
            } else update[field] = text || null;
        }
    }
    return update;
}
export class ProfileService {
    constructor(private readonly pool: Pool) {}
    async update(identity: SessionIdentity, tribeId: string, input: unknown) {
        const update = normalizeProfileUpdate(input);
        await transaction(this.pool, async db => {
            // Match credential mutation lock order, then serialize own membership/profile edits.
            await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [identity.userId]);
            const session = await db.query(`SELECT s.id FROM device_sessions s JOIN users u ON u.id=s.user_id
                WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`, [identity.sessionId, identity.userId]);
            if (!session.rowCount) throw new ServiceError(401, 'SESSION_REQUIRED', 'A valid member session is required.');
            const membership = await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE", [identity.userId,tribeId]);
            const membershipId = membership.rows[0]?.id;
            if (!membershipId) throw new ServiceError(404, 'PROFILE_NOT_FOUND', 'Tribe profile is unavailable.');
            const names = fields.filter(field => Object.hasOwn(update,field));
            const values = names.map(field => update[field]);
            // Column names come only from the fixed allowlist. Values always use parameters.
            const changed = await db.query(`UPDATE profiles SET ${names.map((field,index)=>`${field}=$${index+3}`).join(',')}, updated_at=clock_timestamp()
                WHERE membership_id=$1 AND tribe_id=$2 RETURNING membership_id`, [membershipId,tribeId,...values]);
            if (!changed.rowCount) throw new ServiceError(404, 'PROFILE_NOT_FOUND', 'Tribe profile is unavailable.');
            await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'profile.updated','profile',$3,$4::jsonb)", [tribeId,identity.userId,membershipId,JSON.stringify({changedFields:names})]);
            // Partial updates preserve other columns; serialized same-field edits use last committed value.
        });
    }
}
