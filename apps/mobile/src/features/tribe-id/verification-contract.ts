import type {CardProofResponse,CardVerificationResponse} from '@trueda-tribe-id/contracts';
import {ApiFailure} from '../../api/client';
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function text(value:unknown,max=2000):value is string{return typeof value==='string'&&value.length>0&&value.length<=max;}
function timestamp(value:unknown):value is string{return text(value,64)&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));}
export function parseCardProof(value:unknown):CardProofResponse{
 if(!exact(value,['proof','expiresAt'])||!text(value.proof,2048)||!timestamp(value.expiresAt))throw new ApiFailure(502,'The card proof response could not be validated. Refresh and try again.');
 return {proof:value.proof,expiresAt:value.expiresAt};
}
export function parseCardVerification(value:unknown):CardVerificationResponse{
 if(!exact(value,['displayName','memberNumber','status','expiresAt'])||!text(value.displayName)||!text(value.memberNumber)||value.status!=='issued'||!timestamp(value.expiresAt)||Date.parse(value.expiresAt)<=Date.now())throw new ApiFailure(502,'The card verification response could not be validated. Try again.');
 return {displayName:value.displayName,memberNumber:value.memberNumber,status:value.status,expiresAt:value.expiresAt};
}
