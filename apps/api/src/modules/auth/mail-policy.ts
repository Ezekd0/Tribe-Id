import type {AuthSettings} from './support.js';
/** Scheduling is not authorization to contact a real recipient. */
export function assertAuthMailDeliveryAllowed(settings:AuthSettings,nodeEnv:string,enabled:string|undefined) {
 if(settings.mailMode==='local-capture'&&nodeEnv!=='production') {
  let url:URL;try{url=new URL(settings.smtpUrl);}catch{throw new Error('Invalid local capture configuration');}
  if(url.protocol==='smtp:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password)return;
 }
 if(settings.mailMode==='local-capture'||enabled!=='true')throw new Error('External authentication mail delivery requires explicit authorization flag');
}
