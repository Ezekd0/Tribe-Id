import type {PortraitMimeType,PortraitResponse,PortraitUploadResponse} from '@trueda-tribe-id/contracts';
import {ApiFailure} from '../../api/client';
export const maximumPortraitBytes=5*1024*1024;
export function privatePortraitUrl(value:unknown):value is string {if(typeof value!=='string'||value.length>8192)return false;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^[a-f0-9]{32}(?:\.eu)?\.r2\.cloudflarestorage\.com$/.test(url.hostname);}catch{return false;}}
const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function parsePortrait(value:unknown):PortraitResponse {const v=value as Partial<PortraitResponse>|null;if(v&&Object.keys(v).length===3&&v.assetId===null&&v.url===null&&v.expiresAt===null)return {assetId:null,url:null,expiresAt:null};if(!v||Object.keys(v).length!==3||!uuid(v.assetId)||!privatePortraitUrl(v.url)||!timestamp(v.expiresAt))throw new ApiFailure(502,'The private portrait response could not be validated.');return {assetId:v.assetId,url:v.url,expiresAt:v.expiresAt};}
export function parsePortraitUpload(value:unknown,mimeType:PortraitMimeType):PortraitUploadResponse {const v=value as Partial<PortraitUploadResponse>|null;if(!v||Object.keys(v).length!==4||!uuid(v.assetId)||!privatePortraitUrl(v.uploadUrl)||!timestamp(v.expiresAt)||Date.parse(v.expiresAt)<=Date.now()||!v.headers||Object.keys(v.headers).length!==1||v.headers['Content-Type']!==mimeType)throw new ApiFailure(502,'The private upload response could not be validated.');return {assetId:v.assetId,uploadUrl:v.uploadUrl,expiresAt:v.expiresAt,headers:{'Content-Type':mimeType}};}
export function portraitMime(bytes:Uint8Array):PortraitMimeType {
 if(!bytes.byteLength||bytes.byteLength>maximumPortraitBytes)throw new Error('Choose a PNG, JPEG or WebP image up to 5 MiB.');
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 throw new Error('Choose a supported PNG, JPEG or WebP image. The server will validate the complete image before publishing it.');
}
