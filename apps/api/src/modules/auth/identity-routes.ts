import type { FastifyInstance } from 'fastify';
import type { SessionRepository } from '../authentication/session.js';
import { requireSession } from './service.js';
import { IdentityService } from './identity-service.js';
import { ServiceError } from '../../infrastructure/security/error.js';
const token = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
const email = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' };
const password = { type: 'string', minLength: 1, maxLength: 256 };
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const body = (properties: Record<string, unknown>) => ({ body: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } });
const scope = { type: 'object', required: ['tribeId'], properties: { tribeId: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' } }, additionalProperties: false };
export function registerIdentityRoutes(app: FastifyInstance, service: IdentityService | null, sessions: SessionRepository | null) {
    function use() {
        if (!service)
            throw new ServiceError(503, 'AUTH_UNAVAILABLE', 'Authentication is not configured.');
        return service;
    }
    app.addHook('onSend', async (request, reply, payload) => {
        if (request.url.startsWith('/api/v1/auth/'))
            reply.header('Cache-Control', 'no-store');
        return payload;
    });
    app.post<{
        Body: {
            email: string;
            password: string;
            deviceName: string;
        };
    }>('/api/v1/auth/login', { schema: body({ email, password, deviceName: text(100) }) }, r => use().login(r.body.email, r.body.password, r.body.deviceName, r.id));
    app.post<{
        Body: {
            invitationToken: string;
            password: string;
            displayName: string;
        };
    }>('/api/v1/auth/enroll', { schema: body({ invitationToken: token, password, displayName: text(100) }) }, async (r, p) => {
        await use().enroll(r.body.invitationToken, r.body.password, r.body.displayName, r.id);
        return p.code(204).send();
    });
    app.post<{
        Body: {
            invitationToken: string;
            displayName: string;
        };
    }>('/api/v1/auth/invitations/accept', { schema: body({ invitationToken: token, displayName: text(100) }) }, async (r, p) => {
        await use().acceptExisting(await requireSession(r, sessions), r.body.invitationToken, r.body.displayName, r.id);
        return p.code(204).send();
    });
    for (const [path, purpose] of [['verification', 'verify_email'], ['recovery', 'reset_password']] as const)
        app.post<{
            Body: {
                email: string;
            };
        }>(`/api/v1/auth/${path}/request`, { schema: body({ email }) }, async (r, p) => {
            await use().requestToken(r.body.email, purpose, r.id);
            return p.code(202).send({ message: 'If eligible, instructions will be sent.' });
        });
    app.post<{
        Body: {
            token: string;
        };
    }>('/api/v1/auth/verification/confirm', { schema: body({ token }) }, async (r, p) => {
        await use().verifyEmail(r.body.token, r.id);
        return p.code(204).send();
    });
    app.post<{
        Body: {
            token: string;
            newPassword: string;
        };
    }>('/api/v1/auth/recovery/confirm', { schema: body({ token, newPassword: password }) }, async (r, p) => {
        await use().resetPassword(r.body.token, r.body.newPassword, r.id);
        return p.code(204).send();
    });
    app.post<{
        Body: {
            currentPassword: string;
            newPassword: string;
        };
    }>('/api/v1/auth/password/change', { schema: body({ currentPassword: password, newPassword: password }) }, async (r, p) => {
        await use().limiter.take('reauth', (await requireSession(r, sessions)).userId, 5, 900, r.id);
        await use().changePassword(await requireSession(r, sessions), r.body.currentPassword, r.body.newPassword, r.id);
        return p.code(204).send();
    });
    app.post<{
        Body: {
            currentPassword: string;
            email: string;
        };
    }>('/api/v1/auth/email/change/request', { schema: body({ currentPassword: password, email }) }, async (r, p) => {
        await use().requestEmailChange(await requireSession(r, sessions), r.body.currentPassword, r.body.email, r.id);
        return p.code(202).send({ message: 'Verify your new email to complete the change.' });
    });
    app.post<{
        Body: {
            token: string;
        };
    }>('/api/v1/auth/email/change/confirm', { schema: body({ token }) }, async (r, p) => {
        await use().confirmEmailChange(r.body.token, r.id);
        return p.code(204).send();
    });
    app.get('/api/v1/auth/memberships', async (r) => use().membershipStatus(await requireSession(r, sessions)));
    app.post<{
        Body: {
            challengeToken: string;
        };
    }>('/api/v1/auth/mfa/setup', { schema: body({ challengeToken: token }) }, r => use().setupMfa(r.body.challengeToken, r.id));
    app.post<{
        Body: {
            challengeToken: string;
            code: string;
        };
    }>('/api/v1/auth/mfa/verify', { schema: body({ challengeToken: token, code: { type: 'string', pattern: '^\\d{6}$' } }) }, r => use().verifyMfa(r.body.challengeToken, r.body.code, r.id));
    app.post<{
        Body: {
            challengeToken: string;
            recoveryCode: string;
        };
    }>('/api/v1/auth/mfa/recover', { schema: body({ challengeToken: token, recoveryCode: { type: 'string', pattern: '^[a-f0-9]{32}$' } }) }, r => use().recoverMfa(r.body.challengeToken, r.body.recoveryCode, r.id));
    app.post<{
        Params: {
            tribeId: string;
        };
        Body: {
            email: string;
            memberNumber: string;
        };
    }>('/api/v1/tribes/:tribeId/invitations', { schema: { ...body({ email, memberNumber: text(100) }), params: scope } }, async (r) => use().invite(await requireIdentity(r), r.params.tribeId, r.body.email, r.body.memberNumber, r.id));
    // Handlers resolve server-side identity before calling scoped authority checks.
    async function requireIdentity(r: Parameters<typeof requireSession>[0]) {
        return requireSession(r, sessions);
    }
    app.delete<{
        Params: {
            tribeId: string;
            id: string;
        };
    }>('/api/v1/tribes/:tribeId/invitations/:id', { schema: { params: scope } }, async (r, p) => {
        await use().revokeInvitation(await requireSession(r, sessions), r.params.tribeId, r.params.id, r.id);
        return p.code(204).send();
    });
    app.post<{
        Params: {
            tribeId: string;
            id: string;
        };
        Body: {
            evidenceReference: string;
        };
    }>('/api/v1/tribes/:tribeId/memberships/:id/activate', { schema: { ...body({ evidenceReference: text(500) }), params: scope } }, async (r, p) => {
        await use().activate(await requireSession(r, sessions), r.params.tribeId, r.params.id, r.body.evidenceReference, r.id);
        return p.code(204).send();
    });
    app.post<{
        Params: {
            tribeId: string;
            id: string;
        };
        Body: {
            role: 'member' | 'administrator' | 'owner';
        };
    }>('/api/v1/tribes/:tribeId/memberships/:id/role', { schema: { ...body({ role: { type: 'string', enum: ['member', 'administrator', 'owner'] } }), params: scope } }, async (r, p) => {
        await use().setRole(await requireSession(r, sessions), r.params.tribeId, r.params.id, r.body.role, r.id);
        return p.code(204).send();
    });
    app.post<{
        Params: {
            tribeId: string;
            id: string;
        };
        Body: {
            status: 'pending' | 'suspended' | 'revoked';
        };
    }>('/api/v1/tribes/:tribeId/memberships/:id/status', { schema: { ...body({ status: { type: 'string', enum: ['pending', 'suspended', 'revoked'] } }), params: scope } }, async (r, p) => {
        await use().setMembershipState(await requireSession(r, sessions), r.params.tribeId, r.params.id, r.body.status, r.id);
        return p.code(204).send();
    });
}
