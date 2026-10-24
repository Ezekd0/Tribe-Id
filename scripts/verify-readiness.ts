import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';

if (!process.env.DATABASE_URL || process.env.AUTH_TEST_DISPOSABLE !== 'true') throw new Error('Explicit disposable database required');
const url = process.env.DATABASE_URL;
const app = await buildApp(readEnvironment({ NODE_ENV: 'test', DATABASE_URL: url }));
const rejected = new URL(url);
rejected.password = randomBytes(32).toString('hex');
const unavailable = await buildApp(readEnvironment({ NODE_ENV: 'test', DATABASE_URL: rejected.toString() }));
const duplicate = await buildApp(readEnvironment({ NODE_ENV: 'test', DATABASE_URL: url }));
const pool = new Pool({ connectionString: url });
try {
  assert.equal((await pool.query('SELECT current_database(),current_user')).rowCount, 1);
  assert.equal((await app.inject('/api/v1/health')).statusCode, 200);
  assert.deepEqual((await app.inject('/api/v1/health/ready')).json(), { status: 'ready' });
  assert.equal((await unavailable.inject('/api/v1/health')).statusCode, 200);
  const failure = await unavailable.inject('/api/v1/health/ready');
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(failure.json(), { status: 'unavailable' });
  assert.ok(!failure.body.includes(rejected.password));
  const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  await assert.rejects(duplicate.listen({ host: '127.0.0.1', port: Number(address.port) }), { code: 'EADDRINUSE' });
  assert.equal((await fetch(address.origin + '/api/v1/health/ready')).status, 200);
  console.log('PASS real database query, ready 200, rejected database authentication yields safe 503, liveness stays 200, duplicate listener rejected without stopping original');
} finally {
  await Promise.all([app.close(), unavailable.close(), duplicate.close(), pool.end()]);
}
