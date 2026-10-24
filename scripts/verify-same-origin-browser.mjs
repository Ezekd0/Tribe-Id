// Built UI against the compiled API; no Vite, database or external service.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {buildApp} from '../apps/api/dist/app.js';
import {readEnvironment} from '../apps/api/dist/config/env.js';
const env={...readEnvironment({NODE_ENV:'test'}),adminWebDist:resolve('apps/web/dist')};
const app=await buildApp(env);let browser;
try {
 const origin=await app.listen({host:'127.0.0.1',port:0});env.appOrigin=origin;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL==='chromium'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL??'chrome'})});
 const page=await browser.newPage();const failures=[],external=[];
 page.on('pageerror',()=>failures.push('browser_script_error'));
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push('external_request');return route.abort();}return route.continue();});
 for(const path of ['/','/hub','/profile','/id-card','/announcements']){
  const response=await page.goto(origin+path);assert.equal(response.status(),200);
  await page.getByRole('heading',{name:'A member session is required'}).waitFor();
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 }
 await page.getByLabel('Email',{exact:true}).fill('synthetic@example.invalid');
 await page.getByLabel('Password',{exact:true}).fill('synthetic-credentials-only');
 const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/auth/login'&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const response=await waiting;assert.equal(response.status(),503);
 const error=await response.json();await page.getByText(error.error.message,{exact:true}).waitFor();
 assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
 assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie]),[0,0,'']);
 console.log('PASS compiled same-origin built UI: supported screen refresh, CSP/script execution, actual auth HTTP request, safe unconfigured-auth failure, no persistent credentials or external requests');
}catch{console.error('Built same-origin browser verification failed; no request bodies or credentials emitted.');process.exitCode=1;}
finally{await browser?.close();await app.close();}
