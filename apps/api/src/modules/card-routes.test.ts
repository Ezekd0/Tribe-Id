import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerCardRoutes} from './tribe-id/routes.js';
import type {CardService} from './tribe-id/service.js';
const tribe='00000000-0000-4000-8000-000000000001',membership='00000000-0000-4000-8000-000000000002',token='a'.repeat(43);
test('card routes resolve server identity, enforce bounded proof body and expose only service responses',async t=>{
 const app=Fastify(),calls:unknown[][]=[];t.after(()=>app.close());
 const identity={userId:'server-user',sessionId:'server-session',email:'private@example.invalid'};
 const service={lifecycle:async(...args:unknown[])=>{calls.push(['lifecycle',...args]);},proof:async(...args:unknown[])=>{calls.push(['proof',...args]);return {proof:'opaque-proof',expiresAt:'2026-11-01T00:00:00.000Z'};},verify:async(...args:unknown[])=>{calls.push(['verify',...args]);return {displayName:'Member',memberNumber:'M-1',status:'issued',expiresAt:'2027-01-01T00:00:00.000Z'};}} as unknown as CardService;
 registerCardRoutes(app,service,{resolve:async()=>identity,revoke:async()=>{}});
 const headers={authorization:'Bearer '+token};
 for(const [method,suffix,operation] of [['POST','','issue'],['POST','/reissue','reissue'],['DELETE','','revoke']] as const) {
  assert.equal((await app.inject({method,url:`/api/v1/tribes/${tribe}/memberships/${membership}/id-card${suffix}`,headers})).statusCode,204);
  assert.deepEqual(calls.at(-1),['lifecycle',identity,tribe,membership,operation]);
 }
 const minted=await app.inject({url:`/api/v1/tribes/${tribe}/id-card/proof`,headers});assert.equal(minted.statusCode,200);assert.equal(minted.json().proof,'opaque-proof');
 const checked=await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/id-card/verify`,headers,payload:{proof:'opaque-proof'}});assert.equal(checked.statusCode,200);assert.deepEqual(calls.at(-1),['verify',identity,tribe,'opaque-proof']);assert.ok(!checked.body.includes('private@example.invalid'));
 const count=calls.length;
 for(const payload of [{proof:'a'.repeat(2049)},{proof:'valid',membershipId:membership},{proof:1},{}]) assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/id-card/verify`,headers,payload})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/memberships/${membership}/id-card`,headers,payload:{userId:'caller'}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:`/api/v1/tribes/${tribe}/id-card/verify`,payload:{proof:'opaque-proof'}})).statusCode,401);
 assert.equal(calls.length,count);
});
import pino from 'pino';
import {credentialRedaction} from '../infrastructure/security/redaction.js';
test('card proofs are redacted from structured diagnostics',()=>{
 let output='';const logger=pino({redact:credentialRedaction},{write:(value:string)=>{output+=value;}});
 logger.info({proof:'PRIVATE_CARD_PROOF',verification:{proof:'PRIVATE_CARD_PROOF'},req:{body:{proof:'PRIVATE_CARD_PROOF'}},res:{body:{proof:'PRIVATE_CARD_PROOF'}}});
 assert.ok(!output.includes('PRIVATE_CARD_PROOF'));assert.ok(output.includes('[Redacted]'));
});
