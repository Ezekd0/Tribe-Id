import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';

// Configuration only: no provider calls, credential output, deployment or build.
export function androidBetaPreflight(env, app, eas) {
 const failures=[];
 const require=(ok,code)=>{if(!ok)failures.push(code);};
 let url;try{url=new URL(env.EXPO_PUBLIC_API_URL);}catch{}
 const host=url?.hostname.toLowerCase()??'';
 require(url?.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'HTTPS_API_ORIGIN_REQUIRED');
 require(Boolean(host)&&!isIP(host)&&!host.startsWith('[')&&host.includes('.')&&!['localhost','example.com','example.org','example.net'].some(value=>host===value||host.endsWith('.'+value))&&!['.invalid','.localhost','.local','.test','.internal'].some(suffix=>host.endsWith(suffix)),'REAL_PUBLIC_API_HOST_REQUIRED');
 require(env.EXPO_PUBLIC_APP_ENV==='testing','TESTING_ENVIRONMENT_REQUIRED');
 const config=app.expo??app,profile=eas.build?.preview;
 require(typeof config.owner==='string'&&config.owner.trim().length>0,'EXPO_OWNER_REQUIRED');
 require(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.extra?.eas?.projectId??''),'EAS_PROJECT_ID_REQUIRED');
 require(profile?.distribution==='internal'&&profile?.android?.buildType==='apk'&&profile?.environment==='preview'&&profile?.env?.EXPO_PUBLIC_APP_ENV==='testing'&&profile?.developmentClient!==true,'INTERNAL_APK_PROFILE_REQUIRED');
 return {status:failures.length?'BLOCKED':'CONFIGURATION_CHECKS_PASS',failures,limitations:['Does not verify DNS, HTTPS connectivity, backend health, account ownership, free quota, signing, authentication or installation.','Does not authorize a build, public deployment or APK sharing.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
 const result=androidBetaPreflight(process.env,read('../apps/mobile/app.json'),read('../apps/mobile/eas.json'));
 console.log(JSON.stringify(result));if(result.failures.length)process.exitCode=1;
}
