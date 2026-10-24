import {Pool} from 'pg';
import {readEnvironment} from '../config/env.js';
import {NotificationDeliveryWorker,type InformationalTransport} from '../modules/notifications/delivery.js';
import {ExpoProvider} from '../modules/notifications/expo-provider.js';
import {ExpoPushTransport} from '../modules/notifications/expo-delivery.js';
import {InformationalEmailTransport} from '../modules/notifications/email-delivery.js';
// Explicit opt-in: API startup, checks, and exports never contact delivery providers.
const push=process.env.PUSH_DELIVERY_ENABLED==='true',email=process.env.INFORMATIONAL_EMAIL_ENABLED==='true';
if(!push&&!email)throw new Error('Explicit informational delivery enable flag required');
const key=process.env.AUTH_ENCRYPTION_KEY??'';
if(!process.env.DATABASE_URL||Buffer.from(key,'base64').length!==32||(push&&!process.env.EXPO_ACCESS_TOKEN))throw new Error('Configured database, encryption key and enabled provider credentials required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
try{
 const transport=push?new ExpoPushTransport(pool,new ExpoProvider(process.env.EXPO_ACCESS_TOKEN!),key):null;
 const transports:Partial<Record<'push'|'email',InformationalTransport>>={...(transport?{push:transport}:{})};
 if(email){const env=readEnvironment();if(!env.auth)throw new Error('Validated authentication SMTP settings required');transports.email=new InformationalEmailTransport(env.auth);}
 const delivery=await new NotificationDeliveryWorker(pool,key,transports).run(50);const receipts=transport?await transport.receipts(50):{checked:0};
 console.log(JSON.stringify({event:'informational_worker_batch',delivery,receipts,...(transport?{states:await transport.metrics()}:{})}));
}catch{console.error(JSON.stringify({event:'informational_worker_failed',code:'operation_failed'}));process.exitCode=1;}finally{await pool.end();}
