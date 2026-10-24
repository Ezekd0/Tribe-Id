import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileEnvironment } from './environment';
test('physical device configuration rejects loopback, secrets and unsafe release URLs', () => {
  for (const url of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001', 'https://user:pass@api.invalid', 'https://api.invalid/path']) assert.throws(() => mobileEnvironment(url, 'development', true));
  assert.throws(() => mobileEnvironment(undefined, 'development', true));
  assert.throws(() => mobileEnvironment('http://192.168.1.20:3001', 'testing', true));
  assert.throws(() => mobileEnvironment('http://192.168.1.20:3001', 'development', false));
  assert.throws(() => mobileEnvironment('https://api.invalid', 'staging', true));
  assert.equal(mobileEnvironment('http://192.168.1.20:3001', 'development', true).mode, 'development');
  assert.equal(mobileEnvironment('https://api.invalid', 'testing', false).mode, 'testing');
});
test('saved credentials are isolated by API origin and environment', () => {
  const first = mobileEnvironment('https://api.invalid', 'testing', false);
  assert.notEqual(first.storageKey, mobileEnvironment('https://other.invalid', 'testing', false).storageKey);
  assert.notEqual(first.storageKey, mobileEnvironment('https://api.invalid', 'production', false).storageKey);
  assert.equal(first.storageKey, mobileEnvironment('https://api.invalid/', 'testing', false).storageKey);
});
