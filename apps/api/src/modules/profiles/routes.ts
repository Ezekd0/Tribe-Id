import type { FastifyInstance } from 'fastify';
import type { ProfileUpdateRequest } from '@trueda-tribe-id/contracts';
import type { SessionRepository } from '../authentication/session.js';
import { requireSession } from '../auth/service.js';
import { ServiceError } from '../../infrastructure/security/error.js';
import type { ProfileService } from './service.js';
export function registerProfileRoutes(app: FastifyInstance, service: ProfileService | null, sessions: SessionRepository | null) {
    app.patch<{ Params:{tribeId:string}; Body:ProfileUpdateRequest }>('/api/v1/tribes/:tribeId/profile', {
        schema: {params:{type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:{type:'string',format:'uuid'}}}}
    }, async (request,reply) => {
        const identity = await requireSession(request,sessions);
        if (!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');
        await service.update(identity,request.params.tribeId,request.body);
        return reply.code(204).send();
    });
}
