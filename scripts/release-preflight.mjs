// Read-only configuration checks. Never connects to providers or prints values.
import {pathToFileURL} from 'node:url';
export function releasePreflight(env={}) {
 const failures=[];
 const require=(ok,code)=>{if(!ok)failures.push(code);};
 const url=value=>{try{return new URL(value);}catch{return null;}};
 const key=value=>typeof value==='string'&&Buffer.from(value,'base64').length===32&&Buffer.from(value,'base64').toString('base64')===value;
 require(env.NODE_ENV==='production','PRODUCTION_MODE_REQUIRED');
 require(env.AUTH_ENABLED==='true','AUTHENTICATION_REQUIRED');
 require(env.ENABLE_MEMBER_PREVIEW!=='true'&&env.VITE_MEMBER_PREVIEW!=='true','PREVIEW_FORBIDDEN');
 const origin=url(env.APP_ORIGIN),mobile=url(env.EXPO_PUBLIC_API_URL);
 require(origin?.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'HTTPS_APP_ORIGIN_REQUIRED');
 require(mobile?.protocol==='https:'&&!mobile.username&&!mobile.password&&!mobile.search&&!mobile.hash,'HTTPS_MOBILE_API_REQUIRED');
 const database=url(env.DATABASE_URL);
 require(['postgres:','postgresql:'].includes(database?.protocol)&&database?.searchParams.get('sslmode')==='verify-full','DATABASE_VERIFIED_TLS_REQUIRED');
 require(key(env.AUTH_ENCRYPTION_KEY)&&key(env.AUTH_RATE_LIMIT_KEY)&&env.AUTH_ENCRYPTION_KEY!==env.AUTH_RATE_LIMIT_KEY,'INDEPENDENT_AUTH_KEYS_REQUIRED');
 require(Boolean(env.AUTH_PASSWORD_BLOCKLIST_PATH),'PASSWORD_BLOCKLIST_REQUIRED');
 const smtp=url(env.SMTP_URL);
 require((env.AUTH_MAIL_MODE??'smtp')==='smtp'&&(smtp?.protocol==='smtps:'||(smtp?.protocol==='smtp:'&&smtp.searchParams.get('requireTLS')==='true')),'SMTP_TLS_REQUIRED');
 require(typeof env.MAIL_FROM==='string'&&env.MAIL_FROM.length>0&&!/[\r\n]/.test(env.MAIL_FROM),'MAIL_SENDER_REQUIRED');
 require(/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID??'')&&Boolean(env.R2_BUCKET)&&Boolean(env.R2_ACCESS_KEY_ID)&&Boolean(env.R2_SECRET_ACCESS_KEY)&&env.R2_JURISDICTION==='eu','PRIVATE_EU_R2_CONFIGURATION_REQUIRED');
 require(Boolean(env.TRUSTED_PROXY_CIDRS)&&!(env.TRUSTED_PROXY_CIDRS??'').split(',').some(value=>['0.0.0.0/0','::/0','*'].includes(value.trim())),'EXPLICIT_PROXY_ALLOWLIST_REQUIRED');
 require(env.AUTH_AUDIT_RETENTION_DAYS==='90','APPROVED_SECURITY_RETENTION_REQUIRED');
 return {status:failures.length?'BLOCKED':'CONFIGURATION_CHECKS_PASS',failures,limitations:['No connectivity, credentials, permissions, provider setup, scheduling, restore, signed-build or device qualification performed.','Run the API configuration validator too; passing this preflight does not authorize deployment.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=releasePreflight(process.env);console.log(JSON.stringify(result));if(result.failures.length)process.exitCode=1;}
