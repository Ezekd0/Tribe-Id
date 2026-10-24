import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {type PortraitService,validatePortraitUpload} from './portrait-service.js';
const params={type:'object',additionalProperties:false,required:['tribeId'],properties:{tribeId:{type:'string',format:'uuid'},assetId:{type:'string',format:'uuid'}}};
export function registerPortraitRoutes(app:FastifyInstance,service:PortraitService|null,sessions:SessionRepository|null){
  const use=()=>{if(!service)throw new ServiceError(503,'STORAGE_UNAVAILABLE','Private portrait storage is not configured.');return service;};
  const base='/api/v1/tribes/:tribeId/profile/portrait';
  app.get<{Params:{tribeId:string}}>(base,{schema:{params}},async request=>use().own(await requireSession(request,sessions),request.params.tribeId));
  app.post<{Params:{tribeId:string}}>(base+'/uploads',{schema:{params},preValidation:async request=>{validatePortraitUpload(request.body);}},async(request,reply)=>reply.code(201).send(await use().initiate(await requireSession(request,sessions),request.params.tribeId,request.body)));
  app.post<{Params:{tribeId:string;assetId:string}}>(base+'/uploads/:assetId/finalize',{schema:{params}},async(request,reply)=>{
    const identity=await requireSession(request,sessions);if(request.body!==undefined)throw new ServiceError(400,'VALIDATION_FAILED','Portrait finalization does not accept fields.');
    await use().finalize(identity,request.params.tribeId,request.params.assetId);return reply.code(204).send();
  });
  app.delete<{Params:{tribeId:string}}>(base,{schema:{params}},async(request,reply)=>{
    const identity=await requireSession(request,sessions);if(request.body!==undefined)throw new ServiceError(400,'VALIDATION_FAILED','Portrait removal does not accept fields.');
    await use().remove(identity,request.params.tribeId);return reply.code(204).send();
  });
}
