import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {normalizePushDevice,type PushDeviceService} from './notifications/device-service.js';
import {registerPushDeviceRoutes} from './notifications/device-routes.js';
test('push device input accepts bounded Expo forms and rejects mass assignment/coercion',()=>{
 for(const token of ['ExpoPushToken[example_123-ABC]','ExponentPushToken[abc]','11111111-1111-4111-8111-111111111111']) assert.deepEqual(normalizePushDevice({provider:'expo',platform:'ios',token}),{provider:'expo',platform:'ios',token});
 for(const input of [null,[],{}, {provider:'apns',platform:'ios',token:'ExpoPushToken[abc]'},{provider:'expo',platform:'web',token:'ExpoPushToken[abc]'},{provider:'expo',platform:'ios',token:123},{provider:'expo',platform:'ios',token:'ExpoPushToken[ ]'},{provider:'expo',platform:'ios',token:'ExpoPushToken[abc]\n'},{provider:'expo',platform:'ios',token:'ExpoPushToken['+'x'.repeat(300)+']'},{provider:'expo',platform:'ios',token:'ExpoPushToken[abc]',sessionId:'other'}]) assert.throws(()=>normalizePushDevice(input),{statusCode:400,code:'VALIDATION_FAILED'});
});
test('push routes derive ownership from bearer, return empty204 and reject unknown fields early',async t=>{
 const app=Fastify(),calls:unknown[]=[];
 const service={register:async(...args:unknown[])=>{calls.push(args);},unregister:async(...args:unknown[])=>{calls.push(args);}} as unknown as PushDeviceService;
 registerPushDeviceRoutes(app,service,{resolve:async()=>({userId:'own-user',sessionId:'own-session',email:'fixture@example.invalid'}),revoke:async()=>{}});t.after(()=>app.close());
 const payload={provider:'expo',platform:'android',token:'ExpoPushToken[fixture]'},headers={authorization:'Bearer '+'a'.repeat(43)};
 const response=await app.inject({method:'PUT',url:'/api/v1/me/push-device',headers,payload});assert.equal(response.statusCode,204);assert.equal(response.body,'');assert.equal(calls.length,1);
 assert.equal((calls[0] as [{sessionId:string}])[0].sessionId,'own-session');
 for(const request of [{method:'PUT' as const,url:'/api/v1/me/push-device',payload:{...payload,userId:'other'}},{method:'DELETE' as const,url:'/api/v1/me/push-device',payload:{}},{method:'PUT' as const,url:'/api/v1/me/push-device?sessionId=other',payload}]) assert.equal((await app.inject({...request,headers})).statusCode,400);
 assert.equal((await app.inject({method:'PUT',url:'/api/v1/me/push-device',payload})).statusCode,401);assert.equal(calls.length,1);
});
