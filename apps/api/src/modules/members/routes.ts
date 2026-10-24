import { requireSession } from '../auth/service.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberRepository } from './repository.js';
import type { Environment } from '../../config/env.js';
import { MemberService } from './service.js';
import { type SessionRepository } from '../authentication/session.js';
export interface MemberDependencies { sessions: SessionRepository; members: MemberRepository }
export { ServiceError } from '../../infrastructure/security/error.js';
import { ServiceError } from '../../infrastructure/security/error.js';
const tribeParams = { type:'object', additionalProperties:false, required:['tribeId'], properties:{tribeId:{type:'string',format:'uuid'}} };
export async function registerMemberRoutes(app: FastifyInstance, env: Environment, dependencies: MemberDependencies | null) {
  void env;
  const session = (request:FastifyRequest) => requireSession(request,dependencies?.sessions ?? null);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/v1/me') || request.url.startsWith('/api/v1/tribes/') || request.url.startsWith('/api/v1/auth/')) reply.header('Cache-Control','no-store');
  });
  app.get('/api/v1/me', async request => {
    const identity = await session(request);
    return { memberships: await dependencies!.members.memberships(identity.userId) };
  });
  for (const resource of ['member-view','hub','profile','id-card','announcements','events'] as const) {
    app.get<{Params:{tribeId:string}}>(`/api/v1/tribes/:tribeId/${resource}`, {schema:{params:tribeParams}}, async request => {
      const identity = await session(request);
      return new MemberService(dependencies!.members).resource(identity.userId,request.params.tribeId,resource);
    });
  }
}
