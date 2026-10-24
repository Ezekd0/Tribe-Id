// Mount this read-only into the built image; run with --network none --read-only.
import assert from 'node:assert/strict';
import {readdir,readFile,realpath,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire('/app/apps/api/package.json');
let stage='inventory';
try{
 const packages=[],seen=new Set();
 async function pkg(path){
  let actual;try{actual=await realpath(path);}catch{return;}
  assert.ok(actual.startsWith('/app/'),'Package escaped application artifact');if(seen.has(actual))return;seen.add(actual);
  let metadata;try{metadata=JSON.parse(await readFile(join(actual,'package.json'),'utf8'));}catch{return;}
  packages.push({name:metadata.name,version:metadata.version});await modules(join(actual,'node_modules'));
 }
 async function modules(path){let files;try{files=await readdir(path,{withFileTypes:true});}catch{return;}for(const file of files){if(file.name.startsWith('.'))continue;const child=join(path,file.name);if(file.name.startsWith('@')){for(const name of await readdir(child))await pkg(join(child,name));}else await pkg(child);}}
 await modules('/app/node_modules');assert.ok(packages.length>0);
 for(const name of ['node-forge','zod','@expo/cli','expo','typescript','vite','tsx']){stage='package_exclusion_'+name;assert.ok(!packages.some(pkg=>pkg.name===name),'Build-only package present');}
 stage='nonroot';assert.notEqual(process.getuid?.(),0);
 stage='packaged_entrypoints';for(const file of ['packages/database/migrate.mjs','packages/database/cleanup.mjs','packages/database/migrations/012_push_delivery_receipts.sql','apps/api/dist/operations/auth-mail-worker.js','apps/api/dist/operations/push-worker.js','apps/api/dist/operations/asset-cleanup.js','apps/web/dist/index.html'])await access('/app/'+file);
 stage='native_modules';
 const argon=require('argon2');const hash=await argon.hash('synthetic-image-check',{memoryCost:8192});assert.ok(await argon.verify(hash,'synthetic-image-check'));
 const sharp=require('sharp');const image=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).webp().toBuffer();assert.equal((await sharp(image).metadata()).format,'webp');
 stage='compiled_api';
 const {buildApp}=await import('/app/apps/api/dist/app.js');const {readEnvironment}=await import('/app/apps/api/dist/config/env.js');
 const app=await buildApp({...readEnvironment({NODE_ENV:'test'}),adminWebDist:'/app/apps/web/dist'});
 try{assert.equal((await app.inject('/')).statusCode,200);assert.equal((await app.inject('/profile')).statusCode,200);assert.equal((await app.inject('/api/v1/me')).statusCode,401);assert.equal((await app.inject('/api/v1/stale')).statusCode,404);assert.equal((await app.inject('/.env')).statusCode,404);}finally{await app.close();}
 console.log(JSON.stringify({status:'PASS',scope:'actual current image; offline/read-only/nonroot, native modules, packaged entrypoints and compiled API/static/auth boundary',limitations:'No container database worker/provider execution or signed native qualification',node:process.version,uid:process.getuid?.(),packages:packages.sort((a,b)=>a.name.localeCompare(b.name))}));
}catch{console.error(JSON.stringify({status:'FAIL',stage}));process.exitCode=1;}
