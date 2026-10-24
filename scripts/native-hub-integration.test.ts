// Native compile-time global; this test does not instantiate SecureStore sessions.
declare global { const __DEV__: boolean; }
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {developmentMemberView} from '../apps/api/src/development/member-fixture.js';
import {hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
import {ApiClient} from '../apps/mobile/src/api/client.js';
import {MemberService} from '../apps/mobile/src/api/member-service.js';
import type {MobileSession} from '../apps/mobile/src/auth/session.js';
test('mobile member service consumes authenticated Fastify Hub projection without personal-contact fields',async t=>{
  const token='a'.repeat(43),view=structuredClone(developmentMemberView);
  view.identity.displayName='Example Synthetic Member With A Deliberately Long Test Name';view.announcements[0]!.title='API supplied announcement';
  const app=await buildApp(readEnvironment({NODE_ENV:'test'}),{
    sessions:{resolve:async hash=>hash===hashSessionToken(token)?{sessionId:'test',userId:'user',email:'test@example.invalid'}:null,revoke:async()=>{}},
    members:{memberships:async()=>[{tribeId:view.identity.tribeId,tribeName:view.identity.tribeName}],membership:async()=>({userId:'user',tribeId:view.identity.tribeId,role:'member',status:'active'}),view:async()=>view}
  });t.after(()=>app.close());
  t.mock.method(globalThis,'fetch',async (input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));const headers=Object.fromEntries(new Headers(init?.headers));
    const response=await app.inject({url:url.pathname,method:init?.method==='POST'?'POST':'GET',headers});return new Response(response.body,{status:response.statusCode,headers:response.headers as Record<string,string>});
  });
  const session={token:()=>token,refresh:async()=>null,clear:async()=>{}} as unknown as MobileSession;
  const service=new MemberService(new ApiClient('https://api.example.invalid',session));
  const memberships=await service.memberships();const hub=await service.hub(memberships.memberships[0]!.tribeId);
  assert.equal(hub.identity.displayName,'Example Synthetic Member With A Deliberately Long Test Name');assert.equal(hub.announcements[0]!.title,'API supplied announcement');assert.deepEqual(hub.card,view.card);assert.deepEqual(hub.events,view.events.slice(0,2));assert.equal('profile' in hub,false);
  assert.deepEqual((await service.idCard(view.identity.tribeId)).card,view.card);
  assert.deepEqual((await service.profile(view.identity.tribeId)).profile,view.profile);
  assert.deepEqual((await service.announcements(view.identity.tribeId)).announcements,view.announcements);
  assert.deepEqual((await service.events(view.identity.tribeId)).events,view.events);
});
