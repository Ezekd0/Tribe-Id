// Safe local proof: owns a disposable PostgreSQL cluster and loopback SMTP sink.
// Build contracts and API first. No tsx loader, external mail, or existing DB.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { SecretBox } from '../apps/api/dist/modules/auth/crypto.js';

const directory = await mkdtemp(join(tmpdir(), 'trueda-runtime-'));
const data = join(directory, 'data'), password = randomBytes(32).toString('hex');
let started = false, client, api;
const children = new Set();
const image=process.env.QA_DOCKER_IMAGE;
if(image&&!/^trueda-tribe-id-api:[a-z0-9_.-]+$/.test(image))throw new Error('Use a reviewed local Trueda image tag');
const containers=new Set(),containerPrefix='trueda-runtime-qa-'+randomBytes(6).toString('hex');
const imageEntrypoints=new Set(['packages/database/migrate.mjs','packages/database/cleanup.mjs','apps/api/dist/server.js','apps/api/dist/operations/auth-mail-worker.js']);
function launch(command, args, environment = {}) {
  if(image&&command===process.execPath&&imageEntrypoints.has(args[0])){
    const name=containerPrefix+'-'+containers.size;containers.add(name);
    // Only fixture configuration is forwarded, never inherited operator secrets.
    // Host networking reaches this script's loopback PostgreSQL/SMTP fixtures.
    args=['run','--rm','--pull=never','--name',name,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',...Object.keys(environment).flatMap(key=>['--env',key]),image,'node',...args];command='docker';
  }
  const child = spawn(command, args, { env: { ...process.env, NODE_OPTIONS: '', ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.stderr.resume(); // Never print credentials or message bodies from failures.
  return child;
}
async function run(command, args, environment = {}) {
  const child = launch(command, args, environment);
  child.stdout.resume();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timeout));
  children.delete(child);
  assert.equal(code, 0, 'Operational subprocess must succeed');
}
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
const captured = [];
const smtp = createServer(socket => {
  socket.write('220 localhost QA SMTP\r\n');
  let buffer = '', message = '', receiving = false;
  socket.on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (receiving) {
        if (line === '.') { captured.push(message); message = ''; receiving = false; socket.write('250 accepted\r\n'); }
        else message += line + '\r\n';
      } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^DATA/i.test(line)) { receiving = true; socket.write('354 send data\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 goodbye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
try {
  await mkdir(join(directory, 'socket'), { mode: 0o700 });
  await writeFile(join(directory, 'password'), password + '\n', { mode: 0o600 });
  await run('initdb', ['-D', data, '-U', 'runtime_qa', '--auth=scram-sha-256', '--pwfile=' + join(directory, 'password')]);
  const databasePort = await port();
  await run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${databasePort} -k ${join(directory, 'socket')}`, '-w', 'start']);
  started = true;
  const environment = { DATABASE_URL: `postgresql://runtime_qa:${password}@127.0.0.1:${databasePort}/postgres`, NODE_ENV: 'test', AUTH_ENABLED: 'false', ENABLE_MEMBER_PREVIEW: 'false' };
  await run(process.execPath, ['packages/database/migrate.mjs'], environment);
  await run(process.execPath, ['packages/database/migrate.mjs'], environment);
  console.log('PASS packaged migration entrypoint on fresh isolated DB; repeat is idempotent');
  client = new pg.Client({ connectionString: environment.DATABASE_URL });
  await client.connect();
  const apiPort = await port();
  api = launch(process.execPath, ['apps/api/dist/server.js'], { ...environment, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(apiPort), APP_ORIGIN: 'https://example.invalid' });
  api.stdout.resume();
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    if (api.exitCode !== null) throw new Error('Compiled API exited');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  console.log('PASS compiled production-mode API readiness without tsx');
  await new Promise((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
  const encryptionKey = randomBytes(32).toString('base64');
  const box = new SecretBox(encryptionKey);
  await client.query("INSERT INTO auth_outbox(payload_ciphertext,expires_at) VALUES($1,now()+interval '1 hour')", [box.seal(JSON.stringify({ to: 'qa@example.invalid', subject: 'Runtime verification', text: 'Local isolated test only' }), 'auth-mail')]);
  await run(process.execPath, ['apps/api/dist/operations/auth-mail-worker.js'], { ...environment, AUTH_ENABLED: 'true', AUTH_ENCRYPTION_KEY: encryptionKey, AUTH_RATE_LIMIT_KEY: randomBytes(32).toString('base64'), MAIL_FROM: 'qa@example.invalid', AUTH_MAIL_MODE: 'local-capture', SMTP_URL: `smtp://127.0.0.1:${smtp.address().port}` });
  assert.equal(captured.length, 1);
  assert.match(captured[0], /Runtime verification/);
  assert.equal((await client.query('SELECT count(*) FROM auth_outbox WHERE delivered_at IS NOT NULL AND payload_ciphertext IS NULL')).rows[0].count, '1');
  console.log('PASS compiled mail worker reaches loopback sink and erases delivered ciphertext without tsx');
  const user = (await client.query("INSERT INTO users(email,password_hash) VALUES('runtime@example.invalid','test-fixture-only') RETURNING id")).rows[0].id;
  const session = (await client.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'runtime') RETURNING id", [user])).rows[0].id;
  await client.query("INSERT INTO refresh_tokens(token_hash,session_id,consumed_at) VALUES($1,$2,now())", ['a'.repeat(64), session]);
  await run(process.execPath, ['packages/database/cleanup.mjs'], environment);
  assert.equal((await client.query('SELECT count(*) FROM refresh_tokens WHERE session_id=$1', [session])).rows[0].count, '1');
  assert.equal((await client.query('SELECT count(*) FROM auth_outbox')).rows[0].count, '0');
  console.log('PASS cleanup removes delivered outbox and preserves consumed refresh hashes for live families');
  if(image)console.log('PASS current local image executes migrations, compiled API, auth-mail and cleanup against isolated loopback fixtures; no external providers');
} catch {
  console.error('Operational runtime verification failed; credentials and message bodies withheld.');
  process.exitCode = 1;
} finally {
  if (api && api.exitCode === null) {
    const stopped = new Promise(resolve => api.once('close', resolve));
    api.kill('SIGTERM');
    const timeout = setTimeout(() => api.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(timeout);
  }
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  for(const name of containers){
    // Remove only the uniquely named disposable containers created by this run.
    const child=launch('docker',['rm','--force',name]);child.stdout.resume();
    const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
    await new Promise(resolve=>{child.once('error',resolve);child.once('close',resolve);}).finally(()=>clearTimeout(timeout));children.delete(child);
  }
  await client?.end().catch(() => {});
  if (smtp.listening) await new Promise(resolve => smtp.close(resolve));
  if (started) {
    try { await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; }
    catch { console.error('Temporary database stop failed; private directory retained.'); process.exitCode = 1; }
  }
  if (!started) await rm(directory, { recursive: true, force: true });
}
