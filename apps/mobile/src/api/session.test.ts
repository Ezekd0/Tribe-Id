import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionCore } from '../auth/session-core';
const pair={accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresIn:900};
function storage() {let value:string|null=pair.refreshToken;return {read:async()=>value,write:async(token:string)=>{value=token;},remove:async()=>{value=null;}};}
test('refresh is single-flight and access token expires in memory',async()=>{
 let requests=0,now=0;const session=new SessionCore('https://api.example.invalid',storage(),async()=>{requests++;return Response.json(pair);},()=>now);
 assert.deepEqual(await Promise.all([session.refresh(),session.refresh()]),[pair.accessToken,pair.accessToken]);assert.equal(requests,1);now=900000;assert.equal(session.token(),null);
});
test('failed known response can retry; uncertain rotation is never replayed',async()=>{
 const store=storage();const session=new SessionCore('https://api.example.invalid',store,async()=>{throw new Error('Network');});await assert.rejects(session.refresh());assert.equal(await store.read(),null);assert.equal(await session.refresh(),null);
 const retryStore=storage();const retrySession=new SessionCore('https://api.example.invalid',retryStore,async()=>Response.json({error:{code:'AUTH_UNAVAILABLE',refreshUnconsumed:true}},{status:503}));await assert.rejects(retrySession.refresh());assert.equal(await retryStore.read(),pair.refreshToken);
});
test('clear during rotation prevents a late response restoring credentials',async()=>{
 let respond!:(response:Response)=>void;const store=storage();const session=new SessionCore('https://api.example.invalid',store,()=>new Promise(resolve=>{respond=resolve;}));const pending=session.refresh();await new Promise(resolve=>setTimeout(resolve,0));await session.clear();respond(Response.json(pair));assert.equal(await pending,null);assert.equal(session.token(),null);assert.equal(await store.read(),null);
});
import {ApiClient,ApiFailure} from './client';
test('API logout revokes server session before removing secure local state',async t=>{
 const actions:string[]=[];const client=new ApiClient('https://api.example.invalid',{token:()=>pair.accessToken,refresh:async()=>null,clear:async()=>{actions.push('clear');}});
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{assert.ok(String(input).endsWith('/api/v1/auth/logout'));assert.equal(init?.method,'POST');actions.push('server');return new Response(null,{status:204});});
 await client.logout();assert.deepEqual(actions,['server','clear']);
});
test('protected API 401 refreshes once and clears rejected credentials',async t=>{
 let calls=0,refreshes=0,clears=0;const client=new ApiClient('https://api.example.invalid',{token:()=>pair.accessToken,refresh:async()=>{refreshes++;return pair.accessToken;},clear:async()=>{clears++;}});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:401});});
 await assert.rejects(client.get('/api/v1/me'),error=>error instanceof ApiFailure&&error.status===401);assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(clears,1);
});

test('ambiguous proxy 503 clears refresh credentials rather than replaying',async()=>{const store=storage();const session=new SessionCore('https://api.example.invalid',store,async()=>new Response('Gateway unavailable',{status:503}));await assert.rejects(session.refresh());assert.equal(await store.read(),null);});

test('a stale network failure cannot clear a newer sign-in',async()=>{
 let reject!:(error:Error)=>void;
 const store=storage(), newer={...pair,accessToken:'c'.repeat(43),refreshToken:'d'.repeat(43)};
 const session=new SessionCore('https://api.example.invalid',store,()=>new Promise((_resolve,fail)=>{reject=fail;}));
 const pending=session.refresh();await new Promise(resolve=>setTimeout(resolve,0));
 await session.accept(newer);reject(new Error('Old request failed'));
 assert.equal(await pending,null);assert.equal(session.token(),newer.accessToken);assert.equal(await store.read(),newer.refreshToken);
});

test('a stale response body failure cannot clear a newer sign-in',async()=>{
 let reject!:(error:Error)=>void,reading!:()=>void;
 const started=new Promise<void>(resolve=>{reading=resolve;});
 const response=Response.json(pair);response.json=()=>{reading();return new Promise((_resolve,fail)=>{reject=fail;});};
 const store=storage(),newer={...pair,accessToken:'c'.repeat(43),refreshToken:'d'.repeat(43)};
 const session=new SessionCore('https://api.example.invalid',store,async()=>response);
 const pending=session.refresh();await started;await session.accept(newer);reject(new Error('Old body failed'));
 assert.equal(await pending,null);assert.equal(session.token(),newer.accessToken);assert.equal(await store.read(),newer.refreshToken);
});

test('secure writes and logout are ordered even when storage is slow',async()=>{
 let value:string|null=null,release!:()=>void,writing!:()=>void;
 const started=new Promise<void>(resolve=>{writing=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const store={read:async()=>value,write:async(token:string)=>{writing();await gate;value=token;},remove:async()=>{value=null;}};
 const session=new SessionCore('https://api.example.invalid',store);
 const accepting=session.accept(pair);await started;const clearing=session.clear();release();await Promise.all([accepting,clearing]);
 assert.equal(session.token(),null);assert.equal(await store.read(),null);
});
