import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {PortraitMimeType,PortraitUploadRequest,PortraitUploadResponse,PortraitResponse} from '@trueda-tribe-id/contracts';
import type {ObjectStore} from '../../infrastructure/storage/r2.js';
import type {SessionIdentity} from '../authentication/session.js';
import {transaction} from '../auth/support.js';
import {enabledIdentity} from '../auth/repository.js';
import {ServiceError} from '../../infrastructure/security/error.js';
import {normalizePortrait} from './portrait-image.js';
const maxSize=5*1024*1024;
const unavailable=()=>new ServiceError(404,'PORTRAIT_NOT_FOUND','Portrait is unavailable.');
export function validatePortraitUpload(input:unknown):PortraitUploadRequest {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ServiceError(400,'VALIDATION_FAILED','Image type, size and explicit portrait-upload consent are required.');
  const v=input as Record<string,unknown>;
  if(Object.keys(v).length!==3||Object.keys(v).some(k=>!['mimeType','sizeBytes','consent'].includes(k))||typeof v.mimeType!=='string'||!['image/png','image/jpeg','image/webp'].includes(v.mimeType)||!Number.isInteger(v.sizeBytes)||Number(v.sizeBytes)<1||Number(v.sizeBytes)>maxSize||v.consent!==true)throw new ServiceError(400,'VALIDATION_FAILED','Choose a PNG, JPEG or WebP image up to 5 MiB and explicitly consent to its upload.');
  return v as unknown as PortraitUploadRequest;
}
interface Asset {id:string;storage_key:string;upload_key:string|null;upload_expires_at:Date|null;source_mime_type:PortraitMimeType|null;declared_size_bytes:string|null;status:string}
let processing=0;
export class PortraitService {
  constructor(private readonly pool:Pool,private readonly store:ObjectStore){}
  private async context(db:PoolClient,identity:SessionIdentity,tribeId:string){
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
    if(!(await db.query(`SELECT s.id FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND ${enabledIdentity} FOR UPDATE OF s`,[identity.sessionId,identity.userId])).rowCount)throw new ServiceError(401,'SESSION_REQUIRED','A valid member session is required.');
    const membership=(await db.query<{id:string}>("SELECT id FROM tribe_memberships WHERE user_id=$1 AND tribe_id=$2 AND status='active' FOR NO KEY UPDATE",[identity.userId,tribeId])).rows[0];
    if(!membership)throw unavailable();
    const profile=(await db.query<{avatar_asset_id:string|null}>('SELECT avatar_asset_id FROM profiles WHERE membership_id=$1 AND tribe_id=$2 FOR UPDATE',[membership.id,tribeId])).rows[0];
    if(!profile)throw unavailable();return {membershipId:membership.id,assetId:profile.avatar_asset_id};
  }
  private async audit(db:PoolClient,identity:SessionIdentity,tribeId:string,membershipId:string,action:string){await db.query("INSERT INTO audit_logs(tribe_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'profile',$4,'{}'::jsonb)",[tribeId,identity.userId,action,membershipId]);}
  async initiate(identity:SessionIdentity,tribeId:string,input:unknown):Promise<PortraitUploadResponse>{
    const request=validatePortraitUpload(input),assetId=randomUUID(),key=`quarantine/${tribeId}/${assetId}`;
    return transaction(this.pool,async db=>{
      const context=await this.context(db,identity,tribeId);
      const pending=(await db.query<{count:string}>("SELECT count(*) FROM assets WHERE uploaded_by=$1 AND tribe_id=$2 AND status='pending' AND upload_expires_at>clock_timestamp()",[identity.userId,tribeId])).rows[0];
      if(Number(pending?.count)>=3)throw new ServiceError(429,'UPLOAD_LIMIT','Finish or wait for existing image uploads before starting another.');
      const expiresAt=new Date(Date.now()+300000).toISOString();
      await db.query("INSERT INTO assets(id,tribe_id,uploaded_by,storage_key,upload_key,upload_expires_at,mime_type,source_mime_type,size_bytes,declared_size_bytes) VALUES($1,$2,$3,$4,$4,$5,$6,$6,$7,$7)",[assetId,tribeId,identity.userId,key,expiresAt,request.mimeType,request.sizeBytes]);
      const uploadUrl=await this.store.presignUpload(key,request.mimeType,request.sizeBytes,300);
      await this.audit(db,identity,tribeId,context.membershipId,'portrait.upload_consented');
      return {assetId,uploadUrl,expiresAt,headers:{'Content-Type':request.mimeType}};
    });
  }
  private async candidate(identity:SessionIdentity,tribeId:string,assetId:string){
    return transaction(this.pool,async db=>{await this.context(db,identity,tribeId);const asset=(await db.query<Asset>('SELECT * FROM assets WHERE id=$1 AND tribe_id=$2 AND uploaded_by=$3',[assetId,tribeId,identity.userId])).rows[0];if(!asset||asset.status==='rejected')throw unavailable();return asset;});
  }
  async finalize(identity:SessionIdentity,tribeId:string,assetId:string){
    const asset=await this.candidate(identity,tribeId,assetId);
    if(asset.status==='ready')return;
    if(!asset.upload_key||!asset.source_mime_type||!asset.upload_expires_at||asset.upload_expires_at.getTime()<=Date.now())throw new ServiceError(409,'UPLOAD_EXPIRED','Start a new portrait upload.');
    if(processing>=2)throw new ServiceError(503,'IMAGE_BUSY','Image validation is busy. Retry after checking the current portrait.');
    processing++;let readyKey:string|undefined,committed=false;
    try{
      let original:Buffer,bytes:Buffer;
      try{original=await this.store.read(asset.upload_key,Number(asset.declared_size_bytes),maxSize);}
      catch(error){if(error instanceof Error&&error.message==='INVALID_IMAGE'){await this.reject(identity,tribeId,assetId);throw new ServiceError(400,'INVALID_IMAGE','The uploaded file does not match its declared safe size.');}throw new ServiceError(503,'STORAGE_UNAVAILABLE','The private image could not be confirmed. Check the current portrait before retrying.');}
      try{bytes=await normalizePortrait(original,asset.source_mime_type);}catch{await this.reject(identity,tribeId,assetId);throw new ServiceError(400,'INVALID_IMAGE','The uploaded file is not a supported, safe portrait image.');}
      readyKey=`portraits/${tribeId}/${assetId}/${randomUUID()}.webp`;
      // A durable compensating deletion survives rollback/crash/ambiguous commit.
      // The same commit which makes the object authoritative removes this job.
      await this.pool.query("INSERT INTO asset_deletions(object_key,not_before) VALUES($1,clock_timestamp()+interval '15 minutes')",[readyKey]);
      try{await this.store.write(readyKey,bytes,'image/webp');}catch{throw new ServiceError(503,'STORAGE_UNAVAILABLE','The private image could not be confirmed. Check the current portrait before retrying.');}
      await transaction(this.pool,async db=>{
        const context=await this.context(db,identity,tribeId);
        const current=(await db.query<Asset>('SELECT * FROM assets WHERE id=$1 AND tribe_id=$2 AND uploaded_by=$3 FOR UPDATE',[assetId,tribeId,identity.userId])).rows[0];
        if(!current||current.status==='rejected')throw unavailable();
        if(current.status==='ready')return; // Another finalized attempt won; its object must never be deleted.
        if(!current.upload_expires_at||current.upload_expires_at.getTime()<=Date.now())throw new ServiceError(409,'UPLOAD_EXPIRED','Start a new portrait upload.');
        if(context.assetId&&context.assetId!==assetId)await this.retire(db,context.assetId,tribeId,identity.userId);
        await db.query("UPDATE assets SET storage_key=$2,mime_type='image/webp',size_bytes=$3,status='ready' WHERE id=$1",[assetId,readyKey,bytes.length]);
        await db.query('UPDATE profiles SET avatar_asset_id=$3,updated_at=clock_timestamp() WHERE membership_id=$1 AND tribe_id=$2',[context.membershipId,tribeId,assetId]);
        await db.query("INSERT INTO asset_deletions(object_key,not_before) VALUES($1,$2::timestamptz+interval '60 seconds') ON CONFLICT(object_key) DO NOTHING",[asset.upload_key,asset.upload_expires_at]);
        await this.audit(db,identity,tribeId,context.membershipId,'portrait.updated');committed=true;
        await db.query('DELETE FROM asset_deletions WHERE object_key=$1',[readyKey]);
      });
    }finally{
      processing--;
      // Unique attempt keys avoid deleting another successful finalizer's object.
      if(readyKey&&!committed)try{await this.store.delete(readyKey);}catch{await this.pool.query('INSERT INTO asset_deletions(object_key) VALUES($1) ON CONFLICT(object_key) DO NOTHING',[readyKey]);}
    }
  }
  private async reject(identity:SessionIdentity,tribeId:string,assetId:string){await transaction(this.pool,async db=>{
    await this.context(db,identity,tribeId);
    const row=(await db.query<Asset>("UPDATE assets SET status='rejected' WHERE id=$1 AND tribe_id=$2 AND uploaded_by=$3 AND status='pending' RETURNING *",[assetId,tribeId,identity.userId])).rows[0];
    if(row?.upload_key)await db.query("INSERT INTO asset_deletions(object_key,not_before) VALUES($1,$2::timestamptz+interval '60 seconds') ON CONFLICT(object_key) DO NOTHING",[row.upload_key,row.upload_expires_at]);
  });}
  private async retire(db:PoolClient,assetId:string,tribeId:string,userId:string){
    const row=(await db.query<{storage_key:string}>("UPDATE assets SET status='rejected' WHERE id=$1 AND tribe_id=$2 AND uploaded_by=$3 RETURNING storage_key",[assetId,tribeId,userId])).rows[0];
    if(row)await db.query('INSERT INTO asset_deletions(object_key) VALUES($1) ON CONFLICT(object_key) DO NOTHING',[row.storage_key]);
  }
  async remove(identity:SessionIdentity,tribeId:string){await transaction(this.pool,async db=>{
    const context=await this.context(db,identity,tribeId);if(!context.assetId)return;
    await this.retire(db,context.assetId,tribeId,identity.userId);
    await db.query('UPDATE profiles SET avatar_asset_id=NULL,updated_at=clock_timestamp() WHERE membership_id=$1 AND tribe_id=$2',[context.membershipId,tribeId]);
    await this.audit(db,identity,tribeId,context.membershipId,'portrait.removed');
  });}
  async own(identity:SessionIdentity,tribeId:string):Promise<PortraitResponse>{return transaction(this.pool,async db=>{
    const context=await this.context(db,identity,tribeId);return this.url(db,context.assetId,tribeId,identity.userId);
  });}
  private async url(db:PoolClient,assetId:string|null,tribeId:string,userId:string):Promise<PortraitResponse>{
    if(!assetId)return {assetId:null,url:null,expiresAt:null};
    const asset=(await db.query<{storage_key:string}>("SELECT storage_key FROM assets WHERE id=$1 AND tribe_id=$2 AND uploaded_by=$3 AND status='ready'",[assetId,tribeId,userId])).rows[0];
    if(!asset)return {assetId:null,url:null,expiresAt:null};
    return {assetId,url:await this.store.presignDownload(asset.storage_key,60),expiresAt:new Date(Date.now()+60000).toISOString()};
  }
}
export async function drainAssetDeletions(pool:Pool,store:ObjectStore,limit=20){
  let deleted=0;
  await pool.query(`WITH expired AS (SELECT id FROM assets WHERE status='pending' AND upload_expires_at<clock_timestamp() ORDER BY upload_expires_at LIMIT 100 FOR UPDATE SKIP LOCKED), retired AS (UPDATE assets a SET status='rejected' FROM expired e WHERE a.id=e.id RETURNING a.upload_key,a.upload_expires_at)
    INSERT INTO asset_deletions(object_key,not_before) SELECT upload_key,upload_expires_at+interval '60 seconds' FROM retired WHERE upload_key IS NOT NULL ON CONFLICT(object_key) DO NOTHING`);
  for(let count=0;count<Math.max(0,Math.min(limit,50));count++){
    const result=await transaction(pool,async db=>{
      const row=(await db.query<{object_key:string;attempts:number}>("SELECT object_key,attempts FROM asset_deletions WHERE not_before<=clock_timestamp() AND attempts<8 ORDER BY not_before,object_key FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if(!row)return false;
      try{await store.delete(row.object_key);await db.query('DELETE FROM asset_deletions WHERE object_key=$1',[row.object_key]);deleted++;}
      catch{await db.query("UPDATE asset_deletions SET attempts=attempts+1,last_error='STORAGE_UNAVAILABLE',not_before=clock_timestamp()+LEAST(3600,power(2,attempts+1)*30)*interval '1 second' WHERE object_key=$1",[row.object_key]);}
      return true;
    });if(!result)break;
  }return deleted;
}
