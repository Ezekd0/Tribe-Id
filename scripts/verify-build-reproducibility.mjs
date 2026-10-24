// Same installed environment only: no install, Docker, signing or deployment.
import {createHash} from 'node:crypto';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {isolatedEnvironment} from './ci-plan.mjs';
async function build(){
 const child=spawn('npm',['run','build'],{env:{...isolatedEnvironment(),NODE_ENV:'production'},stdio:'ignore'});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),180000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timeout));
 assert.equal(code,0,'Reproducibility build failed; private diagnostics withheld');
}
async function manifest(){
 const result={};
 async function walk(directory){for(const file of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,file.name);if(file.isDirectory())await walk(path);else{assert.ok(file.isFile(),'Unexpected generated symlink');result[path]=createHash('sha256').update(await readFile(path)).digest('hex');}}}
 for(const directory of ['packages/contracts/dist','apps/api/dist','apps/web/dist'])await walk(directory);
 assert.ok(Object.keys(result).length);return result;
}
try{
 await build();const first=await manifest();await build();const second=await manifest();assert.deepEqual(second,first,'Generated artifact content differs');
 await mkdir('.cache',{recursive:true});await writeFile('.cache/final-staging-build-manifest.json',JSON.stringify({scope:'two builds; same installed environment; not clean-room/container/native reproducibility',files:second},null,2)+'\n');
 console.log(`PASS two-build content reproducibility: ${Object.keys(second).length} contract/API/web files identical; no install or deployment`);
}catch{console.error('Build reproducibility verification failed; no private output emitted.');process.exitCode=1;}
