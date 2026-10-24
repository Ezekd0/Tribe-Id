import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { ServiceError } from '../../infrastructure/security/error.js';
export class Passwords {
    private blocked: Set<string>;
    constructor(blocklist: string[] = []) {
        this.blocked = new Set(['passwordpassword', 'password123456789', '123456789012345', 'truedatribetribe', 'correct horse battery staple', 'letmeinletmeinletmein', ...blocklist].map(value => value.toLowerCase()));
    }
    private active = 0;
    private dummy: Promise<string> | null = null;
    private async bounded<T>(fn: () => Promise<T>) {
        if (this.active >= 4)
            throw new ServiceError(503, 'AUTH_BUSY', 'Authentication is busy. Try again.');
        this.active++;
        try {
            return await fn();
        }
        finally {
            this.active--;
        }
    }
    validate(value: string) {
        if ([...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value) > 512 || /^(.)\1+$/.test(value) || this.blocked.has(value.toLowerCase()))
            throw new ServiceError(400, 'PASSWORD_POLICY', 'Use a password of 15–128 characters that is not common or repetitive.');
    }
    hash(value: string) {
        return this.bounded(() => argon2.hash(value, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }));
    }
    async verify(hash: string | undefined, value: string) {
        this.dummy ??= argon2.hash(randomBytes(32), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
        const encoded = hash?.startsWith('$argon2id$') ? hash : await this.dummy;
        const valid = await this.bounded(() => argon2.verify(encoded, value).catch(() => false));
        return Boolean(hash?.startsWith('$argon2id$') && valid);
    }
}
export class SecretBox {
    private key: Buffer;
    constructor(key: string) {
        this.key = Buffer.from(key, 'base64');
        if (this.key.length !== 32 || this.key.toString('base64') !== key)
            throw new Error('AUTH_ENCRYPTION_KEY must be a canonical base64 32-byte key');
    }
    seal(value: string, context: string) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(context));
        return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    }
    open(value: string, context: string) {
        const payload = Buffer.from(value, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(payload.subarray(-16));
        return Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]).toString('utf8');
    }
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer) {
    let bits = 0, value = 0, result = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            result += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits)
        result += alphabet[(value << (5 - bits)) & 31];
    return result;
}
export function totp(secret: Buffer, step: number) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac('sha1', secret).update(counter).digest();
    const offset = hash[hash.length - 1]! & 15;
    return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function matchTotp(secret: Buffer, code: string, lastStep: number, now = Date.now()) {
    if (!/^\d{6}$/.test(code))
        return null;
    const step = Math.floor(now / 30000);
    for (const candidate of [step, step - 1, step + 1])
        if (candidate > lastStep && timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code)))
            return candidate;
    return null;
}
