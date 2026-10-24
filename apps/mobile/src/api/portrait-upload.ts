import type {PortraitUploadResponse} from '@trueda-tribe-id/contracts';import {timedFetch} from './transport';import {parsePortraitUpload,portraitMime} from '../features/portrait/portrait-contract';
/** The signed storage request never receives the API bearer credential. No automatic retries. */
export async function putPortrait(upload:PortraitUploadResponse,bytes:Uint8Array,transport:typeof fetch=fetch){
 const mimeType=portraitMime(bytes);const destination=parsePortraitUpload(upload,mimeType);
 const response=await timedFetch(transport)(destination.uploadUrl,{method:'PUT',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':mimeType},body:new Uint8Array(bytes).buffer});
 if(!response.ok)throw new Error('The private upload could not be confirmed.');
}
