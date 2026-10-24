import type { FastifyInstance } from 'fastify';
import type { SessionRepository } from '../authentication/session.js';
import type { MobileSessionRepository } from './repository.js';
import { requireSession } from './service.js';
import { ServiceError } from '../../infrastructure/security/error.js';
import { hashSessionToken } from '../authentication/session.js';
import { audit, AuthLimiter } from './support.js';
import type { Pool } from 'pg';
export function registerAuthRoutes(app: FastifyInstance, mobileSessions: MobileSessionRepository | null, sessions: SessionRepository | null, database?: Pool | null, limiter?: AuthLimiter) {
    app.post<{
        Body: {
            refreshToken: string;
        };
    }>('/api/v1/auth/refresh', { schema: { body: { type: 'object', additionalProperties: false, required: ['refreshToken'], properties: { refreshToken: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } } } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!mobileSessions)
            return reply.code(503).send({ error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication is not configured.', requestId: request.id, refreshUnconsumed: true } });
        if (limiter) {
            try {
                const family = database ? (await database.query<{
                    session_id: string;
                }>('SELECT session_id FROM refresh_tokens WHERE token_hash=$1', [hashSessionToken(request.body.refreshToken)])).rows[0]?.session_id : undefined;
                await limiter.take('refresh', family ?? hashSessionToken(request.body.refreshToken), 30, 60, request.id);
            }
            catch (error) {
                if (error instanceof ServiceError && error.statusCode === 429)
                    return reply.header('Retry-After', '60').code(429).send({ error: { code: 'RATE_LIMITED', message: error.message, requestId: request.id, refreshUnconsumed: true } });
                throw error;
            }
        }
        const pair = await mobileSessions.rotate(request.body.refreshToken,request.id);
        if (!pair)
            throw new ServiceError(401, 'SESSION_REQUIRED', 'A valid device session is required.');
        return pair;
    });
    app.post('/api/v1/auth/logout', async (request, reply) => {
        const identity = await requireSession(request, sessions);
        await sessions!.revoke(identity.sessionId);
        if (database)
            await audit(database, 'session.logout', 'success', request.id, identity.userId);
        return reply.code(204).send();
    });
    app.get('/api/v1/auth/devices', async (r) => {
        const identity = await requireSession(r, sessions);
        if (!mobileSessions)
            throw new ServiceError(503, 'AUTH_UNAVAILABLE', 'Device management is not configured.');
        return { currentSessionId: identity.sessionId, devices: await mobileSessions.devices(identity.userId) };
    });
    app.delete<{
        Params: {
            id: string;
        };
    }>('/api/v1/auth/devices/:id', { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (r, p) => {
        const identity = await requireSession(r, sessions);
        if (!mobileSessions)
            throw new ServiceError(503, 'AUTH_UNAVAILABLE', 'Device management is not configured.');
        await mobileSessions.revokeDevice(identity.userId, r.params.id);
        if (database)
            await audit(database, 'session.device_revoked', 'success', r.id, identity.userId);
        return p.code(204).send();
    });
    app.post('/api/v1/auth/logout-all', async (r, p) => {
        const identity = await requireSession(r, sessions);
        if (!mobileSessions)
            throw new ServiceError(503, 'AUTH_UNAVAILABLE', 'Device management is not configured.');
        await mobileSessions.revokeAll(identity.userId);
        if (database)
            await audit(database, 'session.logout_all', 'success', r.id, identity.userId);
        return p.code(204).send();
    });
}
