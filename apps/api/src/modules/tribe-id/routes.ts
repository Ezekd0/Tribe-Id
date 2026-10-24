import type {FastifyInstance} from 'fastify';
import type {CardVerificationRequest} from '@trueda-tribe-id/contracts';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import type {CardService} from './service.js';
const uuid={type:'string',format:'uuid'};
export function registerCardRoutes(app:FastifyInstance,service:CardService|null,sessions:SessionRepository|null) {
 const use=()=>{if(!service) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');return service;};
 for(const operation of ['issue','reissue','revoke'] as const) app.route<{Params:{tribeId:string;membershipId:string}}>({method:operation==='revoke'?'DELETE':'POST',url:'/api/v1/tribes/:tribeId/memberships/:membershipId/id-card'+(operation==='reissue'?'/reissue':''),schema:{params:{type:'object',required:['tribeId','membershipId'],additionalProperties:false,properties:{tribeId:uuid,membershipId:uuid}}},handler:async(request,reply)=>{
  const identity=await requireSession(request,sessions);
  if(request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Card lifecycle requests do not accept request fields.');
  await use().lifecycle(identity,request.params.tribeId,request.params.membershipId,operation);
  return reply.code(204).send();
 }});
 app.get<{Params:{tribeId:string}}>('/api/v1/tribes/:tribeId/id-card/proof',{schema:{params:{type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:uuid}}}},async request=>use().proof(await requireSession(request,sessions),request.params.tribeId));
 app.post<{Params:{tribeId:string};Body:CardVerificationRequest}>('/api/v1/tribes/:tribeId/id-card/verify',{preValidation:async request=>{
  // Fastify's default AJV coerces values and removes unknown keys; reject them before validation.
  const body=request.body as unknown;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'proof')||typeof (body as {proof:unknown}).proof!=='string'||(body as {proof:string}).proof.length<1||(body as {proof:string}).proof.length>2048) throw new ServiceError(400,'VALIDATION_FAILED','Provide one bounded card proof.');
 },schema:{params:{type:'object',required:['tribeId'],additionalProperties:false,properties:{tribeId:uuid}},body:{type:'object',required:['proof'],additionalProperties:false,properties:{proof:{type:'string',minLength:1,maxLength:2048}}}}},async request=>use().verify(await requireSession(request,sessions),request.params.tribeId,request.body.proof));
}
