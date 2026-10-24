import nodemailer from 'nodemailer';
import type { Pool } from 'pg';
import { SecretBox } from './crypto.js';
import { transaction, type AuthSettings } from './support.js';
/** Run a bounded batch in the existing deployment; SKIP LOCKED supports multiple workers. */
export async function deliverAuthMail(pool: Pool, settings: AuthSettings) {
    const box = new SecretBox(settings.encryptionKey);
    let url: URL;
    try { url = new URL(settings.smtpUrl); } catch { throw new Error('Invalid SMTP delivery configuration'); }
    const localCapture = settings.mailMode === 'local-capture';
    if (localCapture && (process.env.NODE_ENV === 'production' || url.protocol !== 'smtp:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password)) throw new Error('Unsafe local email capture configuration');
    const transport = nodemailer.createTransport({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)), secure: url.protocol === 'smtps:', ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}), connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, disableFileAccess: true, disableUrlAccess: true, requireTLS: !localCapture, ignoreTLS: localCapture });
    let delivered = 0;
    try {
        for (let i = 0; i < 50; i++) {
            const result = await transaction(pool, async (db) => {
                const row = (await db.query<{
                    id: string;
                    payload_ciphertext: string;
                }>("SELECT id,payload_ciphertext FROM auth_outbox WHERE delivered_at IS NULL AND payload_ciphertext IS NOT NULL AND expires_at>clock_timestamp() AND next_attempt_at<=clock_timestamp() AND attempts<8 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
                if (!row)
                    return 'empty';
                try {
                    const message = JSON.parse(box.open(row.payload_ciphertext, 'auth-mail')) as {
                        to: string;
                        subject: string;
                        text: string;
                    };
                    await transport.sendMail({ from: settings.mailFrom, ...message });
                    await db.query('UPDATE auth_outbox SET delivered_at=clock_timestamp(),payload_ciphertext=NULL,attempts=attempts+1 WHERE id=$1', [row.id]);
                    return 'delivered';
                }
                catch {
                    await db.query("UPDATE auth_outbox SET attempts=attempts+1,next_attempt_at=clock_timestamp()+least(3600,power(2,attempts+1)*30)*interval '1 second' WHERE id=$1", [row.id]);
                    return 'retry';
                }
            });
            if (result === 'empty')
                break;
            if (result === 'delivered')
                delivered++;
        }
    }
    finally {
        transport.close();
    }
    return { delivered };
}
