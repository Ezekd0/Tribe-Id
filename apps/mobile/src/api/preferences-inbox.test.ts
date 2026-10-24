import {test} from 'node:test';import assert from 'node:assert/strict';import {MemberService} from './member-service';import {parsePreferences,parseInbox,changedPreferences} from '../features/settings/preferences';
const tribe='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';const defaults={emailNotifications:false,pushNotifications:false,profileVisibility:'private' as const};
test('preferences accept only approved choices and produce changed-only explicit opt-ins',()=>{
 assert.deepEqual(parsePreferences(defaults),defaults);assert.deepEqual(changedPreferences(defaults,{...defaults,pushNotifications:true,profileVisibility:'tribe'}),{pushNotifications:true,profileVisibility:'tribe'});assert.deepEqual(changedPreferences(defaults,{...defaults}),{});
 for(const value of [{...defaults,emailNotifications:'yes'},{...defaults,profileVisibility:'public'},{...defaults,email:'private'}])assert.throws(()=>parsePreferences(value));
});
test('inbox rejects external/invalid source projections and preserves bounded own records',()=>{
 const item={id,title:'Update',body:'Plain text',readAt:null,createdAt:'2026-10-21T00:00:00Z',source:{type:'event' as const,id}};assert.deepEqual(parseInbox({notifications:[item]}),{notifications:[item]});
 for(const value of [{notifications:[{...item,source:{type:'url',id:'https://external.invalid'}}]},{notifications:[{...item,email:'private'}]},{notifications:Array(101).fill(item)}])assert.throws(()=>parseInbox(value));
});
test('preferences/inbox service binds scope, bounded pagination and bodyless own notification read',async()=>{
 const calls:unknown[]=[];const service=new MemberService({get:async<T>(path:string,query?:Record<string,string|number|undefined>)=>{calls.push({path,query});return (path.endsWith('/preferences')?defaults:{notifications:[]}) as T;},write:async<T>(path:string,method:'POST'|'PATCH'|'DELETE',body?:object)=>{calls.push({path,method,body});return {...defaults,...body} as T;},post:async<T>(path:string,body?:Record<string,string>)=>{calls.push({path,body});return undefined as T;}});
 await service.preferences(tribe);await service.updatePreferences(tribe,{emailNotifications:true});await service.inbox(tribe,50);await service.markNotificationRead(tribe,id);
 assert.deepEqual((calls[1] as {body:unknown}).body,{emailNotifications:true});assert.deepEqual((calls[2] as {query:unknown}).query,{limit:50,offset:50});assert.equal((calls[3] as {body?:unknown}).body,undefined);assert.match((calls[3] as {path:string}).path,/\/notifications\/[^/]+\/read$/);await assert.rejects(service.inbox(tribe,10001));assert.throws(()=>service.markNotificationRead(tribe,'../foreign'));
});
