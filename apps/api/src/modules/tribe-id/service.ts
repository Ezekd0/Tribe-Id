import { randomBytes, createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { CardProofResponse,CardVerificationResponse } from '@trueda-tribe-id/contracts';
import type { SessionIdentity } from '../authentication/session.js';
import { SecretBox } from '../auth/crypto.js';
import { enabledIdentity } from '../auth/repository.js';
import { transaction } from '../auth/support.js';
import { ServiceError } from '../../infrastructure/security/error.js';
const unavailable=()=>new ServiceError(404,'CARD_NOT_FOUND','Card is unavailable.');
interface Membership {id:string;user_id:string;role:string;status:string;enabled:boolean}
interface Proof {v:1;cardId:string;issuedAt:string;proofExpiresAt:number}
export class CardService {
    private readonly box:SecretBox;
    constructor(private readonly pool:Pool,key:string) {this.box=new SecretBox(key);}
    private async session(db:PoolClient,identity:SessionIdentity) {
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
        const session=await db.query<{mfa_verified_at:Date|null}>(`SELECT s.mfa_verified_at FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId]);
        if(!session.rowCount) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
        return session.rows[0]!.mfa_verified_at!==null;
    }
    private async memberships(db:PoolClient,identity:SessionIdentity,tribeId:string,target?:string) {
        // Stable ordering prevents crossed authority/target membership lock cycles.
        const rows=(await db.query<Membership>(`SELECT m.id,m.user_id,m.role,m.status,(u.account_status='enabled' AND u.email_verified_at IS NOT NULL) AS enabled
            FROM tribe_memberships m JOIN users u ON u.id=m.user_id WHERE m.tribe_id=$1 AND (m.user_id=$2 OR m.id=$3) ORDER BY m.id FOR NO KEY UPDATE OF m`,[tribeId,identity.userId,target??null])).rows;
        return {actor:rows.find(row=>row.user_id===identity.userId),target:rows.find(row=>row.id===target)};
    }
    async lifecycle(identity:SessionIdentity,tribeId:string,membershipId:string,operation:'issue'|'reissue'|'revoke') {
        await transaction(this.pool,async db=>{
            const mfa=await this.session(db,identity);
            const {actor,target}=await this.memberships(db,identity,tribeId,membershipId);
            if(!actor||actor.status!=='active'||!['owner','administrator'].includes(actor.role)||!mfa) throw new ServiceError(403,'AUTHORITY_REQUIRED','An authorized Tribe authority with MFA is required.');
            if(!target || operation!=='revoke'&&(target.status!=='active'||!target.enabled)) throw unavailable();
            const current=(await db.query<{id:string;expired:boolean}>("SELECT id,expires_at<=clock_timestamp() AS expired FROM id_cards WHERE tribe_id=$1 AND membership_id=$2 AND status='issued' ORDER BY issued_at DESC,id FOR UPDATE",[tribeId,membershipId])).rows;
            if(operation==='issue' && current.some(card=>!card.expired)) throw new ServiceError(409,'CARD_ALREADY_ISSUED','A card is already issued.');
            if(operation==='revoke') {
                if(!current.length) return;
                await db.query("UPDATE id_cards SET status='revoked',revoked_at=clock_timestamp() WHERE tribe_id=$1 AND membership_id=$2 AND status='issued'",[tribeId,membershipId]);
            } else {
                await db.query("UPDATE id_cards SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,revoked_at=CASE WHEN expires_at<=clock_timestamp() THEN revoked_at ELSE clock_timestamp() END WHERE tribe_id=$1 AND membership_id=$2 AND status='issued'",[tribeId,membershipId]);
                const hash=createHash('sha256').update(randomBytes(32)).digest('hex');
                await db.query("INSERT INTO id_cards(membership_id,tribe_id,verification_token_hash,issued_at,expires_at) SELECT $1,$2,$3,moment,moment+interval '12 months' FROM (SELECT clock_timestamp() AS moment) issuance",[membershipId,tribeId,hash]);
            }
            await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'membership',$4,'{}')",[tribeId,identity.userId,operation==='issue'?'card.issued':operation==='reissue'?'card.reissued':'card.revoked',membershipId]);
        });
    }
    async proof(identity:SessionIdentity,tribeId:string):Promise<CardProofResponse> {
        return transaction(this.pool,async db=>{
            await this.session(db,identity);
            const {actor}=await this.memberships(db,identity,tribeId);
            if(!actor||actor.status!=='active') throw unavailable();
            const card=(await db.query<{id:string;issued_at:Date;expires_at:Date;now:Date}>("SELECT id,issued_at,expires_at,clock_timestamp() AS now FROM id_cards WHERE tribe_id=$1 AND membership_id=$2 AND status='issued' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY issued_at DESC,id DESC LIMIT 1 FOR SHARE",[tribeId,actor.id])).rows[0];
            if(!card) throw unavailable();
            const expiry=Math.min(card.now.getTime()+300000,card.expires_at.getTime());
            const payload:Proof={v:1,cardId:card.id,issuedAt:card.issued_at.toISOString(),proofExpiresAt:expiry};
            return {proof:this.box.seal(JSON.stringify(payload),'tribe-card-proof:v1:'+tribeId),expiresAt:new Date(expiry).toISOString()};
        });
    }
    async verify(identity:SessionIdentity,tribeId:string,proof:string):Promise<CardVerificationResponse> {
        return transaction(this.pool,async db=>{
            await this.session(db,identity);
            let payload:Proof;
            try {
                payload=JSON.parse(this.box.open(proof,'tribe-card-proof:v1:'+tribeId)) as Proof;
                if(payload.v!==1||typeof payload.cardId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.cardId)||typeof payload.issuedAt!=='string'||!Number.isFinite(payload.proofExpiresAt)) throw unavailable();
            } catch {throw unavailable();}
            const candidate=(await db.query<{membership_id:string}>('SELECT membership_id FROM id_cards WHERE id=$1 AND tribe_id=$2',[payload.cardId,tribeId])).rows[0];
            const {actor,target}=await this.memberships(db,identity,tribeId,candidate?.membership_id);
            if(!actor||actor.status!=='active'||!target||target.status!=='active'||!target.enabled) throw unavailable();
            const card=(await db.query<{issued_at:Date;expires_at:Date;displayName:string;memberNumber:string;now:Date}>(`SELECT c.issued_at,c.expires_at,COALESCE(p.display_name,'Tribe Member') AS "displayName",m.member_number AS "memberNumber",clock_timestamp() AS now
                FROM id_cards c JOIN tribe_memberships m ON m.id=c.membership_id AND m.tribe_id=c.tribe_id JOIN users u ON u.id=m.user_id LEFT JOIN profiles p ON p.membership_id=m.id AND p.tribe_id=m.tribe_id
                WHERE c.id=$1 AND c.tribe_id=$2 AND c.status='issued' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND m.status='active' AND u.account_status='enabled' AND u.email_verified_at IS NOT NULL FOR SHARE OF c`,[payload.cardId,tribeId])).rows[0];
            if(!card||card.issued_at.toISOString()!==payload.issuedAt||payload.proofExpiresAt<=card.now.getTime()||payload.proofExpiresAt>card.now.getTime()+300000||payload.proofExpiresAt>card.expires_at.getTime()) throw unavailable();
            return {displayName:card.displayName,memberNumber:card.memberNumber,status:'issued',expiresAt:card.expires_at.toISOString()};
        });
    }
}
