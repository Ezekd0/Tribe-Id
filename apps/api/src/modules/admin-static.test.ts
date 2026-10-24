import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../app.js';
import {readEnvironment} from '../config/env.js';
import {hashSessionToken} from './authentication/session.js';

export async function verifySameOriginBuild(directory:string){
 const token='A'.repeat(43);
 const dependencies={sessions:{async resolve(hash:string){return hash===hashSessionToken(token)?{userId:'synthetic-user',sessionId:'synthetic-session',email:'synthetic@example.invalid'}:null;},async revoke(){}},members:{async memberships(){return [];},async membership(){return null;},async view(){return null;}}};
 const app=await buildApp({...readEnvironment({NODE_ENV:'test'}),adminWebDist:directory},dependencies);
 try{
  const page=await app.inject('/');assert.equal(page.statusCode,200);assert.equal(page.headers['cache-control'],'no-store');assert.match(page.headers['content-security-policy'] as string,/script-src 'self'/);
  for(const path of ['/hub','/id-card','/announcements','/profile','/profile/']){const screen=await app.inject(path);assert.equal(screen.statusCode,200);assert.equal(screen.body,page.body);assert.equal(screen.headers['cache-control'],'no-store');}
  const paths=[...page.body.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match=>match[1]!);assert.ok(paths.length>0);
  for(const path of paths){const asset=await app.inject(path);assert.equal(asset.statusCode,200);assert.match(asset.headers['cache-control'] as string,/immutable|no-cache/);}
  assert.equal((await app.inject('/api/v1/me')).statusCode,401);
  assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:`Bearer ${token}`,origin:'http://localhost:5173'}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:`Bearer ${token}`,origin:'https://untrusted.invalid'}})).statusCode,403);
  for(const path of ['/api/stale','/api/v1/stale','/assets/missing.js','/src/main.tsx','/.env','/package.json','/assets/../.env','/assets/%2e%2e/%2eenv','/assets/main.js.map','/admin']){const response=await app.inject(path);assert.equal(response.statusCode,404,path);assert.equal(response.json().error.code,'NOT_FOUND');}
 }finally{await app.close();}
}

test('optional same-origin assets preserve bearer authority and deny fallback/file probing',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'tribe-admin-'));const root=join(temp,'apps/web/dist');
 try{await mkdir(join(root,'assets'),{recursive:true});await writeFile(join(root,'index.html'),'<html><script type="module" src="/assets/main-12345678.js"></script></html>');await writeFile(join(root,'assets/main-12345678.js'),'export {};');await writeFile(join(root,'.env'),'SECRET');await verifySameOriginBuild(root);
 const api=await buildApp(readEnvironment({NODE_ENV:'test'}));try{assert.equal((await api.inject('/')).statusCode,404);}finally{await api.close();}
 await symlink(join(root,'index.html'),join(root,'assets/leak.js'));await assert.rejects(buildApp({...readEnvironment({NODE_ENV:'test'}),adminWebDist:root}),/Unexpected file/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
