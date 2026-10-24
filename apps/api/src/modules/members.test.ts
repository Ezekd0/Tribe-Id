import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { readEnvironment } from '../config/env.js';
import { hashSessionToken } from './authentication/session.js';
import { developmentMemberView } from '../development/member-fixture.js';
import type { MemberDependencies } from './members/routes.js';
const token='a'.repeat(43), tribeId=developmentMemberView.identity.tribeId;
const headers={authorization:`Bearer ${token}`};
function dependencies(overrides: {status?:'active'|'pending'|'suspended'|'revoked';tribeId?:string;valid?:boolean}={}):MemberDependencies {
  return {
    sessions:{resolve:async hash=>overrides.valid===false||hash!==hashSessionToken(token)?null:{sessionId:'session-1',userId:'member-1',email:'test@example.invalid'},revoke:async()=>{}},
    members:{memberships:async()=>[{tribeId,tribeName:'Example Tribe'}],membership:async()=>({userId:'member-1',tribeId:overrides.tribeId??tribeId,role:'member',status:overrides.status??'active'}),view:async()=>structuredClone(developmentMemberView)}
  };
}
test('member routes reject anonymous, malformed and expired sessions',async t=>{
  const app=await buildApp(readEnvironment({NODE_ENV:'test'}),dependencies({valid:false}));t.after(()=>app.close());
  for(const requestHeaders of [{},headers,{cookie:'trueda-tribe-id-session=bad'},{cookie:`trueda-tribe-id-session=${token}; trueda-tribe-id-session=${token}`}]){
    const response=await app.inject({url:`/api/v1/tribes/${tribeId}/member-view`,headers:requestHeaders});
    assert.equal(response.statusCode,401);
    assert.equal(response.headers['cache-control'],'no-store');
  }
});
test('member routes enforce active membership and Tribe scope',async t=>{
  for(const override of [{status:'pending' as const},{status:'suspended' as const},{status:'revoked' as const},{tribeId:'00000000-0000-4000-8000-000000000099'}]){
    const app=await buildApp(readEnvironment({NODE_ENV:'test'}),dependencies(override));t.after(()=>app.close());
    const response=await app.inject({url:`/api/v1/tribes/${tribeId}/member-view`,headers});assert.equal(response.statusCode,404);
  }
});
test('all read routes resolve and project only their resource data',async t=>{
  const app=await buildApp(readEnvironment({NODE_ENV:'test'}),dependencies());t.after(()=>app.close());
  assert.equal((await app.inject({url:'/api/v1/me',headers})).json().memberships[0].tribeId,tribeId);
  for(const resource of ['member-view','hub','profile','id-card','announcements','events']){
    const response=await app.inject({url:`/api/v1/tribes/${tribeId}/${resource}`,headers});assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.ok(!response.body.includes('verification_token_hash'));
    if(resource==='hub'||resource==='announcements'||resource==='events'||resource==='id-card')assert.ok(!response.body.includes(developmentMemberView.profile!.email!));
  }
  assert.equal((await app.inject({url:'/api/v1/tribes/not-a-uuid/member-view',headers})).statusCode,400);
});
test('logout rejects foreign origin and revokes the device session',async t=>{
  const deps=dependencies();let revoked='';deps.sessions.revoke=async id=>{revoked=id;};
  const app=await buildApp(readEnvironment({NODE_ENV:'test'}),deps);t.after(()=>app.close());
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{...headers,origin:'https://foreign.example'}})).statusCode,403);
  const result=await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{...headers,origin:'http://localhost:5173'}});
  assert.equal(result.statusCode,204);assert.equal(revoked,'session-1');assert.equal(result.headers['set-cookie'],undefined);
});
test('development fixture routes are opt-in, bounded and forbidden in production',async t=>{
  assert.throws(()=>readEnvironment({NODE_ENV:'production',APP_ORIGIN:'https://example.invalid',ENABLE_MEMBER_PREVIEW:'true'}));
  const normal=await buildApp(readEnvironment({NODE_ENV:'test'}));t.after(()=>normal.close());
  assert.equal((await normal.inject('/api/v1/development/member-view')).statusCode,404);
  const preview=await buildApp(readEnvironment({NODE_ENV:'test',ENABLE_MEMBER_PREVIEW:'true'}));t.after(()=>preview.close());
  const data=(await preview.inject('/api/v1/development/member-view?scenario=empty')).json();
  assert.equal(data.mode,'development-preview');assert.equal(data.view.card,null);assert.deepEqual(data.view.events,[]);
  assert.equal((await preview.inject('/api/v1/development/member-view?scenario=unknown')).statusCode,400);
  // Enabling development data never authenticates production-style member routes.
  assert.equal((await preview.inject(`/api/v1/tribes/${tribeId}/member-view`)).statusCode,401);
});
