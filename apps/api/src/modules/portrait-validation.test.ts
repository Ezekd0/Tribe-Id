import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {validatePortraitUpload} from './profiles/portrait-service.js';
import {normalizePortrait} from './profiles/portrait-image.js';
import {createR2Store,readR2Settings} from '../infrastructure/storage/r2.js';

test('portrait consent boundary rejects unknown fields, coercion, unsafe MIME and oversized input',()=>{
  const valid={mimeType:'image/png',sizeBytes:90,consent:true};assert.deepEqual(validatePortraitUpload(valid),valid);
  for(const bad of [{...valid,consent:false},{...valid,sizeBytes:'90'},{...valid,sizeBytes:0},{...valid,sizeBytes:5242881},{...valid,mimeType:'image/svg+xml'},{...valid,uploadedBy:'other'},null,[]])assert.throws(()=>validatePortraitUpload(bad));
});
test('portrait codec verifies signature/format and re-encodes without source metadata or trailing payloads',async()=>{
  const input=await sharp({create:{width:2048,height:512,channels:3,background:'white'}}).jpeg().withMetadata().toBuffer();
  const output=await normalizePortrait(Buffer.concat([input,Buffer.from('<script>untrusted source</script>')]),'image/jpeg');
  const metadata=await sharp(output).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,1024);assert.equal(metadata.height,256);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.ok(!output.includes(Buffer.from('<script>')));
  await assert.rejects(normalizePortrait(input,'image/png'));
  await assert.rejects(normalizePortrait(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),'image/png'));
  await assert.rejects(normalizePortrait(Buffer.from('not an image'),'image/png'));
});
test('R2 configuration is explicit and defaults to jurisdiction-constrained EU; URL generation is offline and bounded',async()=>{
  assert.equal(readR2Settings({}),null);assert.throws(()=>readR2Settings({R2_ACCOUNT_ID:'not-valid'}));
  const config=readR2Settings({R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'local-test-key',R2_SECRET_ACCESS_KEY:'local-test-secret',R2_BUCKET:'test-private-bucket'})!;
  assert.equal(config.jurisdiction,'eu');const store=createR2Store(config);
  const upload=new URL(await store.presignUpload('quarantine/test-id','image/png',90,300));
  assert.equal(upload.host,'a'.repeat(32)+'.eu.r2.cloudflarestorage.com');assert.equal(upload.searchParams.get('X-Amz-Expires'),'300');
  assert.ok(upload.searchParams.get('X-Amz-SignedHeaders')?.includes('content-type'));assert.ok(upload.searchParams.get('X-Amz-SignedHeaders')?.includes('content-length'));
  assert.equal(upload.searchParams.has('x-amz-checksum-crc32'),false);assert.ok(upload.searchParams.has('X-Amz-Signature'));
  const download=new URL(await store.presignDownload('portraits/test-id.webp',60));assert.equal(download.searchParams.get('X-Amz-Expires'),'60');assert.notEqual(download.searchParams.get('X-Amz-Signature'),upload.searchParams.get('X-Amz-Signature'));
});
