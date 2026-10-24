import type { FastifyRequest } from 'fastify';
import type { SessionRepository, SessionIdentity } from '../authentication/session.js';
import { hashSessionToken } from '../authentication/session.js';
import { ServiceError } from '../../infrastructure/security/error.js';
export async function requireSession(request:FastifyRequest,repository:SessionRepository|null):Promise<SessionIdentity> {
 const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
 if(!token) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
 if(!repository) throw new ServiceError(503,'MEMBER_SERVICE_UNAVAILABLE','Member services are not configured.');
 const identity=await repository.resolve(hashSessionToken(token));
 if(!identity) throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
 return identity;
}
