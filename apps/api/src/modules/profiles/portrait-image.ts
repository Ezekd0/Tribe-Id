import sharp from 'sharp';
import type {PortraitMimeType} from '@trueda-tribe-id/contracts';
const formats:Record<PortraitMimeType,string>={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'};
export async function normalizePortrait(bytes:Buffer,mimeType:PortraitMimeType):Promise<Buffer>{
  const image=sharp(bytes,{limitInputPixels:16_777_216,sequentialRead:true,failOn:'warning'});
  const metadata=await image.metadata();
  if(metadata.format!==formats[mimeType]||(metadata.pages??1)!==1||!metadata.width||!metadata.height)throw new Error('INVALID_IMAGE');
  // Re-encoding strips metadata and active/polyglot payloads; never serve uploaded originals.
  const result=await image.rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
  if(!result.length||result.length>5*1024*1024)throw new Error('INVALID_IMAGE');return result;
}
