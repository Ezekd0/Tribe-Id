import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import type {SharedProfileService} from './shared-service.js';
export function registerSharedProfileRoutes(app:FastifyInstance,service:SharedProfileService|null,sessions:SessionRepository|null) {
 app.get<{Params:{tribeId:string;membershipId:string}}>('/api/v1/tribes/:tribeId/members/:membershipId/shared-profile',{schema:{params:{type:'object',required:['tribeId','membershipId'],additionalProperties:false,properties:{tribeId:{type:'string',format:'uuid'},membershipId:{type:'string',format:'uuid'}}}}},async request=>{
  const identity=await requireSession(request,sessions);if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service.read(identity,request.params.tribeId,request.params.membershipId);
 });
}
