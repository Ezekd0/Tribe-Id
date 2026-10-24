import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InformationalEmailTransport} from './notifications/email-delivery.js';
import type {InformationalEnvelope} from './notifications/delivery.js';
const settings={encryptionKey:'fixture',rateLimitKey:'fixture',mailFrom:'Tribe ID <notifications@example.invalid>',smtpUrl:'smtps://smtp.example.invalid'};
test('informational SMTP uses generic copy, deterministic Message-ID and submitted status',async()=>{
 const sent:unknown[]=[];let closed=0;
 const adapter=new InformationalEmailTransport(settings,()=>({sendMail:async message=>{sent.push(message);return {accepted:[message.to]};},close:()=>{closed++;}}));
 const message:InformationalEnvelope={idempotencyKey:randomUUID(),recipient:{membershipId:randomUUID(),email:'recipient@example.invalid'},title:'Private title',body:'Private body',data:{notificationId:randomUUID(),tribeId:randomUUID()}};
 assert.deepEqual(await adapter.send(message,new AbortController().signal),{status:'submitted',reference:'smtp:'+message.idempotencyKey});await adapter.send(message,new AbortController().signal);
 assert.deepEqual(sent[0],sent[1]);assert.ok(!JSON.stringify(sent).includes('Private'));assert.ok(!JSON.stringify(sent).includes(message.data.notificationId));assert.equal(closed,2);
});
test('informational SMTP rejects no recipient acceptance and pre-aborted requests',async()=>{
 const adapter=new InformationalEmailTransport(settings,()=>({sendMail:async()=>({accepted:[]}),close:()=>{}}));
 const message:InformationalEnvelope={idempotencyKey:randomUUID(),recipient:{membershipId:randomUUID(),email:'recipient@example.invalid'},title:'x',body:'x',data:{notificationId:randomUUID(),tribeId:randomUUID()}};
 await assert.rejects(adapter.send(message,new AbortController().signal));const controller=new AbortController();controller.abort();await assert.rejects(adapter.send(message,controller.signal));
});
