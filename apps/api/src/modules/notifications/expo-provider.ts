/** Fixed HTTPS endpoints; injected fetch is for local tests, never endpoint overrides. */
export type ExpoOutcome={status:'accepted';id:string}|{status:'rejected';code:ExpoError;retry:boolean};
export type ExpoError='DeviceNotRegistered'|'MessageTooBig'|'MessageRateExceeded'|'MismatchSenderId'|'InvalidCredentials'|'transport'|'protocol'|'receipt_expired'|'unavailable';
const codes=new Set(['DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials']);
export function outcome(value:unknown):ExpoOutcome {
 if(!value||typeof value!=='object')return {status:'rejected',code:'protocol',retry:true};
 const data=value as Record<string,unknown>;
 if(data.status==='ok'&&typeof data.id==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(data.id))return {status:'accepted',id:data.id};
 if(data.status==='error') {const raw=(data.details as {error?:unknown}|undefined)?.error;const code=typeof raw==='string'&&codes.has(raw)?raw as ExpoError:'protocol';return {status:'rejected',code,retry:code==='MessageRateExceeded'||code==='protocol'};}
 return {status:'rejected',code:'protocol',retry:true};
}
export class ExpoProvider {
 constructor(private readonly accessToken:string,private readonly fetcher:typeof fetch=fetch) {if(!accessToken||/[\s\x00-\x1f]/.test(accessToken))throw new Error('Explicit Expo access token required');}
 private async request(path:'send'|'getReceipts',body:unknown,signal:AbortSignal):Promise<unknown> {
  const response=await this.fetcher('https://exp.host/--/api/v2/push/'+path,{method:'POST',headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+this.accessToken},body:JSON.stringify(body),signal,redirect:'error'});
  if(!response.ok)throw new ExpoRequestError(response.status===429||response.status>=500?'transport':'InvalidCredentials',response.status===429||response.status>=500);
  // Stream bounded responses; never include raw provider content in errors or logs.
  if(!response.body)throw new ExpoRequestError('protocol',true);
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072)throw new ExpoRequestError('protocol',true);chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ExpoRequestError('protocol',true);}
 }
 async send(messages:{to:string;data:{notificationId:string;tribeId:string}}[],signal:AbortSignal):Promise<ExpoOutcome[]> {
  if(messages.length<1||messages.length>100)throw new Error('Expo batch must be 1–100');
  const body=await this.request('send',messages.map(message=>({...message,title:'Tribe ID',body:'You have a Tribe notification',sound:'default',channelId:'tribe-notifications',ttl:3600})),signal) as {data?:unknown};
  if(!Array.isArray(body?.data)||body.data.length!==messages.length)throw new ExpoRequestError('protocol',true);
  return body.data.map(outcome);
 }
 async receipts(ids:string[],signal:AbortSignal):Promise<Record<string,'ok'|ExpoOutcome>> {
  if(ids.length<1||ids.length>100)throw new Error('Receipt batch must be 1–100');
  const body=await this.request('getReceipts',{ids},signal) as {data?:unknown};
  if(!body?.data||typeof body.data!=='object'||Array.isArray(body.data))throw new ExpoRequestError('protocol',true);
  const result:Record<string,'ok'|ExpoOutcome>={};
  for(const id of ids){const value=(body.data as Record<string,unknown>)[id];if(value!==undefined)result[id]=value&&typeof value==='object'&&(value as {status?:unknown}).status==='ok'?'ok':outcome(value);}
  return result;
 }
}
export class ExpoRequestError extends Error {constructor(readonly code:ExpoError,readonly retry:boolean){super('Push provider request failed');}}
