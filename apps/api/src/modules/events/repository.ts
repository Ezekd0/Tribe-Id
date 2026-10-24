import type { PoolClient } from 'pg';
export class EventRegistrationRepository {
    constructor(private readonly db: PoolClient) {}
    async lockEvent(tribeId: string,eventId: string) {
        const locked=await this.db.query('SELECT id FROM events WHERE tribe_id=$1 AND id=$2 FOR UPDATE',[tribeId,eventId]);
        if (!locked.rowCount) return null;
        // Evaluate cutoff after obtaining the event lock, including time spent waiting.
        return (await this.db.query<{status:string;capacity:number|null;open:boolean}>('SELECT status,capacity,starts_at>clock_timestamp() AS open FROM events WHERE tribe_id=$1 AND id=$2',[tribeId,eventId])).rows[0] ?? null;
    }
    async current(tribeId:string,eventId:string,membershipId:string) {
        return (await this.db.query<{status:'registered'|'cancelled'|'attended'}>('SELECT status FROM event_registrations WHERE tribe_id=$1 AND event_id=$2 AND membership_id=$3',[tribeId,eventId,membershipId])).rows[0]?.status ?? null;
    }
    async occupied(tribeId:string,eventId:string) {
        return Number((await this.db.query<{count:string}>("SELECT count(*) FROM event_registrations WHERE tribe_id=$1 AND event_id=$2 AND status IN ('registered','attended')",[tribeId,eventId])).rows[0]!.count);
    }
    async register(tribeId:string,eventId:string,membershipId:string) {
        await this.db.query("INSERT INTO event_registrations(tribe_id,event_id,membership_id,status) VALUES($1,$2,$3,'registered') ON CONFLICT(event_id,membership_id) DO UPDATE SET status='registered',registered_at=clock_timestamp()",[tribeId,eventId,membershipId]);
    }
    async cancel(tribeId:string,eventId:string,membershipId:string) {
        await this.db.query("UPDATE event_registrations SET status='cancelled' WHERE tribe_id=$1 AND event_id=$2 AND membership_id=$3",[tribeId,eventId,membershipId]);
    }
}
