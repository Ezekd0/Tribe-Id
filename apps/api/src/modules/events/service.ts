import type { Pool } from 'pg';
import type { SessionIdentity } from '../authentication/session.js';
import { transaction } from '../auth/support.js';
import { enabledIdentity } from '../auth/repository.js';
import { ServiceError } from '../../infrastructure/security/error.js';
import { EventRegistrationRepository } from './repository.js';
import { NotificationPublisher } from '../notifications/publisher.js';
export class EventRegistrationService {
    constructor(private readonly pool:Pool,private readonly notifications=new NotificationPublisher(null)) {}
    async change(identity:SessionIdentity,tribeId:string,eventId:string,operation:'register'|'cancel') {
        await transaction(this.pool,async db=>{
            await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
            const session=await db.query(`SELECT s.id FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId]);
            if (!session.rowCount) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
            const membershipId=(await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0]?.id;
            if (!membershipId) throw new ServiceError(404,'EVENT_NOT_FOUND','Event is unavailable.');
            const repository=new EventRegistrationRepository(db), event=await repository.lockEvent(tribeId,eventId);
            if (!event || event.status==='draft') throw new ServiceError(404,'EVENT_NOT_FOUND','Event is unavailable.');
            if (event.status!=='published' || !event.open) throw new ServiceError(409,'EVENT_CLOSED','Event registration is closed.');
            const current=await repository.current(tribeId,eventId,membershipId);
            if (operation==='register') {
                if (current==='registered' || current==='attended') return;
                if (event.capacity!==null && await repository.occupied(tribeId,eventId)>=event.capacity) throw new ServiceError(409,'EVENT_FULL','Event is full.');
                await repository.register(tribeId,eventId,membershipId);
            } else {
                if (current===null || current==='cancelled') return;
                await repository.cancel(tribeId,eventId,membershipId);
            }
            await db.query('INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,\'event\',$4,$5::jsonb)',[tribeId,identity.userId,operation==='register'?'event.registered':'event.cancelled',eventId,JSON.stringify({membershipId})]);
            const title=(await db.query<{title:string}>('SELECT title FROM events WHERE tribe_id=$1 AND id=$2',[tribeId,eventId])).rows[0]!.title;
            await this.notifications.publish(db,{tribeId,kind:operation==='register'?'registration.registered':'registration.cancelled',resourceId:eventId,title,membershipId});
        });
    }
}
