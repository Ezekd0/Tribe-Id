import test from 'node:test';
import assert from 'node:assert/strict';
import {ExpoProvider,ExpoRequestError,outcome} from './notifications/expo-provider.js';
test('Expo requests bind fixed HTTPS host, access token, generic copy and bounded routing only',async()=>{
 let payload:unknown;
 const provider=new ExpoProvider('fixture-only',async(url,options)=>{assert.equal(url,'https://exp.host/--/api/v2/push/send');assert.equal(options?.redirect,'error');payload=JSON.parse(options!.body as string);return Response.json({data:[{status:'ok',id:'ticket-1'}]});});
 assert.deepEqual(await provider.send([{to:'ExpoPushToken[fixture]',data:{notificationId:'notification',tribeId:'tribe'}}],new AbortController().signal),[{status:'accepted',id:'ticket-1'}]);
 assert.deepEqual(payload,[{to:'ExpoPushToken[fixture]',data:{notificationId:'notification',tribeId:'tribe'},title:'Tribe ID',body:'You have a Tribe notification',sound:'default',channelId:'tribe-notifications',ttl:3600}]);
});
test('Expo malformed or oversized responses fail safely and retryable failures are classified',async()=>{
 for(const code of ['DeviceNotRegistered','InvalidCredentials','MessageTooBig'])assert.equal((outcome({status:'error',details:{error:code},message:'secret'}) as {retry:boolean}).retry,false);
 assert.deepEqual(outcome({status:'error',details:{error:'MessageRateExceeded'}}),{status:'rejected',code:'MessageRateExceeded',retry:true});
 for(const status of [429,500,401]){const provider=new ExpoProvider('fixture-only',async()=>new Response('secret token',{status}));await assert.rejects(provider.send([{to:'x',data:{notificationId:'n',tribeId:'t'}}],new AbortController().signal),error=>error instanceof ExpoRequestError&&error.retry===(status!==401)&&!error.message.includes('secret'));}
 const malformed=new ExpoProvider('fixture-only',async()=>Response.json({data:[]}));await assert.rejects(malformed.send([{to:'x',data:{notificationId:'n',tribeId:'t'}}],new AbortController().signal));
 const huge=new ExpoProvider('fixture-only',async()=>new Response('x'.repeat(131073)));await assert.rejects(huge.receipts(['id'],new AbortController().signal));
});
test('Expo receipt success means provider handoff and absent receipt stays absent',async()=>{
 const provider=new ExpoProvider('fixture-only',async()=>Response.json({data:{yes:{status:'ok'},bad:{status:'error',details:{error:'DeviceNotRegistered'}}}}));
 assert.deepEqual(await provider.receipts(['yes','bad','missing'],new AbortController().signal),{yes:'ok',bad:{status:'rejected',code:'DeviceNotRegistered',retry:false}});
});
