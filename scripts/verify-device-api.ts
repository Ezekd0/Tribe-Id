import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { IdentityService } from '../apps/api/src/modules/auth/identity-service.js';
import { MobileSessionRepository } from '../apps/api/src/modules/auth/repository.js';
import { SecretBox, totp } from '../apps/api/src/modules/auth/crypto.js';
import { deliverAuthMail } from '../apps/api/src/modules/auth/delivery.js';
import { SessionCore } from '../apps/mobile/src/auth/session-core.js';
import { ApiClient } from '../apps/mobile/src/api/client.js';
import { AuthService } from '../apps/mobile/src/api/auth-service.js';
import { MemberService } from '../apps/mobile/src/api/member-service.js';
if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true') throw new Error('Explicit disposable database required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const captured: string[] = [];
// Automated-test SMTP sink only: never an application delivery fallback.
const smtp = createServer(socket => {
  socket.write('220 localhost QA SMTP\r\n');
  let buffer = '', message = '', data = false;
  socket.on('data', chunk => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') { captured.push(message); message = ''; data = false; socket.write('250 accepted\r\n'); }
        else message += line + '\r\n';
      } else if (/^EHLO|^HELO/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/i.test(line)) { data = true; socket.write('354 send data\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 goodbye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
const smtpAddress = smtp.address();
assert.ok(smtpAddress && typeof smtpAddress !== 'string');
const settings = { encryptionKey: randomBytes(32).toString('base64'), rateLimitKey: randomBytes(32).toString('base64'), mailFrom: 'qa@example.invalid', smtpUrl: `smtp://127.0.0.1:${smtpAddress.port}`, mailMode: 'local-capture' as const };
const env = readEnvironment({ NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, AUTH_ENABLED:'true', AUTH_ENCRYPTION_KEY:settings.encryptionKey, AUTH_RATE_LIMIT_KEY:settings.rateLimitKey, MAIL_FROM:settings.mailFrom, SMTP_URL:settings.smtpUrl, AUTH_MAIL_MODE:'local-capture' });
const app = await buildApp(env);
const sessions = new MobileSessionRepository(pool), identity = new IdentityService(pool, sessions, settings), box = new SecretBox(settings.encryptionKey);
const suffix = randomUUID();
const tribe = (await pool.query<{id:string}>('INSERT INTO tribes(name,slug) VALUES($1,$2) RETURNING id', ['Device QA ' + suffix, 'device-' + suffix])).rows[0]!.id;
async function mailToken(email: string, subject: string) {
  const rows = (await pool.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM auth_outbox WHERE payload_ciphertext IS NOT NULL ORDER BY created_at DESC')).rows;
  for (const row of rows) {
    let message: {to:string;subject:string;text:string};
    try { message = JSON.parse(box.open(row.payload_ciphertext, 'auth-mail')); } catch { continue; }
    if (message.to === email && message.subject === subject) return message.text.match(/[A-Za-z0-9_-]{43}/)![0];
  }
  throw new Error('Expected encrypted test message missing');
}
try {
  const listener = await app.listen({ host: process.env.QA_HTTP_TEST_HOST ?? '127.0.0.1', port: 0 });
  const port = (app.server.address() as {port:number}).port;
  const baseUrl = process.env.QA_HTTP_TEST_ADDRESS ? `http://${process.env.QA_HTTP_TEST_ADDRESS}:${port}` : listener;
  function runtime(storage: {value:string|null} = {value:null}) {
    const session = new SessionCore(baseUrl, {read:async()=>storage.value,write:async value=>{storage.value=value;},remove:async()=>{storage.value=null;}});
    const api = new ApiClient(baseUrl, session);
    return {session,auth:new AuthService(baseUrl,session,api),member:new MemberService(api),storage};
  }
  const ownerEmail = 'qa-owner-' + suffix + '@example.invalid', ownerPassword = 'QA owner phrase ' + randomUUID();
  await identity.bootstrap(tribe, ownerEmail, ownerPassword, 'QA-OWNER', 'Disposable device QA setup');
  const owner = runtime(); await owner.auth.verify(await mailToken(ownerEmail, 'Verify your initial-owner email'));
  const challenge = await owner.auth.login(ownerEmail, ownerPassword); assert.ok(challenge?.enrollmentRequired);
  const setup = await owner.auth.setup(challenge.challengeToken);
  const bits = Array.from(setup.secret, char => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5,'0')).join('');
  const seed = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte,2)));
  const recoveryCodes = await owner.auth.mfa(challenge.challengeToken, totp(seed, Math.floor(Date.now()/30000)));
  assert.equal(recoveryCodes.length,10);
  const bearer = owner.session.token()!;
  async function operator(action:string, values:Record<string,string>) {
    const child=spawn(process.execPath,['--import','tsx','scripts/qa-operator.ts'],{env:{...process.env,QA_OPERATOR_CONFIRM:'private-test-enrollment',QA_API_URL:baseUrl,QA_TRIBE_ID:tribe,QA_ACTION:action,QA_OPERATOR_EMAIL:'',...values},stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});child.stdin.end(bearer+'\n');
    const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    assert.equal(code,0,output.replaceAll(bearer,'[redacted]'));assert.ok(!output.includes(bearer));
  }
  async function post(path:string, body:Record<string,string>) {
    const response = await fetch(baseUrl + '/api/v1/' + path, {method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.ok(response.ok, 'Authorized operator request failed: ' + response.status);
  }
  const testers: {email:string;password:string;client:ReturnType<typeof runtime>}[] = [];
  const membershipIds:string[]=[];
  if(process.env.QA_HTTP_TEST_ADDRESS) await operator('invite',{QA_EMAILS:[1,2,3,4].map(i=>`qa-device-${i}-${suffix}@example.invalid`).join(','),QA_MEMBER_NUMBERS:'QA-1,QA-2,QA-3,QA-4'});
  for (let i=1;i<=4;i++) {
    const email = `qa-device-${i}-${suffix}@example.invalid`, password = 'QA tester phrase ' + randomUUID(), client = runtime();
    if(!process.env.QA_HTTP_TEST_ADDRESS) await post(`tribes/${tribe}/invitations`,{email,memberNumber:'QA-'+i});
    await client.auth.enroll(await mailToken(email,'Trueda Tribe ID invitation'),password,'QA Tester '+i);
    await client.auth.verify(await mailToken(email,'Verify your Trueda Tribe ID email'));
    const membership = (await pool.query<{id:string}>('SELECT m.id FROM tribe_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1 AND m.tribe_id=$2',[email,tribe])).rows[0]!.id;
    membershipIds.push(membership);
    if(!process.env.QA_HTTP_TEST_ADDRESS) await post(`tribes/${tribe}/memberships/${membership}/activate`,{evidenceReference:'Disposable QA tester enrollment reviewed'});
    testers.push({email,password,client});
  }
  if(process.env.QA_HTTP_TEST_ADDRESS) await operator('activate',{QA_MEMBERSHIP_IDS:membershipIds.join(','),QA_APPROVAL_REFERENCE:'Disposable QA tester enrollment reviewed'});
  await Promise.all(testers.map(async ({email,password,client},index)=>{
    assert.ok(await client.auth.login(email,password) === null, 'Member login must complete without privileged MFA challenge');
    assert.equal((await client.member.memberships()).memberships[0]!.tribeId,tribe);
    const hub=await client.member.hub(tribe); assert.equal(hub.identity.displayName,'QA Tester '+(index+1));
    assert.equal((await client.member.profile(tribe)).profile!.email,email);
    assert.equal((await client.member.idCard(tribe)).card,null);
    assert.deepEqual((await client.member.announcements(tribe)).announcements,[]);
    assert.deepEqual((await client.member.events(tribe)).events,[]);
  }));
  console.log('PASS four separately invited/verified/activated testers over real HTTP and PostgreSQL; isolated core screen data');
  const first=testers[0]!, restored=runtime(first.client.storage);
  assert.ok(await restored.session.refresh()); assert.equal((await restored.member.hub(tribe)).identity.displayName,'QA Tester 1');
  await restored.auth.logoutAll(); assert.ok(restored.storage.value === null, 'Refresh credential must be cleared');
  await assert.rejects(first.client.member.hub(tribe));
  await testers[1]!.client.auth.logoutAll();
  const third=testers[2]!.client; await new ApiClient(baseUrl,third.session).logout(); assert.ok(third.storage.value === null, 'Refresh credential must be cleared');
  console.log('PASS mobile session restoration, current logout and logout-all over real HTTP');
  const delivered=await deliverAuthMail(pool,settings);
  assert.ok(delivered.delivered>=9); assert.equal(captured.length,delivered.delivered);
  assert.ok(captured.some(message=>message.includes('Trueda Tribe ID invitation')));
  assert.equal(Number((await pool.query('SELECT count(*) FROM auth_outbox WHERE delivered_at IS NOT NULL AND payload_ciphertext IS NOT NULL')).rows[0].count),0);
  console.log('PASS encrypted auth outbox delivered to actual local SMTP sink and delivered ciphertext removed');
} finally {
  await app.close(); await pool.end(); await new Promise<void>((resolve,reject)=>smtp.close(error=>error?reject(error):resolve()));
}
// Disposable identities intentionally remain only in this disposable DB; discard that DB after the suite.
