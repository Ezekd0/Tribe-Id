import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnvironment } from './env.js';
test('production requires an explicit HTTPS origin', () => {
  assert.throws(() => readEnvironment({ NODE_ENV: 'production' }));
  assert.throws(() => readEnvironment({ NODE_ENV: 'production', APP_ORIGIN: 'http://example.com' }));
  assert.equal(readEnvironment({ NODE_ENV: 'production', APP_ORIGIN: 'https://example.com', DATABASE_URL: 'postgresql:///test' }).appOrigin, 'https://example.com');
});
test('invalid port and origins fail startup', () => {
  assert.throws(() => readEnvironment({ PORT: 'abc' }));
  assert.throws(() => readEnvironment({ APP_ORIGIN: 'https://example.com/path' }));
});

test('production native API requires DB but no browser origin; proxy trust is explicit',()=>{
 assert.equal(readEnvironment({NODE_ENV:'production',DATABASE_URL:'postgresql:///test'}).appOrigin,'');
 assert.throws(()=>readEnvironment({TRUSTED_PROXY_CIDRS:'true'}));
 assert.throws(()=>readEnvironment({DB_POOL_MAX:'0'}));
 assert.deepEqual(readEnvironment({TRUSTED_PROXY_CIDRS:'10.0.0.0/24'}).trustedProxies,['10.0.0.0/24']);
});
import {randomBytes} from 'node:crypto';
test('local SMTP capture is explicit, loopback-only and forbidden in production', () => {
 const source={NODE_ENV:'development',DATABASE_URL:'postgresql:///test',AUTH_ENABLED:'true',AUTH_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AUTH_RATE_LIMIT_KEY:randomBytes(32).toString('base64'),MAIL_FROM:'qa@example.invalid',AUTH_MAIL_MODE:'local-capture',SMTP_URL:'smtp://127.0.0.1:1025'};
 assert.equal(readEnvironment(source).auth?.mailMode,'local-capture');
 for(const smtp of ['smtp://192.168.1.20:1025','smtps://127.0.0.1:1025','smtp://user:password@127.0.0.1:1025']) assert.throws(()=>readEnvironment({...source,SMTP_URL:smtp}));
 assert.throws(()=>readEnvironment({...source,NODE_ENV:'production'}));
 assert.throws(()=>readEnvironment({...source,AUTH_MAIL_MODE:'pretend'}));
});
test('public authentication requires explicit keys, delivery and production password blocklist',()=>{
 assert.throws(()=>readEnvironment({AUTH_ENABLED:'true',DATABASE_URL:'postgresql:///test'}));
 const source={NODE_ENV:'test',DATABASE_URL:'postgresql:///test',AUTH_ENABLED:'true',AUTH_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AUTH_RATE_LIMIT_KEY:randomBytes(32).toString('base64'),SMTP_URL:'smtps://test-only.example.invalid',MAIL_FROM:'test@example.invalid'};
 assert.ok(readEnvironment(source).auth);
 assert.throws(()=>readEnvironment({...source,NODE_ENV:'production'}),/password blocklist/);
 assert.throws(()=>readEnvironment({...source,NODE_ENV:'production',SMTP_URL:'smtp://test-only.example.invalid?requireTLS=false'}),/TLS/);
 assert.throws(()=>readEnvironment({...source,MAIL_FROM:'test@example.invalid\r\nInjected: value'}));
});

test('invalid configuration errors do not echo secret URL inputs',()=>{
 const source={NODE_ENV:'test',DATABASE_URL:'postgresql:///test',AUTH_ENABLED:'true',AUTH_ENCRYPTION_KEY:randomBytes(32).toString('base64'),AUTH_RATE_LIMIT_KEY:randomBytes(32).toString('base64'),MAIL_FROM:'test@example.invalid',SMTP_URL:'private-secret-invalid-url'};
 assert.throws(()=>readEnvironment(source),error=>error instanceof Error && error.message==='Invalid SMTP_URL' && !JSON.stringify(error).includes('private-secret'));
 assert.throws(()=>readEnvironment({APP_ORIGIN:'private-secret-invalid-url'}),error=>error instanceof Error && error.message==='Invalid APP_ORIGIN');
});
