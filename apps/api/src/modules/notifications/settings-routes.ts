import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {normalizePreferences,type MemberPreferencesService} from './settings-service.js';
const params={type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:{type:'string',format:'uuid'}}};
export function registerMemberPreferencesRoutes(app:FastifyInstance,service:MemberPreferencesService|null,sessions:SessionRepository|null) {
 const use=()=>{if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 app.get<{Params:{tribeId:string}}>('/api/v1/tribes/:tribeId/preferences',{schema:{params}},async request=>use().get(await requireSession(request,sessions),request.params.tribeId));
 app.patch<{Params:{tribeId:string};Body:unknown}>('/api/v1/tribes/:tribeId/preferences',{schema:{params},preValidation:async request=>{normalizePreferences(request.body);}},async request=>use().update(await requireSession(request,sessions),request.params.tribeId,request.body));
}
