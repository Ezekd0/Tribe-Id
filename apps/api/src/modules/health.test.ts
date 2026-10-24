import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { readEnvironment } from '../config/env.js';
test('health and unknown routes return safe contracts with security headers', async t => {
  const app = await buildApp(readEnvironment({ NODE_ENV: 'test' }));
  t.after(() => app.close());
  const health = await app.inject('/api/v1/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { product: 'Trueda Tribe ID', status: 'ok' });
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  const missing = await app.inject('/api/v1/unknown');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});
test('native requests allow absent origins and reject foreign origins', async t => {
  const app = await buildApp(readEnvironment({ NODE_ENV: 'test' }));
  t.after(() => app.close());
  for (const headers of [{ origin: 'https://foreign.example' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/me', headers });
    assert.equal(response.statusCode, 403);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/v1/me'})).statusCode,404);
  assert.equal((await app.inject('/api/v1/health/ready')).statusCode,503);
  const allowed = await app.inject({ method: 'POST', url: '/api/v1/me', headers: { origin: 'http://localhost:5173' } });
  assert.equal(allowed.statusCode, 404);
});
