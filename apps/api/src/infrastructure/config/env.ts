import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import {readR2Settings,type R2Settings} from '../storage/r2.js';
export interface Environment {
    host: string;
    port: number;
    nodeEnv: 'development' | 'test' | 'production';
    appOrigin: string;
    databaseUrl: string | null;
    memberPreview: boolean;
    poolMax: number;
    trustedProxies: string[];
    r2?: R2Settings | null;
    adminWebDist?: string;
    auth: {
        encryptionKey: string;
        rateLimitKey: string;
        mailFrom: string;
        smtpUrl: string;
    mailMode?: 'smtp' | 'local-capture';
        passwordBlocklist?: string[];
    } | null;
}
export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
    const nodeEnv = source.NODE_ENV ?? 'development';
    if (!['development', 'test', 'production'].includes(nodeEnv))
        throw new Error('Invalid NODE_ENV');
    const memberPreview = source.ENABLE_MEMBER_PREVIEW === 'true';
    if (source.ENABLE_MEMBER_PREVIEW && !['true', 'false'].includes(source.ENABLE_MEMBER_PREVIEW))
        throw new Error('Invalid ENABLE_MEMBER_PREVIEW');
    if (nodeEnv === 'production' && memberPreview)
        throw new Error('Member preview is forbidden in production');
    const poolMax = Number(source.DB_POOL_MAX ?? 10);
    if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100)
        throw new Error('Invalid DB_POOL_MAX');
    const trustedProxies = (source.TRUSTED_PROXY_CIDRS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    for (const value of trustedProxies) {
        const [address, prefix, ...rest] = value.split('/');
        const version = isIP(address ?? '');
        if (!version || rest.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128))))
            throw new Error('TRUSTED_PROXY_CIDRS must contain IP addresses or CIDRs');
    }
    const port = Number(source.PORT ?? 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Invalid PORT');
    if (nodeEnv === 'production' && !source.DATABASE_URL)
        throw new Error('DATABASE_URL is required in production');
    const enabled = source.AUTH_ENABLED === 'true';
    if (source.AUTH_ENABLED && !['true', 'false'].includes(source.AUTH_ENABLED))
        throw new Error('Invalid AUTH_ENABLED');
    let auth: Environment['auth'] = null;
    const mailMode = source.AUTH_MAIL_MODE ?? 'smtp';
    if (!['smtp', 'local-capture'].includes(mailMode)) throw new Error('Invalid AUTH_MAIL_MODE');
    if (mailMode === 'local-capture' && nodeEnv === 'production') throw new Error('Local email capture is forbidden in production');
    if (enabled) {
        const encryptionKey = source.AUTH_ENCRYPTION_KEY ?? '', rateLimitKey = source.AUTH_RATE_LIMIT_KEY ?? '', mailFrom = source.MAIL_FROM ?? '', smtpUrl = source.SMTP_URL ?? '';
        if (Buffer.from(encryptionKey, 'base64').length !== 32 || Buffer.from(encryptionKey, 'base64').toString('base64') !== encryptionKey || Buffer.from(rateLimitKey, 'base64').length < 32)
            throw new Error('Explicit authentication encryption and rate-limit keys required');
        let smtp: URL;
        try { smtp = new URL(smtpUrl); } catch { throw new Error('Invalid SMTP_URL'); }
        if (mailMode === 'local-capture' && (smtp.protocol !== 'smtp:' || !['127.0.0.1', 'localhost', '[::1]'].includes(smtp.hostname) || smtp.username || smtp.password)) throw new Error('Local email capture requires credential-free loopback SMTP');
        if (!['smtp:', 'smtps:'].includes(smtp.protocol) || !smtp.hostname || !mailFrom || !source.DATABASE_URL)
            throw new Error('Authentication requires a database and configured SMTP delivery');
        if (nodeEnv === 'production' && smtp.protocol !== 'smtps:' && smtp.searchParams.get('requireTLS') !== 'true')
            throw new Error('Production SMTP must use TLS');
        if (/[\r\n]/.test(mailFrom))
            throw new Error('Invalid MAIL_FROM');
        let passwordBlocklist: string[] | undefined;
        const listPath = source.AUTH_PASSWORD_BLOCKLIST_PATH;
        if (nodeEnv === 'production' && !listPath)
            throw new Error('Production authentication requires a maintained password blocklist');
        if (listPath) {
            const contents = readFileSync(listPath, 'utf8');
            if (Buffer.byteLength(contents) > 10 * 1024 * 1024)
                throw new Error('Password blocklist exceeds bounded size');
            passwordBlocklist = contents.split(/\r?\n/).map(value => value.trim().toLowerCase()).filter(Boolean);
            if (passwordBlocklist.length < 1000)
                throw new Error('Use a maintained password blocklist with at least 1000 entries');
        }
        auth = { encryptionKey, rateLimitKey, mailFrom, smtpUrl, mailMode: mailMode as 'smtp' | 'local-capture', ...(passwordBlocklist ? { passwordBlocklist } : {}) };
    }
    let origin: URL;
    try { origin = new URL(source.APP_ORIGIN ?? 'http://localhost:5173'); } catch { throw new Error('Invalid APP_ORIGIN'); }
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol))
        throw new Error('APP_ORIGIN must be an HTTP origin');
    if (nodeEnv === 'production' && source.APP_ORIGIN && origin.protocol !== 'https:')
        throw new Error('Production APP_ORIGIN requires HTTPS');
    return { ...(source.ADMIN_WEB_DIST ? {adminWebDist:source.ADMIN_WEB_DIST} : {}), host: source.HOST ?? '127.0.0.1', port, nodeEnv: nodeEnv as Environment['nodeEnv'], appOrigin: nodeEnv === 'production' && !source.APP_ORIGIN ? '' : origin.origin, databaseUrl: source.DATABASE_URL || null, memberPreview, poolMax, trustedProxies, auth, r2:readR2Settings(source) };
}
