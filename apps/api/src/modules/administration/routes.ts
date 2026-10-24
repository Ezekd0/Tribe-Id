import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {type AdministrationService,validateAdminQuery} from './service.js';
export function registerAdministrationRoutes(app:FastifyInstance,service:AdministrationService|null,sessions:SessionRepository|null) {
 for(const resource of ['context','members','invitations'] as const) app.get<{Params:{tribeId:string}}>(`/api/v1/tribes/:tribeId/admin/${resource}`,{schema:{params:{type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:{type:'string',format:'uuid'}}}},preValidation:async request=>{validateAdminQuery(request.query,resource);}},async request=>{
  const identity=await requireSession(request,sessions);
  if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');
  return resource==='context'?service.context(identity,request.params.tribeId):service[resource](identity,request.params.tribeId,validateAdminQuery(request.query,resource));
 });
}
