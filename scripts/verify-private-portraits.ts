import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {S3Client} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
import {R2ObjectStore} from '../apps/api/src/infrastructure/storage/r2.js';
import {drainAssetDeletions} from '../apps/api/src/modules/profiles/portrait-service.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true')throw new Error('Explicit disposable database required');
const objects=new Map<string,{bytes:Buffer;type:string}>();let failDelete=false;const calls:{method:string;key:string}[]=[];
const server=createServer(async(req,res)=>{
  const key=decodeURIComponent(new URL(req.url!,'http://local.invalid').pathname).replace(/^\/test-private-bucket\//,'');calls.push({method:req.method!,key});
  if(req.method==='PUT'){
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>5242912){res.writeHead(413).end();return;}chunks.push(Buffer.from(chunk));}
    objects.set(key,{bytes:Buffer.concat(chunks),type:String(req.headers['content-type']??'application/octet-stream')});res.writeHead(200,{ETag:'"test-etag"'}).end();return;
  }
  if(req.method==='DELETE'){if(failDelete){res.writeHead(503,{'Content-Type':'application/xml'}).end('<Error><Code>ServiceUnavailable</Code></Error>');return;}objects.delete(key);res.writeHead(204).end();return;}
  const value=objects.get(key);if(!value){res.writeHead(404,{'Content-Type':'application/xml'}).end(req.method==='HEAD'?undefined:'<Error><Code>NoSuchKey</Code></Error>');return;}
  res.writeHead(200,{'Content-Type':value.type,'Content-Length':value.bytes.length});res.end(req.method==='HEAD'?undefined:value.bytes);
});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const address=server.address();if(!address||typeof address==='string')throw new Error('Local S3 sink unavailable');
const s3=new S3Client({region:'auto',endpoint:`http://127.0.0.1:${address.port}`,credentials:{accessKeyId:'local-test',secretAccessKey:'local-test-secret'},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED'});
const store=new R2ObjectStore(s3,'test-private-bucket'),pool=new Pool({connectionString:process.env.DATABASE_URL});
const app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}),undefined,{objectStore:store});
const tribe=randomUUID(),foreign=randomUUID();
async function actor(scope=tribe){
 const user=(await pool.query("INSERT INTO users(email,password_hash,email_verified_at) VALUES($1,'test-not-a-credential',now()) RETURNING id",[randomUUID()+'@example.invalid'])).rows[0].id as string;
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[scope,user,randomUUID()])).rows[0].id as string;
 await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name) VALUES($1,$2,'Synthetic image tester')",[membership,scope]);
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Storage fixture') RETURNING id",[user])).rows[0].id;
 const token=createSessionToken();await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);return {user,membership,session,token};
}
try{
 for(const id of [tribe,foreign])await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Storage fixture',id]);
 const a=await actor(),b=await actor(),f=await actor(foreign);const base=`/api/v1/tribes/${tribe}/profile/portrait`,headers={authorization:'Bearer '+a.token};
 const png=await sharp({create:{width:16,height:16,channels:3,background:'red'}}).png().toBuffer();
 let initiation=0; async function initiate(bytes=png){initiation++;const r=await app.inject({method:'POST',url:base+'/uploads',headers,payload:{mimeType:'image/png',sizeBytes:bytes.length,consent:true}});if(r.statusCode!==201)console.log('VERIFY_FAILURE portrait initiation '+initiation+' status '+r.statusCode);assert.equal(r.statusCode,201);return r.json() as {assetId:string;uploadUrl:string;headers:Record<string,string>};}
 async function upload(data:Awaited<ReturnType<typeof initiate>>,bytes=png){assert.equal((await fetch(data.uploadUrl,{method:'PUT',headers:data.headers,body:new Uint8Array(bytes)})).status,200);}
 const finalize=(id:string,token=a.token)=>app.inject({method:'POST',url:base+'/uploads/'+id+'/finalize',headers:{authorization:'Bearer '+token}});
 const profileId=async()=>(await pool.query('SELECT avatar_asset_id FROM profiles WHERE membership_id=$1',[a.membership])).rows[0].avatar_asset_id;
 assert.deepEqual((await app.inject({url:base,headers})).json(),{assetId:null,url:null,expiresAt:null});
 for(const bad of [{mimeType:'image/svg+xml',sizeBytes:90,consent:true},{mimeType:'image/png',sizeBytes:'90',consent:true},{mimeType:'image/png',sizeBytes:90,consent:false},{mimeType:'image/png',sizeBytes:90,consent:true,userId:b.user}])assert.equal((await app.inject({method:'POST',url:base+'/uploads',headers,payload:bad})).statusCode,400);
 const first=await initiate();const signed=new URL(first.uploadUrl);assert.ok(signed.searchParams.get('X-Amz-SignedHeaders')?.includes('content-length'));
 await upload(first);const beforeDenied=calls.length;
 assert.equal((await finalize(first.assetId,b.token)).statusCode,404);assert.equal((await finalize(first.assetId,f.token)).statusCode,404);assert.equal(calls.length,beforeDenied);
 const finalized=await Promise.all([finalize(first.assetId),finalize(first.assetId)]);assert.deepEqual(finalized.map(r=>r.statusCode),[204,204]);assert.equal(await profileId(),first.assetId);
 const row=(await pool.query('SELECT * FROM assets WHERE id=$1',[first.assetId])).rows[0];assert.equal(row.status,'ready');assert.equal(row.mime_type,'image/webp');assert.ok(objects.has(row.storage_key));assert.equal((await sharp(objects.get(row.storage_key)!.bytes).metadata()).format,'webp');
 const own=(await app.inject({url:base,headers})).json();assert.equal(own.assetId,first.assetId);assert.equal(new URL(own.url).searchParams.get('X-Amz-Expires'),'60');assert.equal((await fetch(own.url)).status,200);
 const view=(await app.inject({url:`/api/v1/tribes/${tribe}/profile`,headers})).json();assert.ok(view.identity.avatarUrl);assert.ok(!JSON.stringify(view).includes('_avatarStorageKey'));assert.ok(!JSON.stringify(view).includes('upload_key'));
 // The real object HEAD/body boundary rejects size mismatch even if a malicious upload transport ignored signed length.
 const mismatch=await initiate();await upload(mismatch,Buffer.concat([png,Buffer.from('extra')]));assert.equal((await finalize(mismatch.assetId)).statusCode,400);assert.equal(await profileId(),first.assetId);
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),bad=await initiate(svg);await upload(bad,svg);assert.equal((await finalize(bad.assetId)).statusCode,400);
 const second=await initiate();await upload(second);assert.equal((await finalize(second.assetId)).statusCode,204);assert.equal(await profileId(),second.assetId);assert.equal((await pool.query('SELECT status FROM assets WHERE id=$1',[first.assetId])).rows[0].status,'rejected');
 failDelete=true;assert.equal(await drainAssetDeletions(pool,store),0);assert.ok((await pool.query("SELECT 1 FROM asset_deletions WHERE last_error='STORAGE_UNAVAILABLE'")).rowCount);
 failDelete=false;await pool.query("UPDATE asset_deletions SET not_before=now() WHERE object_key=$1",[row.storage_key]);assert.ok(await drainAssetDeletions(pool,store));assert.ok(!objects.has(row.storage_key));assert.equal((await fetch(own.url)).status,404);
 // An audit failure cannot replace the live portrait; the attempt object is compensated and the pointer stays unchanged.
 const stable=await profileId(),attempt=await initiate();await upload(attempt);
 await pool.query("CREATE FUNCTION reject_portrait_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
 await pool.query("CREATE TRIGGER reject_portrait_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='portrait.updated') EXECUTE FUNCTION reject_portrait_audit_fixture()");
 assert.equal((await finalize(attempt.assetId)).statusCode,500);assert.equal(await profileId(),stable);assert.equal((await pool.query('SELECT status FROM assets WHERE id=$1',[attempt.assetId])).rows[0].status,'pending');
 await pool.query('DROP TRIGGER reject_portrait_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_portrait_audit_fixture()');
 const expired=await initiate();await upload(expired);await pool.query("UPDATE assets SET upload_expires_at=now()-interval '2 minutes' WHERE id=$1",[expired.assetId]);assert.equal((await finalize(expired.assetId)).statusCode,409);await drainAssetDeletions(pool,store);assert.equal((await pool.query('SELECT status FROM assets WHERE id=$1',[expired.assetId])).rows[0].status,'rejected');
 assert.equal((await app.inject({method:'DELETE',url:base,headers})).statusCode,204);assert.equal(await profileId(),null);await drainAssetDeletions(pool,store);assert.deepEqual((await app.inject({url:base,headers})).json(),{assetId:null,url:null,expiresAt:null});
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[a.membership]);assert.equal((await app.inject({url:base,headers})).statusCode,404);assert.equal((await finalize(attempt.assetId)).statusCode,404);
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action LIKE 'portrait.%'")).rows;for(const secret of [a.token,b.token,'local-test-secret',first.uploadUrl,own.url])assert.ok(!JSON.stringify(logs).includes(secret));assert.ok(logs.every(r=>Object.keys(r.metadata).length===0));
 console.log('PASS private portrait consent/ownership, real S3-compatible local PUT/HEAD/GET/DELETE, bounded image validation/re-encoding, concurrent finalize, ready-only signed reads, replacement/removal, failure compensation, retry cleanup, expiry and transactional audit rollback');
}catch(error){const frame=error instanceof Error?error.stack?.match(/verify-private-portraits\.ts:\d+:\d+/)?.[0]:undefined;console.log('VERIFY_FAILURE '+(frame??'private portrait fixture'));throw error;}finally{await app.close();await pool.end();s3.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
