// Local synthetic proof only. Never reads DATABASE_URL or contacts an existing database.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { SecretBox } from '../apps/api/dist/modules/auth/crypto.js';
const directory = await mkdtemp(join(tmpdir(), 'trueda-restore-'));
const data = join(directory, 'data');
const password = randomBytes(32).toString('hex');
let started = false, client;
// Deliberately exclude inherited application/cloud configuration and PostgreSQL overrides.
const baseEnv = Object.fromEntries(['PATH','HOME','USER','LANG','LD_LIBRARY_PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
async function run(command, args, extra = {}) {
  const child = spawn(command, args, { env: { ...baseEnv, ...extra }, stdio: ['ignore','ignore','ignore'] });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timeout));
  assert.equal(code, 0, 'Local backup/restore subprocess failed; sensitive output withheld');
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
try {
  await mkdir(join(directory,'socket'), { mode: 0o700 });
  await writeFile(join(directory,'password'),password+'\n',{mode:0o600});
  await run('initdb',['-D',data,'-U','restore_qa','--auth=scram-sha-256','--pwfile='+join(directory,'password')]);
  const port = await freePort();
  await run('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${join(directory,'socket')}`,'-w','start']);
  started = true;
  const conn = { host:'127.0.0.1',port,user:'restore_qa',password,database:'postgres', connectionTimeoutMillis:5000, statement_timeout:10000 };
  client = new pg.Client(conn); await client.connect();
  await client.query('CREATE DATABASE backup_source');
  await client.query('CREATE DATABASE backup_restored');
  await client.end(); client = new pg.Client({...conn,database:'backup_source'}); await client.connect();
  const url = `postgresql://restore_qa:${password}@127.0.0.1:${port}/backup_source`;
  await run(process.execPath,['packages/database/migrate.mjs'],{DATABASE_URL:url});
  const user = (await client.query("INSERT INTO users(email,password_hash) VALUES('restore@example.invalid','synthetic-only') RETURNING id")).rows[0].id;
  const tribe = (await client.query("INSERT INTO tribes(name,slug) VALUES('Restore QA','restore-qa') RETURNING id")).rows[0].id;
  const member = (await client.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,'QA-1','active') RETURNING id",[tribe,user])).rows[0].id;
  await client.query("INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status,evidence_reference) VALUES($1,$2,$3,'approved','active','synthetic evidence')",[member,tribe,user]);
  const key = randomBytes(32).toString('base64'), box = new SecretBox(key);
  const plaintext = 'synthetic secret continuity sentinel';
  await client.query("INSERT INTO auth_outbox(payload_ciphertext,expires_at) VALUES($1,now()+interval '1 hour')",[box.seal(plaintext,'auth-mail')]);
  const migrations = (await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
  await client.end(); client = undefined;
  const pgEnv = { PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'restore_qa',PGPASSWORD:password,PGCONNECT_TIMEOUT:'5' };
  const began = performance.now();
  await run('pg_dump',['--format=custom','--no-owner','--no-privileges','--file='+join(directory,'backup.dump'),'backup_source'],pgEnv);
  await run('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname=backup_restored',join(directory,'backup.dump')],pgEnv);
  client = new pg.Client({...conn,database:'backup_restored'}); await client.connect();
  assert.deepEqual((await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows,migrations);
  assert.equal((await client.query('SELECT count(*) FROM tribe_memberships WHERE id=$1',[member])).rows[0].count,'1');
  assert.equal((await client.query('SELECT count(*) FROM membership_verification_history')).rows[0].count,'1');
  const ciphertext = (await client.query('SELECT payload_ciphertext FROM auth_outbox')).rows[0].payload_ciphertext;
  assert.equal(new SecretBox(key).open(ciphertext,'auth-mail'),plaintext);
  assert.throws(() => new SecretBox(randomBytes(32).toString('base64')).open(ciphertext,'auth-mail'));
  await assert.rejects(client.query("UPDATE membership_verification_history SET evidence_reference='changed'"), error => error.code === '23514');
  await assert.rejects(client.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,'QA-2','active')",[tribe,user]), error => error.code === '23505');
  await assert.rejects(client.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number) VALUES($1,gen_random_uuid(),'QA-3')",[tribe]), error => error.code === '23503');
  console.log(`PASS disposable pg_dump/pg_restore: ${migrations.length} migration checksums, membership/history, append-only trigger, unique/FK constraints and encrypted-secret continuity; local dump/restore/check ${Math.round(performance.now()-began)} ms.`);
  console.log('This synthetic local proof does not establish production backup encryption, object recovery, RPO, RTO, retention, roles, TLS or provider disaster recovery.');
} catch {
  console.error('Local backup/restore verification failed; credentials, secret values and subprocess output withheld.'); process.exitCode=1;
} finally {
  await client?.end().catch(()=>{});
  if(started) {
    try { await run('pg_ctl',['-D',data,'-m','fast','-w','stop']); started=false; }
    catch { console.error('Temporary database stop failed; private temporary directory retained.'); process.exitCode=1; }
  }
  if(!started) await rm(directory,{recursive:true,force:true});
}
