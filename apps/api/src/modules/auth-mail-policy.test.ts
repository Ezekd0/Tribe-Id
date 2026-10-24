import test from 'node:test';import assert from 'node:assert/strict';
import {assertAuthMailDeliveryAllowed} from './auth/mail-policy.js';
const settings={smtpUrl:'smtps://smtp.example.invalid',mailFrom:'test@example.invalid',encryptionKey:'fixture',rateLimitKey:'fixture'};
test('authentication worker cannot send external mail by scheduling or auth configuration alone',()=>{
 for(const flag of [undefined,'false','TRUE','1',''])assert.throws(()=>assertAuthMailDeliveryAllowed(settings,'production',flag));
 assert.doesNotThrow(()=>assertAuthMailDeliveryAllowed(settings,'production','true'));
 assert.throws(()=>assertAuthMailDeliveryAllowed(settings,'test',undefined));
});
test('credential-free loopback capture remains available only outside production',()=>{
 for(const host of ['127.0.0.1','localhost','[::1]'])assert.doesNotThrow(()=>assertAuthMailDeliveryAllowed({...settings,mailMode:'local-capture',smtpUrl:'smtp://'+host+':1025'},'test',undefined));
 for(const url of ['smtp://external.example.invalid','smtp://user:password@localhost','smtps://localhost'])assert.throws(()=>assertAuthMailDeliveryAllowed({...settings,mailMode:'local-capture',smtpUrl:url},'test','true'));
 assert.throws(()=>assertAuthMailDeliveryAllowed({...settings,mailMode:'local-capture',smtpUrl:'smtp://127.0.0.1'},'production','true'));
});
