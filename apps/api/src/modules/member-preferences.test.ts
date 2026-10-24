import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences} from './notifications/settings-service.js';
test('preferences require explicit typed supported choices',()=>{
 assert.deepEqual(normalizePreferences({emailNotifications:false,pushNotifications:true,profileVisibility:'tribe'}),{emailNotifications:false,pushNotifications:true,profileVisibility:'tribe'});
 assert.deepEqual(normalizePreferences({profileVisibility:'private'}),{profileVisibility:'private'});
 for(const input of [null,[],{}, {emailNotifications:'true'},{pushNotifications:1},{profileVisibility:'public'},{profileVisibility:null},{emailNotifications:true,userId:'foreign'},{securityEmails:false}]) assert.throws(()=>normalizePreferences(input),{statusCode:400,code:'VALIDATION_FAILED'});
});
import Fastify from 'fastify';
import {registerMemberPreferencesRoutes} from './notifications/settings-routes.js';
import type {MemberPreferencesService} from './notifications/settings-service.js';
test('preference routes reject coercion and caller identities before passing only server identity',async t=>{
 const app=Fastify(),calls:unknown[][]=[];t.after(()=>app.close());
 const identity={userId:'server-user',sessionId:'server-session',email:'private@example.invalid'},tribe='00000000-0000-4000-8000-000000000001';
 const service={get:async(...args:unknown[])=>{calls.push(['get',...args]);return {emailNotifications:false,pushNotifications:false,profileVisibility:'private'};},update:async(...args:unknown[])=>{calls.push(['update',...args]);return {emailNotifications:false,pushNotifications:true,profileVisibility:'private'};}} as unknown as MemberPreferencesService;
 registerMemberPreferencesRoutes(app,service,{resolve:async()=>identity,revoke:async()=>{}});
 const headers={authorization:'Bearer '+'a'.repeat(43)},url=`/api/v1/tribes/${tribe}/preferences`;
 assert.equal((await app.inject({url,headers})).statusCode,200);assert.deepEqual(calls[0],['get',identity,tribe]);
 assert.equal((await app.inject({method:'PATCH',url,headers,payload:{pushNotifications:true}})).statusCode,200);assert.deepEqual(calls[1],['update',identity,tribe,{pushNotifications:true}]);
 for(const payload of [{pushNotifications:'true'},{emailNotifications:false,userId:'foreign'},{profileVisibility:'tribe',membershipId:'foreign'}]) assert.equal((await app.inject({method:'PATCH',url,headers,payload})).statusCode,400);
 assert.equal((await app.inject({url})).statusCode,401);assert.equal(calls.length,2);
});
