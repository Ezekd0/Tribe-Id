import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCardProof,parseCardVerification} from '../features/tribe-id/verification-contract';import {MemberService} from './member-service';
const expiry='2030-01-01T00:00:00.000Z';
test('card responses permit exactly approved fields and reject malformed/private projections',()=>{
 assert.deepEqual(parseCardProof({proof:'opaque-proof',expiresAt:expiry}),{proof:'opaque-proof',expiresAt:expiry});
 const valid={displayName:'Member',memberNumber:'TRIBE-001',status:'issued',expiresAt:expiry};assert.deepEqual(parseCardVerification(valid),valid);
 for(const value of [null,{...valid,email:'private@example.invalid'},{...valid,status:'revoked'},{...valid,displayName:42},{...valid,expiresAt:'invalid'},{...valid,expiresAt:'2000-01-01T00:00:00Z'}])assert.throws(()=>parseCardVerification(value));
 for(const value of [null,{proof:'',expiresAt:expiry},{proof:'x'.repeat(2049),expiresAt:expiry},{proof:'opaque',expiresAt:expiry,email:'private'}])assert.throws(()=>parseCardProof(value));
});
test('member proof adapter uses own scoped read and bounded proof-only verification body',async()=>{
 const calls:unknown[]=[];const tribe='12345678-1234-1234-1234-123456789abc';
 const service=new MemberService({get:async<T>(path:string)=>{calls.push({path});return {proof:'opaque',expiresAt:expiry} as T;},post:async<T>(path:string,body?:Record<string,string>)=>{calls.push({path,body});return {displayName:'Member',memberNumber:'001',status:'issued',expiresAt:expiry} as T;}});
 await service.cardProof(tribe);await service.verifyCard(tribe,'opaque');assert.deepEqual(calls,[{path:`/api/v1/tribes/${tribe}/id-card/proof`},{path:`/api/v1/tribes/${tribe}/id-card/verify`,body:{proof:'opaque'}}]);
 await assert.rejects(service.verifyCard(tribe,'x'.repeat(2049)));await assert.rejects(service.verifyCard('../foreign','opaque'));assert.equal(calls.length,2);
});
