import { isMfaChallenge,isMfaVerificationResponse } from '@trueda-tribe-id/contracts';
import type { ApiError, MemberView, SessionView, MfaChallenge } from '@trueda-tribe-id/contracts';
import { SessionCore, isTokens } from '../../../mobile/src/auth/session-core';
import { ApiClient, ApiFailure } from '../../../mobile/src/api/client';
export { ApiFailure };
// Both credentials live only in this tab's JavaScript memory. Reload requires sign-in.
let refreshCredential:string|null=null;
const transport:typeof fetch=(input,init)=>fetch(input,{...init,credentials:'omit',cache:'no-store'});
const session=new SessionCore('',{async read(){return refreshCredential;},async write(value){refreshCredential=value;},async remove(){refreshCredential=null;}},transport);
const api=new ApiClient('',session,transport);
export type Challenge = MfaChallenge;
async function publicPost(path:string,body:Record<string,string>):Promise<unknown>{
  const response=await transport(`/api/v1/auth/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){const error=await response.json().catch(()=>null) as ApiError|null;throw new ApiFailure(response.status,error?.error?.message??'Sign-in could not be completed. Check your credentials and try again.');}
  return response.json();
}
export async function login(email:string,password:string):Promise<Challenge|null>{
  const result=await publicPost('login',{email:email.trim(),password,deviceName:'Trueda web reference'});
  if(isTokens(result)){await session.accept(result);return null;}
  if(!isMfaChallenge(result))throw new ApiFailure(502,'Invalid authentication response.');
  return result;
}
export async function verifyMfa(challengeToken:string,code:string){
  const result=await publicPost('mfa/verify',{challengeToken,code:code.trim()});
  if(!isMfaVerificationResponse(result))throw new ApiFailure(502,'Invalid authentication response.');
  await session.accept(result);return result.recoveryCodes??[];
}
export const previewEnabled=import.meta.env.DEV && import.meta.env.VITE_MEMBER_PREVIEW==='true';
export async function loadMember(signal:AbortSignal):Promise<MemberView|null> {
  if (previewEnabled) {
    const scenario=new URLSearchParams(location.search).get('previewState')??'normal';
    const response=await transport(`/api/v1/development/member-view?scenario=${encodeURIComponent(scenario)}`,{signal});
    if(!response.ok)throw new ApiFailure(response.status,'Unable to load preview.');
    return ((await response.json()) as {view:MemberView}).view;
  }
  const current=await api.get<SessionView>('/api/v1/me');
  const first=current.memberships[0];
  if (!first) return null;
  return api.get<MemberView>(`/api/v1/tribes/${encodeURIComponent(first.tribeId)}/member-view`);
}
export async function logout(){await api.logout();}

export async function setupMfa(challengeToken:string){const value=await publicPost('mfa/setup',{challengeToken}) as {secret?:unknown;otpAuthUrl?:unknown};if(!value||typeof value.secret!=='string'||!/^[A-Z2-7]{16,200}$/.test(value.secret)||typeof value.otpAuthUrl!=='string'||!value.otpAuthUrl.startsWith('otpauth://'))throw new ApiFailure(502,'Invalid authenticator setup response.');return {secret:value.secret};}
export async function recoverMfa(challengeToken:string,recoveryCode:string){const value=await publicPost('mfa/recover',{challengeToken,recoveryCode:recoveryCode.trim()});if(!isMfaChallenge(value))throw new ApiFailure(502,'Invalid authenticator recovery response.');return value;}
export const protectedGet=<T,>(path:string,query?:Record<string,string|number|undefined>)=>api.get<T>('/api/v1'+path,query);
export const protectedPost=<T,>(path:string,body?:object)=>api.write<T>('/api/v1'+path,'POST',body);
export const protectedPatch=<T,>(path:string,body:object)=>api.write<T>('/api/v1'+path,'PATCH',body);
export const protectedDelete=<T,>(path:string)=>api.write<T>('/api/v1'+path,'DELETE');
