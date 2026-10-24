import nodemailer from 'nodemailer';
import type {AuthSettings} from '../auth/support.js';
import type {InformationalEnvelope,InformationalTransport,InformationalResult} from './delivery.js';
interface MailTransport {sendMail(message:{from:string;to:string;subject:string;text:string;messageId:string}):Promise<{accepted?:unknown[]}>;close():void}
export class InformationalEmailTransport implements InformationalTransport {
 constructor(private readonly settings:AuthSettings,private readonly factory:()=>MailTransport=()=>{
  const url=new URL(settings.smtpUrl),local=settings.mailMode==='local-capture';
  if(!['smtp:','smtps:'].includes(url.protocol)||/[\r\n]/.test(settings.mailFrom))throw new Error('Invalid SMTP configuration');
  if(local&&(process.env.NODE_ENV==='production'||url.protocol!=='smtp:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password))throw new Error('Unsafe local mail configuration');
  return nodemailer.createTransport({host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||(url.protocol==='smtps:'?465:587)),secure:url.protocol==='smtps:',...(url.username?{auth:{user:decodeURIComponent(url.username),pass:decodeURIComponent(url.password)}}:{}),requireTLS:!local,ignoreTLS:local,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
 }){}
 async send(message:InformationalEnvelope,signal:AbortSignal):Promise<InformationalResult>{
  const to=message.recipient.email;
  if(!to||/[\r\n]/.test(to)||!/^[0-9a-f-]{36}$/i.test(message.idempotencyKey)||signal.aborted)throw new Error('Invalid informational email envelope');
  const domain=/@([a-z0-9.-]+)(?:>|$)/i.exec(this.settings.mailFrom)?.[1];
  if(!domain)throw new Error('Configured sender domain required');
  const transport=this.factory(),abort=()=>transport.close();signal.addEventListener('abort',abort,{once:true});
  try{const result=await transport.sendMail({from:this.settings.mailFrom,to,subject:'Tribe ID notification',text:'You have a Tribe notification. Open Tribe ID and sign in to view your inbox.',messageId:'<tribe-'+message.idempotencyKey+'@'+domain+'>'});
   if(signal.aborted||!result.accepted?.includes(to))throw new Error('Informational email not acknowledged');
   // SMTP acceptance is not proof of mailbox/device delivery. Deterministic Message-ID is not an exactly-once guarantee.
   return {status:'submitted',reference:'smtp:'+message.idempotencyKey};
  }finally{signal.removeEventListener('abort',abort);transport.close();}
 }
}
