import { projectResource, type MemberResource, type MemberRepository } from './repository.js';
import { can } from '../../security/authorization.js';
import { ServiceError } from '../../infrastructure/security/error.js';
export class MemberService {
 constructor(private readonly repository:MemberRepository) {}
 async resource(userId:string,tribeId:string,resource:MemberResource) {
  const membership=await this.repository.membership(userId,tribeId);
  if(!can(membership,'member:read',{tribeId})) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');
  const result = this.repository.resource ? await this.repository.resource(userId,tribeId,resource) :
    await this.repository.view(userId,tribeId).then(view => view ? projectResource(view,resource) : null);
  if(!result) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');
  return result;
 }
 async view(userId:string,tribeId:string) {
  const membership=await this.repository.membership(userId,tribeId);
  if(!can(membership,'member:read',{tribeId})) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');
  const view=await this.repository.view(userId,tribeId);
  if(!view) throw new ServiceError(404,'MEMBER_NOT_FOUND','Tribe membership is unavailable.');
  return view;
 }
}
