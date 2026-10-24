import {File,FileMode} from 'expo-file-system';
import {maximumPortraitBytes,portraitMime} from './portrait-contract';import {withSystemPicker} from './system-picker';
export interface SelectedPortrait {bytes:Uint8Array<ArrayBuffer>;mimeType:'image/png'|'image/jpeg'|'image/webp';uri:string}
export async function pickPortrait():Promise<SelectedPortrait|null>{return withSystemPicker(async()=>{
 const selected=await File.pickFileAsync({mimeTypes:['image/png','image/jpeg','image/webp'],multipleFiles:false});if(selected.canceled)return null;
 if(!Number.isInteger(selected.result.size)||selected.result.size<1||selected.result.size>maximumPortraitBytes)throw new Error('Choose an image up to 5 MiB.');
 const handle=selected.result.open(FileMode.ReadOnly);try{const bytes=handle.readBytes(maximumPortraitBytes+1);return {bytes,mimeType:portraitMime(bytes),uri:selected.result.uri};}catch{throw new Error('Choose a supported PNG, JPEG or WebP image up to 5 MiB.');}finally{handle.close();}
});}
