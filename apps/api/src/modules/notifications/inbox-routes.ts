import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {inboxPagination,type NotificationInboxService} from './inbox-service.js';
const uuid={type:'string',format:'uuid'};
export function registerNotificationInboxRoutes(app:FastifyInstance,service:Pick<NotificationInboxService,'get'|'list'|'markRead'>|null,sessions:SessionRepository|null) {
 const use=()=>{if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 app.get<{Params:{tribeId:string};Querystring:Record<string,unknown>}>('/api/v1/tribes/:tribeId/notifications',{schema:{params:{type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:uuid}}},preValidation:async request=>{inboxPagination(request.query);}},async request=>{
  const identity=await requireSession(request,sessions),{limit,offset}=inboxPagination(request.query);return use().list(identity,request.params.tribeId,limit,offset);
 });
 app.get<{Params:{tribeId:string;notificationId:string}}>('/api/v1/tribes/:tribeId/notifications/:notificationId',{schema:{params:{type:'object',required:['tribeId','notificationId'],additionalProperties:false,properties:{tribeId:uuid,notificationId:uuid}}},preValidation:async request=>{if(Object.keys(request.query as object).length)throw new ServiceError(400,'VALIDATION_FAILED','Notification lookup does not accept query fields.');}},async request=>{
  const identity=await requireSession(request,sessions);return use().get(identity,request.params.tribeId,request.params.notificationId);
 });
 app.post<{Params:{tribeId:string;notificationId:string}}>('/api/v1/tribes/:tribeId/notifications/:notificationId/read',{schema:{params:{type:'object',required:['tribeId','notificationId'],additionalProperties:false,properties:{tribeId:uuid,notificationId:uuid}}}},async(request,reply)=>{
  const identity=await requireSession(request,sessions);if(request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Marking a notification read does not accept request fields.');await use().markRead(identity,request.params.tribeId,request.params.notificationId);return reply.code(204).send();
 });
}
