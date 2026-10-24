import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {normalizeEventInput,type EventManagementService} from './admin-service.js';
const uuid={type:'string',format:'uuid'},params={type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:uuid,eventId:uuid}};
export function registerEventManagementRoutes(app:FastifyInstance,service:EventManagementService|null,sessions:SessionRepository|null) {
 const use=()=>{if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 app.get<{Params:{tribeId:string}}>('/api/v1/tribes/:tribeId/admin/events',{schema:{params}},async request=>use().list(await requireSession(request,sessions),request.params.tribeId));
 app.post<{Params:{tribeId:string};Body:unknown}>('/api/v1/tribes/:tribeId/admin/events',{schema:{params},preValidation:async request=>{normalizeEventInput(request.body);}},async request=>use().create(await requireSession(request,sessions),request.params.tribeId,request.body));
 app.patch<{Params:{tribeId:string;eventId:string};Body:unknown}>('/api/v1/tribes/:tribeId/admin/events/:eventId',{schema:{params},preValidation:async request=>{normalizeEventInput(request.body,true);}},async(request,reply)=>{await use().edit(await requireSession(request,sessions),request.params.tribeId,request.params.eventId,request.body);return reply.code(204).send();});
 for(const operation of ['publish','cancel'] as const) app.post<{Params:{tribeId:string;eventId:string}}>(`/api/v1/tribes/:tribeId/admin/events/:eventId/${operation}`,{schema:{params}},async(request,reply)=>{
  const identity=await requireSession(request,sessions);if(request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Event lifecycle requests do not accept request fields.');
  await use().transition(identity,request.params.tribeId,request.params.eventId,operation);return reply.code(204).send();
 });
}
