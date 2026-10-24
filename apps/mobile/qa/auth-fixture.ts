// Isolated UI verification responses. Not reachable from the native production entry point.
import { AuthService } from '../src/api/auth-service';
import { ApiClient } from '../src/api/client';
import { SessionCore } from '../src/auth/session-core';
export function authFixture(scenario:string|null) {
 const tokens={accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresIn:900};let refresh:string|null=null;
 const request:typeof fetch=async(input)=>{const url=String(input);if(scenario==='loading')return new Promise<Response>(()=>{});if(scenario==='error')return Response.json({error:{code:'AUTH_FAILED'}},{status:401});
 if(url.endsWith('/login'))return Response.json(scenario==='mfa'?{challengeToken:'c'.repeat(43),enrollmentRequired:true}:tokens);
 if(url.endsWith('/mfa/setup'))return Response.json({secret:'TESTONLYAUTHENTICATORSETUPKEY',otpAuthUrl:'test-only'});
 if(url.endsWith('/mfa/verify'))return Response.json({...tokens,recoveryCodes:['TEST-ONLY-RECOVERY-1','TEST-ONLY-RECOVERY-2']});
 if(url.endsWith('/devices'))return Response.json({currentSessionId:'11111111-1111-4111-8111-111111111111',devices:scenario==='empty'?[]:[{id:'11111111-1111-4111-8111-111111111111',deviceName:'QA current device',createdAt:'2026-10-05T00:00:00Z',expiresAt:'2026-11-04T00:00:00Z'},{id:'22222222-2222-4222-8222-222222222222',deviceName:'QA other device',createdAt:'2026-10-05T00:00:00Z',expiresAt:'2026-11-04T00:00:00Z'}]});
 if(url.endsWith('/memberships'))return Response.json({memberships:scenario==='empty'?[]:[{id:'test',tribeName:'QA Tribe',status:'pending'}]});
 if(url.endsWith('/request'))return Response.json({message:'If eligible, instructions will be sent.'},{status:202});return new Response(null,{status:204});};
 const session=new SessionCore('https://qa.example.invalid',{read:async()=>refresh,write:async value=>{refresh=value;},remove:async()=>{refresh=null;}},request);
 const api=new ApiClient('https://qa.example.invalid',{token:()=>tokens.accessToken,refresh:async()=>tokens.accessToken,clear:()=>session.clear()},request);
 return new AuthService('https://qa.example.invalid',session,api,request);
}
