import {test} from 'node:test';import assert from 'node:assert/strict';import {MemberService} from './member-service';import {parsePrivacyRequest,parsePrivacyRequests} from '../features/privacy/request-contract';
const id='11111111-1111-4111-8111-111111111111',tribe='22222222-2222-4222-8222-222222222222';const pending={id,type:'export' as const,status:'pending' as const,createdAt:'2026-10-21T00:00:00Z',reviewedAt:null};
test('privacy review contracts reject extra PII and distinguish review from fulfillment',()=>{
 assert.deepEqual(parsePrivacyRequest(pending),pending);assert.deepEqual(parsePrivacyRequests({requests:[pending]}),{requests:[pending]});
 for(const input of [{...pending,email:'private'},{...pending,status:'completed'},{...pending,type:'download'},{...pending,status:'reviewed',reviewedAt:null}])assert.throws(()=>parsePrivacyRequest(input));
});
test('own review requests send exactly type, reuse server pending identity and bound pagination',async()=>{
 const calls:unknown[]=[];const service=new MemberService({get:async<T>(path:string,query?:Record<string,string|number|undefined>)=>{calls.push({path,query});return {requests:[pending]} as T;},post:async<T>(path:string,body?:Record<string,string>)=>{calls.push({path,body});return pending as T;}});
 const first=await service.createPrivacyRequest(tribe,'export');const duplicate=await service.createPrivacyRequest(tribe,'export');assert.equal(first.id,duplicate.id);await service.privacyRequests(tribe,50);assert.deepEqual((calls[0] as {body:unknown}).body,{type:'export'});assert.deepEqual((calls[2] as {query:unknown}).query,{limit:50,offset:50});await assert.rejects(service.privacyRequests(tribe,10001));
});
