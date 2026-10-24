import type {FastifyInstance} from 'fastify';
import type {SessionRepository} from '../authentication/session.js';
import {requireSession} from '../auth/service.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {type PushDeviceService,normalizePushDevice} from './device-service.js';
export function registerPushDeviceRoutes(app:FastifyInstance,service:PushDeviceService|null,sessions:SessionRepository|null) {
 for(const method of ['PUT','DELETE'] as const) app.route({method,url:'/api/v1/me/push-device',preValidation:async request=>{
  if(Object.keys(request.query as Record<string,unknown>).length) throw new ServiceError(400,'VALIDATION_FAILED','Push device requests do not accept query fields.');
  if(method==='PUT') normalizePushDevice(request.body);else if(request.body!==undefined) throw new ServiceError(400,'VALIDATION_FAILED','Unregistration does not accept request fields.');
 },handler:async(request,reply)=>{
  const identity=await requireSession(request,sessions);
  if(!service) throw new ServiceError(503,'PUSH_DEVICE_UNAVAILABLE','Push device registration is not configured.');
  if(method==='PUT') await service.register(identity,request.body,request.id);else await service.unregister(identity,request.id);
  return reply.code(204).send();
 }});
}
