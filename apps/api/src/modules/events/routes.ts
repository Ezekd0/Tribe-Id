import type { FastifyInstance } from 'fastify';
import type { SessionRepository } from '../authentication/session.js';
import { requireSession } from '../auth/service.js';
import { ServiceError } from '../../infrastructure/security/error.js';
import type { EventRegistrationService } from './service.js';
export function registerEventRegistrationRoutes(app:FastifyInstance,service:EventRegistrationService|null,sessions:SessionRepository|null) {
    for (const method of ['POST','DELETE'] as const) app.route<{Params:{tribeId:string;eventId:string}}>({method,url:'/api/v1/tribes/:tribeId/events/:eventId/registration',schema:{params:{type:'object',required:['tribeId','eventId'],additionalProperties:false,properties:{tribeId:{type:'string',format:'uuid'},eventId:{type:'string',format:'uuid'}}}},handler:async(request,reply)=>{
        const identity=await requireSession(request,sessions);
        if (request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Event registration does not accept request fields.');
        if (!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');
        await service.change(identity,request.params.tribeId,request.params.eventId,method==='POST'?'register':'cancel');
        return reply.code(204).send();
    }});
}
