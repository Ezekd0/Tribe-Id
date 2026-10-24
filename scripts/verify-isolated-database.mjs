// Creates its own temporary SCRAM cluster. Never connects to an existing cluster.
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';

const directory = await mkdtemp(join(tmpdir(), 'trueda-isolated-'));
const data = join(directory, 'data'), socket = join(directory, 'socket');
const password = randomBytes(32).toString('hex');
const role = 'trueda_qa_operator';
let started = false, operator;
async function run(command, args, environment = {}) {
  const child = spawn(command, args, { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  // Never emit arbitrary stderr: database/test exceptions can contain credentials.
  child.stderr.resume();
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  for (const line of output.split('\n')) if (/^VERIFY_FAILURE [a-zA-Z0-9 ._:-]+$/.test(line)) console.error(line);
  if (code !== 0) throw new Error(`${command} verification process failed (exit ${code})`);
  for (const line of output.split('\n')) if (/^(PASS |Passed |Verified |Completed |Applied )/.test(line)) console.log(line);
}
try {
  await mkdir(socket, { mode: 0o700 });
  await writeFile(join(directory, 'password'), password + '\n', { mode: 0o600 });
  await run('initdb', ['-D', data, '-U', role, '--auth=scram-sha-256', '--pwfile=' + join(directory, 'password')]);
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  await run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start']);
  started = true;
  operator = new pg.Client({ host: '127.0.0.1', port, user: role, password, database: 'postgres' });
  await operator.connect();
  const identity = (await operator.query('SELECT current_user,current_database()')).rows[0];
  if (identity.current_user !== role || identity.current_database !== 'postgres') throw new Error('Unexpected isolated database identity');
  console.log('PASS direct TCP SCRAM authentication to isolated PostgreSQL (not the intended application cluster)');
  for (const [name, args] of [
    ['constraints', ['packages/database/verify.mjs']],
    ['readiness', ['--import', 'tsx', 'scripts/verify-readiness.ts']],
    ['members', ['--import', 'tsx', 'scripts/verify-member-database.ts']],
    ['sessions', ['--import', 'tsx', 'scripts/verify-mobile-auth.ts']],
    ['identity', ['--import', 'tsx', 'scripts/verify-identity-auth.ts']],
    ['invitation_audit', ['--import', 'tsx', 'scripts/verify-invitation-audit.ts']],
    ['profiles', ['--import', 'tsx', 'scripts/verify-profile-updates.ts']],
    ['event_registration', ['--import', 'tsx', 'scripts/verify-event-registration.ts']],
    ['approval_history', ['--import', 'tsx', 'scripts/verify-approval-history.ts']],
    ['card_lifecycle', ['--import', 'tsx', 'scripts/verify-card-lifecycle.ts']],
    ['announcement_management', ['--import', 'tsx', 'scripts/verify-announcement-management.ts']],
    ['event_management', ['--import', 'tsx', 'scripts/verify-event-management.ts']],
    ['administration', ['--import', 'tsx', 'scripts/verify-administration.ts']],
    ['member_preferences', ['--import', 'tsx', 'scripts/verify-member-preferences.ts']],
    ['notification_inbox', ['--import', 'tsx', 'scripts/verify-notification-inbox.ts']],
    ['expo_delivery', ['--import', 'tsx', 'scripts/verify-expo-delivery.ts']],
    ['push_devices', ['--import', 'tsx', 'scripts/verify-push-devices.ts']],
    ['privacy_requests', ['--import', 'tsx', 'scripts/verify-privacy-requests.ts']],
    ['private_portraits', ['--import', 'tsx', 'scripts/verify-private-portraits.ts']],
    ['notification_delivery', ['--import', 'tsx', 'scripts/verify-notification-delivery.ts']],
    ['http', ['--import', 'tsx', 'scripts/verify-device-api.ts']],
  ].filter(([name])=>!process.env.QA_SUITE||process.env.QA_SUITE.split(',').includes(name))) {
    const database = 'trueda_qa_' + name;
    await operator.query(`CREATE DATABASE ${database}`);
    const environment = { DATABASE_URL: `postgresql://${role}:${password}@127.0.0.1:${port}/${database}`, AUTH_TEST_DISPOSABLE: 'true' };
    await run(process.execPath, ['packages/database/migrate.mjs'], environment);
    await run(process.execPath, args, environment);
    await operator.query(`DROP DATABASE ${database}`);
    console.log('PASS isolated ' + name + ' suite; disposable database removed');
  }
} catch (error) {
  console.error(error instanceof Error && /verification process failed|Unexpected isolated/.test(error.message) ? error.message : 'Isolated PostgreSQL verification failed; no credentials emitted.');
  process.exitCode = 1;
} finally {
  await operator?.end().catch(() => {});
  if (started) {
    try { await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; }
    catch { console.error('Temporary PostgreSQL shutdown failed; its private directory has been retained.'); process.exitCode = 1; }
  }
  if (!started) await rm(directory, { recursive: true, force: true });
}
