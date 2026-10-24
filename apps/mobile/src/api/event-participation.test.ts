import {test} from 'node:test';import assert from 'node:assert/strict';
import {participationState,eventFailureMessage} from '../features/events/participation';
import {MemberService} from './member-service';import {ApiClient,ApiFailure} from './client';
import {developmentMemberView} from '../../../api/src/development/member-fixture';
test('event participation respects stored start cutoff and existing registration without inventing capacity',()=>{
 const event={...developmentMemberView.events[0]!,startsAt:'2030-01-01T10:00:00Z',registrationStatus:null};const before=Date.parse(event.startsAt)-1;
 assert.deepEqual(participationState(event,before),{label:'Register',action:'register'});assert.deepEqual(participationState({...event,registrationStatus:'registered'},before),{label:'Cancel registration',action:'cancel'});
 assert.deepEqual(participationState({...event,registrationStatus:'cancelled'},before),{label:'Register again',action:'register'});assert.equal(participationState({...event,registrationStatus:'attended'},before).action,null);
 assert.equal(participationState(event,Date.parse(event.startsAt)).action,null);assert.equal(participationState({...event,registrationStatus:'registered'},Date.parse(event.startsAt)).label,'Registered · Closed');
 assert.match(eventFailureMessage('EVENT_FULL'),/full.*no waitlist/);assert.match(eventFailureMessage('EVENT_CLOSED'),/closed/);assert.match(eventFailureMessage('EVENT_NOT_FOUND'),/no longer/);
});
test('native event transport posts/deletes scoped registration with no body and exposes safe failure codes',async()=>{
 const calls:{path:string;init?:RequestInit}[]=[];const api=new ApiClient('https://api.example.invalid',{token:()=> 'token',refresh:async()=>null,clear:async()=>{}},async(input,init)=>{calls.push({path:String(input),init});return calls.length===3?Response.json({error:{code:'EVENT_FULL',message:'internal ignored'}},{status:409}):new Response(null,{status:204});});
 const service=new MemberService(api);const tribe=developmentMemberView.identity.tribeId,event='12345678-1234-1234-1234-123456789abc';
 await service.eventRegistration(tribe,event,'register');await service.eventRegistration(tribe,event,'cancel');
 await assert.rejects(service.eventRegistration(tribe,event,'register'),error=>error instanceof ApiFailure&&error.code==='EVENT_FULL'&&!error.message.includes('internal'));
 assert.deepEqual(calls.map(call=>call.init?.method),['POST','DELETE','POST']);for(const call of calls){assert.equal(call.path,`https://api.example.invalid/api/v1/tribes/${tribe}/events/${event}/registration`);assert.equal(call.init?.body,undefined);}
 assert.throws(()=>service.eventRegistration(tribe,'../foreign','register'));assert.equal(calls.length,3);
});
