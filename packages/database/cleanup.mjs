// Schedule externally; no process-local timer or critical in-memory job queue.
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
 await client.query('BEGIN');
 await client.query("DELETE FROM request_limits WHERE window_start < now()-interval '1 day'");
 await client.query('DELETE FROM access_tokens WHERE expires_at < now()');
 // Keep consumed refresh hashes for the full family lifetime to preserve replay detection.
 await client.query('DELETE FROM device_sessions WHERE expires_at < now()');
 await client.query('DELETE FROM account_tokens WHERE expires_at < now()');
 await client.query('DELETE FROM auth_challenges WHERE expires_at < now()');
 await client.query("UPDATE member_invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE expires_at<now() AND consumed_at IS NULL");
 await client.query('DELETE FROM auth_outbox WHERE expires_at < now() OR delivered_at IS NOT NULL');
 // Approved C10 default; changes from 90 days require a recorded owner retention decision.
 const retention=process.env.AUTH_AUDIT_RETENTION_DAYS ?? '90';
 if(retention){const days=Number(retention);if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Invalid AUTH_AUDIT_RETENTION_DAYS');await client.query("DELETE FROM auth_security_events WHERE created_at<now()-$1*interval '1 day'",[days]);}
 await client.query("DELETE FROM membership_verification_history h USING tribe_memberships m WHERE h.membership_id=m.id AND m.status='revoked' AND m.exited_at < now()-interval '365 days'");
 await client.query('COMMIT');
} catch(error) {await client.query('ROLLBACK');throw error;} finally {await client.end();}
