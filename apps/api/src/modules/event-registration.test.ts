import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerEventRegistrationRoutes} from './events/routes.js';
import type {EventRegistrationService} from './events/service.js';
const tribe='00000000-0000-4000-8000-000000000001',event='00000000-0000-4000-8000-000000000002',token='a'.repeat(43);
test('registration routes pass only server-side identity and reject caller identity bodies',async t=>{
 const app=Fastify(),calls:unknown[][]=[];t.after(()=>app.close());
 const identity={userId:'server-user',sessionId:'server-session',email:'member@example.invalid'};
 registerEventRegistrationRoutes(app,{change:async(...args:unknown[])=>{calls.push(args);}} as unknown as EventRegistrationService,{resolve:async()=>identity,revoke:async()=>{}});
 for(const method of ['POST','DELETE'] as const) {
  const result=await app.inject({method,url:`/api/v1/tribes/${tribe}/events/${event}/registration`,headers:{authorization:'Bearer '+token}});assert.equal(result.statusCode,204);
 }
 assert.deepEqual(calls,[[identity,tribe,event,'register'],[identity,tribe,event,'cancel']]);
 for(const method of ['POST','DELETE'] as const) assert.equal((await app.inject({method,url:`/api/v1/tribes/${tribe}/events/${event}/registration`,headers:{authorization:'Bearer '+token},payload:{membershipId:'foreign'}})).statusCode,400);
 assert.equal(calls.length,2);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/events/${event}/registration`})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/events/not-uuid/registration`,headers:{authorization:'Bearer '+token}})).statusCode,400);
});
