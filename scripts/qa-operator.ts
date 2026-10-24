import { SessionCore } from '../apps/mobile/src/auth/session-core.js';
import { ApiClient } from '../apps/mobile/src/api/client.js';
import { AuthService } from '../apps/mobile/src/api/auth-service.js';
import { mobileEnvironment } from '../apps/mobile/src/api/environment.js';
// Operator credentials/bearer token come from private stdin; never argv, source or logs.
// Calls the real authority APIs: no direct membership state edits or auth bypass.
if (process.env.QA_OPERATOR_CONFIRM !== 'private-test-enrollment') throw new Error('Explicit QA operator confirmation required');
const {baseUrl}=mobileEnvironment(process.env.QA_API_URL,'development',true);
const tribe=process.env.QA_TRIBE_ID, action=process.env.QA_ACTION;
if (!tribe || !/^[0-9a-f-]{36}$/i.test(tribe) || !['invite','activate'].includes(action ?? '')) throw new Error('Specify QA_TRIBE_ID and QA_ACTION=invite|activate');
let input='';
for await (const chunk of process.stdin) {input+=chunk.toString();if(Buffer.byteLength(input)>1024)throw new Error('Operator input too large');}
let token='';
const session=new SessionCore(baseUrl,{read:async()=>null,write:async()=>{},remove:async()=>{}});
const api=new ApiClient(baseUrl,session), auth=new AuthService(baseUrl,session,api);
const operations:{path:string;body:Record<string,string>}[]=[];
if(action==='invite') {
 const emails=(process.env.QA_EMAILS ?? process.env.QA_EMAIL ?? '').split(',').map(value=>value.trim()).filter(Boolean);
 const numbers=(process.env.QA_MEMBER_NUMBERS ?? process.env.QA_MEMBER_NUMBER ?? '').split(',').map(value=>value.trim()).filter(Boolean);
 if(!emails.length||emails.length>4||emails.length!==numbers.length)throw new Error('Specify one to four paired tester emails and allocated member numbers');
 emails.forEach((email,index)=>operations.push({path:`/api/v1/tribes/${tribe}/invitations`,body:{email,memberNumber:numbers[index]!}}));
} else {
 const ids=(process.env.QA_MEMBERSHIP_IDS ?? process.env.QA_MEMBERSHIP_ID ?? '').split(',').map(value=>value.trim()).filter(Boolean),evidenceReference=process.env.QA_APPROVAL_REFERENCE;
 if(!ids.length||ids.length>4||ids.some(id=>!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id))||!evidenceReference)throw new Error('Specify one to four membership UUIDs and actual approval reference');
 ids.forEach(id=>operations.push({path:`/api/v1/tribes/${tribe}/memberships/${id}/activate`,body:{evidenceReference}}));
}

try {
 if(process.env.QA_OPERATOR_EMAIL) {
  const [password='',code='']=input.replace(/\r/g,'').split('\n');
  const challenge=await auth.login(process.env.QA_OPERATOR_EMAIL,password);
  if(!challenge || challenge.enrollmentRequired)throw new Error('Enroll the operator authenticator in the app first; an MFA challenge is required');
  await auth.mfa(challenge.challengeToken,code);token=session.token()!;
 } else {token=input.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Private MFA-authenticated bearer token required');}
 input='';
 let completed=0;
 for(const {path,body} of operations) {
  const response=await fetch(baseUrl+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Authority API denied or failed: HTTP ${response.status}; ${completed} earlier operations completed; no automatic retry`);
  completed++;
 }
 console.log(action==='invite'?`${completed} invitations queued in the real email outbox; run the delivery worker.`:`${completed} memberships activated by the real authority API.`);

}finally{input='';if(session.token()){try{await api.logout();}catch{console.error('Operator logout unconfirmed; revoke this operator device in Account Security.');}}token='';}
