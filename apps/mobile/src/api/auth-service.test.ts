import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './auth-service';
import { SessionCore } from '../auth/session-core';
import { ApiClient } from './client';
function setup(response:()=>Promise<Response>) {let stored:string|null=null;const session=new SessionCore('https://api.example.invalid',{read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}},response);return {session,auth:new AuthService('https://api.example.invalid',session,new ApiClient('https://api.example.invalid',session),response),stored:()=>stored};}
const pair={accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresIn:900};
test('fresh login saves only refresh credential to secure adapter',async()=>{const runtime=setup(async()=>Response.json(pair));assert.equal(await runtime.auth.login('member@example.invalid','password'),null);assert.equal(runtime.stored(),pair.refreshToken);assert.equal(runtime.session.token(),pair.accessToken);});
test('MFA challenge grants no session until factor succeeds',async()=>{let verified=false;const runtime=setup(async()=>Response.json(verified?{...pair,recoveryCodes:['a'.repeat(32)]}:{challengeToken:'c'.repeat(43),enrollmentRequired:true}));const challenge=await runtime.auth.login('owner@example.invalid','password');assert.equal(challenge?.enrollmentRequired,true);assert.equal(runtime.stored(),null);verified=true;assert.deepEqual(await runtime.auth.mfa(challenge!.challengeToken,'123456'),['a'.repeat(32)]);assert.equal(runtime.stored(),pair.refreshToken);});
test('malformed credential response and auth errors do not establish session',async()=>{const malformed=setup(async()=>Response.json({accessToken:'invalid'}));await assert.rejects(malformed.auth.login('email','password'));assert.equal(malformed.stored(),null);const wrong=setup(async()=>Response.json({error:{code:'AUTH_FAILED'}},{status:401}));await assert.rejects(wrong.auth.login('email','wrong'));assert.equal(wrong.stored(),null);});
test('enrollment and recovery never auto-sign in',async()=>{const runtime=setup(async()=>new Response(null,{status:204}));await runtime.auth.enroll('c'.repeat(43),'password','Name');await runtime.auth.verify('d'.repeat(43));await runtime.auth.reset('e'.repeat(43),'new password');assert.equal(runtime.stored(),null);});

test('malformed MFA response cannot establish session or surface unvalidated recovery codes',async()=>{
 for(const response of [{...pair,recoveryCodes:['bad']},{...pair,recoveryCodes:'not-an-array'},{challengeToken:'invalid',enrollmentRequired:true}]){
  const runtime=setup(async()=>Response.json(response));
  await assert.rejects(runtime.auth.mfa('c'.repeat(43),'123456'));assert.equal(runtime.stored(),null);assert.equal(runtime.session.token(),null);
 }
 const runtime=setup(async()=>Response.json({challengeToken:'invalid',enrollmentRequired:true}));
 await assert.rejects(runtime.auth.mfaRecover('c'.repeat(43),'a'.repeat(32)));assert.equal(runtime.stored(),null);
});
