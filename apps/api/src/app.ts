import {registerAdminStatic} from './infrastructure/web/admin-static.js';
import {PushDeviceService} from './modules/notifications/device-service.js';
import {registerPushDeviceRoutes} from './modules/notifications/device-routes.js';
import {PrivacyRequestService} from './modules/privacy-requests/service.js';
import {registerPrivacyRequestRoutes} from './modules/privacy-requests/routes.js';
import { CardService } from './modules/tribe-id/service.js';
import { registerCardRoutes } from './modules/tribe-id/routes.js';
import { EventRegistrationService } from './modules/events/service.js';
import { registerEventRegistrationRoutes } from './modules/events/routes.js';
import { ProfileService } from './modules/profiles/service.js';
import { registerProfileRoutes } from './modules/profiles/routes.js';
import { rateBudget } from './modules/auth/rate-budget.js';
import { AnnouncementManagementService } from './modules/announcements/service.js';
import { registerAnnouncementManagementRoutes } from './modules/announcements/routes.js';
import { EventManagementService } from './modules/events/admin-service.js';
import { registerEventManagementRoutes } from './modules/events/admin-routes.js';
import { AdministrationService } from './modules/administration/service.js';
import { registerAdministrationRoutes } from './modules/administration/routes.js';
import { MemberPreferencesService } from './modules/notifications/settings-service.js';
import { registerMemberPreferencesRoutes } from './modules/notifications/settings-routes.js';
import { SharedProfileService } from './modules/profiles/shared-service.js';
import { registerSharedProfileRoutes } from './modules/profiles/shared-routes.js';
import { NotificationInboxService } from './modules/notifications/inbox-service.js';
import { registerNotificationInboxRoutes } from './modules/notifications/inbox-routes.js';
import {createR2Store,type ObjectStore} from './infrastructure/storage/r2.js';
import {PortraitService} from './modules/profiles/portrait-service.js';
import {registerPortraitRoutes} from './modules/profiles/portrait-routes.js';
import {NotificationPublisher} from './modules/notifications/publisher.js';
import { credentialRedaction } from './infrastructure/security/redaction.js';
import { audit } from './modules/auth/support.js';
import { AuthLimiter } from './modules/auth/support.js';
import { IdentityService } from './modules/auth/identity-service.js';
import { registerIdentityRoutes } from './modules/auth/identity-routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { incrementLimit } from './infrastructure/database/shared-state.js';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { MobileSessionRepository } from './modules/auth/repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { PostgresMemberRepository } from './modules/members/repository.js';
import { registerMemberRoutes, ServiceError, type MemberDependencies } from './modules/members/routes.js';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { readEnvironment, type Environment } from './config/env.js';
export async function buildApp(env: Environment = readEnvironment(), injectedDependencies?: MemberDependencies, infrastructure?:{objectStore?:ObjectStore|null}) {
    const objectStore=infrastructure && Object.hasOwn(infrastructure,'objectStore') ? infrastructure.objectStore??null : env.r2 ? createR2Store(env.r2) : null;
    const notificationPublisher=new NotificationPublisher(env.auth?.encryptionKey??null);
    const app = Fastify({
        requestTimeout: 30000, connectionTimeout: 10000, bodyLimit: 64 * 1024, trustProxy: env.trustedProxies.length ? env.trustedProxies : false, genReqId: () => randomUUID(),
        logger: env.nodeEnv !== 'test' ? { redact: credentialRedaction } : false
    });
    let database: Pool | null = null;
    let mobileSessions: MobileSessionRepository | null = null;
    let dependencies: MemberDependencies | null = injectedDependencies ?? null;
    if (!dependencies && env.databaseUrl) {
        const pool = new Pool({ connectionString: env.databaseUrl, max: env.poolMax, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
        database = pool;
        mobileSessions = new MobileSessionRepository(pool);
        pool.on('error', () => app.log.error('Database pool connection failed'));
        app.addHook('onClose', async () => {
            await pool.end();
        });
        dependencies = { sessions: mobileSessions, members: new PostgresMemberRepository(pool,objectStore) };
    }
    await app.register(helmet);
    if (!database)
        await app.register(rateLimit, { max: 100, timeWindow: '1 minute', allowList: request => request.url.startsWith('/api/v1/health') });
    app.addHook('onRequest', async (request, reply) => {
        reply.header('X-Request-ID', request.id);
        if (!database || request.url.startsWith('/api/v1/health'))
            return;
        const path = request.url.split('?')[0]!;
        const budget = rateBudget(path);
        const key = createHash('sha256').update(request.ip + ':' + budget.key).digest('hex');
        const count = await incrementLimit(database, key);
        if (count > budget.max) {
            await audit(database, 'rate_limit.ip', 'denied', request.id, null, null, key);
            return reply.header('Retry-After', '60').code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: request.id, ...(budget.key === 'refresh' ? { refreshUnconsumed: true } : {}) } });
        }
    });
    app.addHook('onRequest', async (request, reply) => {
        if (request.headers.origin !== undefined && request.headers.origin !== env.appOrigin) {
            return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.', requestId: request.id } });
        }
    });
    app.setErrorHandler(async (error, request, reply) => {
        const candidate = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
        const status = error && typeof error === 'object' && 'code' in error && error.code === '23505' ? 409 : typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : 500;
        // Classify registered templates only: never copy invitation IDs, query strings,
        // bodies, or bearer credentials into security events.
        const route = request.routeOptions.url;
        const invitationAuthorityRoute = (request.method === 'POST' && route === '/api/v1/tribes/:tribeId/invitations')
            || (request.method === 'DELETE' && route === '/api/v1/tribes/:tribeId/invitations/:id');
        const administrativeRoute = route?.startsWith('/api/v1/tribes/:tribeId/admin/');
        if (database && status >= 400 && status < 500 && (request.url.startsWith('/api/v1/auth/') || route?.includes('/memberships/') || invitationAuthorityRoute || administrativeRoute)) {
            const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
            const identity = bearer && mobileSessions ? await mobileSessions.resolve(createHash('sha256').update(bearer).digest('hex')) : null;
            await audit(database, 'request.' + (request.routeOptions.url ?? 'unknown'), 'denied', request.id, identity?.userId ?? null);
        }
        if (status >= 500)
            request.log.error({ requestId: request.id, status }, 'Request failed');
        reply.code(status).send({ error: { code: error instanceof ServiceError ? error.code : status === 429 ? 'RATE_LIMITED' : status === 400 ? 'VALIDATION_FAILED' : 'REQUEST_FAILED', message: error instanceof ServiceError ? error.message : status >= 500 ? 'An unexpected error occurred.' : status === 429 ? 'Too many requests. Try again later.' : 'The request could not be completed.', requestId: request.id } });
    });
    app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId: request.id } }));
    registerHealthRoutes(app, database);
    registerAuthRoutes(app, mobileSessions, dependencies?.sessions ?? null, database, database && env.auth ? new AuthLimiter(database, env.auth.rateLimitKey) : undefined);
    registerIdentityRoutes(app, database && mobileSessions && env.auth ? new IdentityService(database, mobileSessions, env.auth) : null, dependencies?.sessions ?? null);
    registerCardRoutes(app, database && env.auth ? new CardService(database, env.auth.encryptionKey) : null, dependencies?.sessions ?? null);
    registerEventRegistrationRoutes(app, database ? new EventRegistrationService(database,notificationPublisher) : null, dependencies?.sessions ?? null);
    registerProfileRoutes(app, database ? new ProfileService(database) : null, dependencies?.sessions ?? null);
    await registerMemberRoutes(app, env, dependencies);
    registerAnnouncementManagementRoutes(app, database ? new AnnouncementManagementService(database,notificationPublisher) : null, dependencies?.sessions ?? null);
    registerEventManagementRoutes(app, database ? new EventManagementService(database,notificationPublisher) : null, dependencies?.sessions ?? null);
    registerAdministrationRoutes(app, database ? new AdministrationService(database) : null, dependencies?.sessions ?? null);
    registerMemberPreferencesRoutes(app, database ? new MemberPreferencesService(database) : null, dependencies?.sessions ?? null);
    registerSharedProfileRoutes(app, database ? new SharedProfileService(database,objectStore) : null, dependencies?.sessions ?? null);
    registerNotificationInboxRoutes(app, database ? new NotificationInboxService(database) : null, dependencies?.sessions ?? null);
    registerPushDeviceRoutes(app,database&&env.auth?new PushDeviceService(database,env.auth.encryptionKey):null,dependencies?.sessions??null);
    registerPrivacyRequestRoutes(app,database?new PrivacyRequestService(database):null,dependencies?.sessions??null);
    registerPortraitRoutes(app, database && objectStore ? new PortraitService(database,objectStore) : null, dependencies?.sessions ?? null);
    if (env.memberPreview && env.nodeEnv !== 'production') {
        const { previewView } = await import('./development/member-fixture.js');
        app.get<{
            Querystring: {
                scenario?: string;
            };
        }>('/api/v1/development/member-view', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { scenario: { type: 'string', enum: ['normal', 'empty', 'long'] } } } } }, async (request, reply) => {
            reply.header('Cache-Control', 'no-store');
            return { mode: 'development-preview', view: previewView(request.query.scenario) };
        });
    }
    if (env.adminWebDist) await registerAdminStatic(app, env.adminWebDist);
    return app;
}
