import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {type AnnouncementManagementService,validateAnnouncement,validateAnnouncementList} from './service.js';
const uuid={type:'string',format:'uuid'};
const params=(id=false)=>({type:'object',required:id?['tribeId','id']:['tribeId'],additionalProperties:false,properties:id?{tribeId:uuid,id:uuid}:{tribeId:uuid}});
export function registerAnnouncementManagementRoutes(app:FastifyInstance,service:AnnouncementManagementService|null,sessions:SessionRepository|null) {
 const base='/api/v1/tribes/:tribeId/admin/announcements';
 const use=()=>{if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 app.get<{Params:{tribeId:string}}>(base,{schema:{params:params()},preValidation:async request=>{validateAnnouncementList(request.query);}},async request=>use().list(await requireSession(request,sessions),request.params.tribeId,validateAnnouncementList(request.query)));
 for(const operation of ['create','edit','publish','archive'] as const) app.route<{Params:{tribeId:string;id?:string}}>({method:operation==='edit'?'PATCH':'POST',url:base+(operation==='create'?'':'/:id'+(operation==='edit'?'':'/'+operation)),schema:{params:params(operation!=='create')},preValidation:async request=>{
  if(operation==='create'||operation==='edit') validateAnnouncement(request.body,operation==='edit');
  else if(request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Announcement lifecycle requests do not accept request fields.');
 },handler:async(request,reply)=>{
  const identity=await requireSession(request,sessions);
  const result=await use().change(identity,request.params.tribeId,operation,request.params.id,request.body);
  return reply.code(operation==='create'?201:200).send(result);
 }});
}
