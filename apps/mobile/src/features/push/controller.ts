import {parseInbox} from '../settings/preferences';
/** Push payloads are navigation hints only. All member data is fetched with the current session. */
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function pushHint(data:unknown):{tribeId:string;notificationId:string}|null {
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const item=data as Record<string,unknown>;
 return Object.keys(item).length===2&&uuid(item.tribeId)&&uuid(item.notificationId)?{tribeId:item.tribeId,notificationId:item.notificationId}:null;
}
export type PushStatus='unavailable'|'disabled'|'permission-needed'|'denied'|'registering'|'registered'|'retry';
export interface PushAdapter {
 available():boolean;
 permission(request:boolean):Promise<boolean>;
 token():Promise<{provider:'expo';platform:'android'|'ios';token:string}>;
 listen(received:()=>void,tapped:(data:unknown)=>void,rolled:()=>void):()=>void;
 lastResponse():Promise<unknown>;
 clearResponse():Promise<void>;
}
export interface PushBackend {
 preferences(tribeId:string):Promise<{pushNotifications:boolean}>;
 memberships():Promise<{memberships:{tribeId:string}[]}>;
 notification(tribeId:string,notificationId:string):Promise<unknown>;
 register(data:{provider:'expo';platform:'android'|'ios';token:string}):Promise<void>;
 unregister():Promise<void>;
}
export class PushController {
 private generation=0;private stopped=false;private remove:(()=>void)|null=null;private busy:Promise<void>|null=null;private seen=new Set<string>();private tapPending=new Set<string>();private tribe:string|null=null;
 constructor(private readonly adapter:PushAdapter,private readonly backend:PushBackend,private readonly status:(value:PushStatus)=>void,private readonly navigate:(tribeId:string,route:'events'|'announcements'|'notifications')=>void,private readonly received:()=>void){}
 start(){this.stopped=false;this.remove?.();this.remove=this.adapter.listen(()=>{if(!this.stopped)this.received();},data=>{void this.tap(data);},()=>{if(this.tribe)void this.sync(this.tribe,false);});void this.adapter.lastResponse().then(data=>this.tap(data)).catch(()=>{});}
 async tap(data:unknown){const hint=pushHint(data);if(!hint||this.stopped)return;const epoch=this.generation,key=hint.tribeId+':'+hint.notificationId;if(this.seen.has(key)||this.tapPending.has(key))return;this.tapPending.add(key);try{const active=await this.backend.memberships();if(this.stopped||epoch!==this.generation||!active.memberships.some(item=>item.tribeId===hint.tribeId))return;const notification=parseInbox({notifications:[await this.backend.notification(hint.tribeId,hint.notificationId)]}).notifications[0]!;if(notification.id!==hint.notificationId||this.stopped||epoch!==this.generation)return;const route=notification.source?.type==='event'?'events':notification.source?.type==='announcement'?'announcements':'notifications';this.seen.add(key);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value!);await this.adapter.clearResponse().catch(()=>{});if(!this.stopped&&epoch===this.generation)this.navigate(hint.tribeId,route);}catch{/* Never navigate from unauthenticated or unverifiable payloads. */}finally{this.tapPending.delete(key);}}
 sync(tribeId:string,request=false):Promise<void>{this.tribe=tribeId;if(this.busy)return this.busy.then(()=>this.stopped?undefined:this.sync(tribeId,request));this.busy=this.reconcile(tribeId,request).finally(()=>{this.busy=null;});return this.busy;}
 private async reconcile(tribeId:string,request:boolean){const epoch=this.generation;const current=()=>!this.stopped&&epoch===this.generation;try{
  if(!this.adapter.available()){if(current())this.status('unavailable');return;}
  const preferences=await this.backend.preferences(tribeId);if(!current())return;
  // Preferences are per Tribe, registrations per device session. A disabled Tribe must not revoke other Tribe opt-ins.
  if(!preferences.pushNotifications){this.status('disabled');return;}
  const granted=await this.adapter.permission(request);if(!current())return;if(!granted){await this.backend.unregister();if(current())this.status(request?'denied':'permission-needed');return;}
  this.status('registering');const token=await this.adapter.token();if(!current())return;await this.backend.register(token);if(current())this.status('registered');
 }catch{if(current())this.status('retry');}}
 stop(){this.stopped=true;this.generation++;this.tribe=null;this.remove?.();this.remove=null;this.seen.clear();this.tapPending.clear();void this.adapter.clearResponse().catch(()=>{});}
 /** Invoke before server logout; session invalidation independently excludes this device from delivery. */
 async revoke(){const pending=this.busy;this.stop();try{await pending;await this.backend.unregister();}catch{/* Logout still invalidates the server device session, including on uncertain registration. */}}
}
