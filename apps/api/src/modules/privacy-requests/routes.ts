import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {privacyRequestType,privacyRequestPagination,type PrivacyRequestService} from './service.js';
const uuid={type:'string',format:'uuid'},params={type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:uuid,requestId:uuid}};
export function registerPrivacyRequestRoutes(app:FastifyInstance,service:PrivacyRequestService|null,sessions:SessionRepository|null) {
 const use=()=>{if(!service)throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 app.post<{Params:{tribeId:string};Body:unknown}>('/api/v1/tribes/:tribeId/privacy-requests',{schema:{params},preValidation:async request=>{privacyRequestType(request.body);}},async request=>use().create(await requireSession(request,sessions),request.params.tribeId,request.body));
 app.get<{Params:{tribeId:string};Querystring:Record<string,unknown>}>('/api/v1/tribes/:tribeId/privacy-requests',{schema:{params},preValidation:async request=>{privacyRequestPagination(request.query);}},async request=>{const identity=await requireSession(request,sessions),{limit,offset}=privacyRequestPagination(request.query);return use().own(identity,request.params.tribeId,limit,offset);});
 app.get<{Params:{tribeId:string};Querystring:Record<string,unknown>}>('/api/v1/tribes/:tribeId/admin/privacy-requests',{schema:{params},preValidation:async request=>{privacyRequestPagination(request.query,true);}},async request=>{const identity=await requireSession(request,sessions),{status,limit,offset}=privacyRequestPagination(request.query,true);return use().pending(identity,request.params.tribeId,status,limit,offset);});
 app.post<{Params:{tribeId:string;requestId:string}}>('/api/v1/tribes/:tribeId/admin/privacy-requests/:requestId/review',{schema:{params}},async(request,reply)=>{
  const identity=await requireSession(request,sessions);if(request.body!==undefined)throw new ServiceError(400,'VALIDATION_FAILED','Review acknowledgement does not accept request fields.');await use().review(identity,request.params.tribeId,request.params.requestId);return reply.code(204).send();
 });
}
