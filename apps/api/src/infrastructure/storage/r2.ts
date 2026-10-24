import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export interface ObjectStore {
  presignUpload(key:string,mimeType:string,size:number,seconds:number):Promise<string>;
  presignDownload(key:string,seconds:number):Promise<string>;
  read(key:string,expectedSize:number,maxBytes:number):Promise<Buffer>;
  write(key:string,bytes:Buffer,mimeType:string):Promise<void>;
  delete(key:string):Promise<void>;
}
export interface R2Settings {accountId:string;accessKeyId:string;secretAccessKey:string;bucket:string;jurisdiction:'eu'|'default'}
export function readR2Settings(source:NodeJS.ProcessEnv=process.env):R2Settings|null {
  const names=['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'] as const;
  if(names.every(name=>!source[name]))return null;
  if(names.some(name=>!source[name])||! /^[a-f0-9]{32}$/.test(source.R2_ACCOUNT_ID!)||! /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(source.R2_BUCKET!)||source.R2_BUCKET!.includes('..')||!['eu','default'].includes(source.R2_JURISDICTION??'eu'))throw new Error('Invalid private R2 configuration; supply all required server-only settings.');
  return {accountId:source.R2_ACCOUNT_ID!,accessKeyId:source.R2_ACCESS_KEY_ID!,secretAccessKey:source.R2_SECRET_ACCESS_KEY!,bucket:source.R2_BUCKET!,jurisdiction:(source.R2_JURISDICTION??'eu') as 'eu'|'default'};
}
export function createR2Store(settings:R2Settings):R2ObjectStore {
  const jurisdiction=settings.jurisdiction==='eu'?'.eu':'';
  return new R2ObjectStore(new S3Client({region:'auto',endpoint:`https://${settings.accountId}${jurisdiction}.r2.cloudflarestorage.com`,credentials:{accessKeyId:settings.accessKeyId,secretAccessKey:settings.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',requestHandler:{connectionTimeout:5000,requestTimeout:10000}}),settings.bucket);
}
// A supplied S3Client lets tests use a local S3-compatible endpoint; no endpoint comes from HTTP input.
export class R2ObjectStore implements ObjectStore {
  constructor(private readonly client:S3Client,private readonly bucket:string){}
  presignUpload(key:string,mimeType:string,size:number,seconds:number){return getSignedUrl(this.client,new PutObjectCommand({Bucket:this.bucket,Key:key,ContentType:mimeType,ContentLength:size}),{expiresIn:seconds,signableHeaders:new Set(['content-type','content-length'])});}
  presignDownload(key:string,seconds:number){return getSignedUrl(this.client,new GetObjectCommand({Bucket:this.bucket,Key:key}),{expiresIn:seconds});}
  async read(key:string,expectedSize:number,maxBytes:number){
    const head=await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));
    if(head.ContentLength!==expectedSize||expectedSize>maxBytes)throw new Error('INVALID_IMAGE');
    const response=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));
    const stream=response.Body as (AsyncIterable<Uint8Array>&{destroy?:()=>void})|undefined;
    if(!stream||typeof stream[Symbol.asyncIterator]!=='function')throw new Error('INVALID_IMAGE');
    let size=0;const chunks:Buffer[]=[];
    try{for await(const chunk of stream){size+=chunk.byteLength;if(size>maxBytes||size>expectedSize)throw new Error('INVALID_IMAGE');chunks.push(Buffer.from(chunk));}}
    catch(error){stream.destroy?.();throw error;}
    if(size!==expectedSize)throw new Error('INVALID_IMAGE');return Buffer.concat(chunks);
  }
  async write(key:string,bytes:Buffer,mimeType:string){await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,ContentType:mimeType,CacheControl:'private, no-store',ContentDisposition:'inline; filename="portrait.webp"'}));}
  async delete(key:string){await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));}
}
