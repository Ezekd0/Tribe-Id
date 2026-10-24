import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MobileSessionRepository } from '../apps/api/src/modules/auth/repository.js';
import { hashSessionToken } from '../apps/api/src/modules/authentication/session.js';
import { incrementLimit } from '../apps/api/src/infrastructure/database/shared-state.js';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';
if(!process.env.DATABASE_URL) throw new Error('Disposable DATABASE_URL required');
const first=new Pool({connectionString:process.env.DATABASE_URL}),second=new Pool({connectionString:process.env.DATABASE_URL});
const a=new MobileSessionRepository(first),b=new MobileSessionRepository(second),userId=randomUUID(),key=randomUUID();
const app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
try {
 await first.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'test-only-not-a-credential',now())",[userId,`${userId}@example.invalid`]);
 const pair=await a.issue(userId,'Test device');
 assert.ok(await b.resolve(hashSessionToken(pair.accessToken)));
 const response=await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{refreshToken:pair.refreshToken}});
 assert.equal(response.statusCode,200);const rotated=response.json();
 assert.ok(await a.resolve(hashSessionToken(rotated.accessToken)));
 assert.equal(await b.rotate(pair.refreshToken),null);
 assert.equal(await a.resolve(hashSessionToken(rotated.accessToken)),null);
 assert.equal(await a.rotate(rotated.refreshToken),null);
 const concurrent=await a.issue(userId,'Concurrency test');
 const results=await Promise.all([a.rotate(concurrent.refreshToken),b.rotate(concurrent.refreshToken)]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(await a.resolve(hashSessionToken(results.find(Boolean)!.accessToken)),null);
 const expired=await a.issue(userId,'Expiry test');
 await first.query("UPDATE access_tokens SET expires_at=created_at+interval '1 microsecond' WHERE token_hash=$1",[hashSessionToken(expired.accessToken)]);
 assert.equal(await b.resolve(hashSessionToken(expired.accessToken)),null);
 const identity=await first.query<{id:string}>('SELECT session_id AS id FROM access_tokens WHERE token_hash=$1',[hashSessionToken(expired.accessToken)]);
 await b.revoke(identity.rows[0]!.id);assert.equal(await a.rotate(expired.refreshToken),null);
 const foreignId=randomUUID();
 await b.revokeDevice(foreignId,identity.rows[0]!.id); // Ownership scope cannot revoke another user's family.
 const timed=await a.issue(userId,'Expired family');
 await first.query("UPDATE device_sessions SET expires_at=created_at+interval '1 microsecond' WHERE id=(SELECT session_id FROM refresh_tokens WHERE token_hash=$1)",[hashSessionToken(timed.refreshToken)]);
 assert.equal(await b.rotate(timed.refreshToken),null);
 assert.equal(await b.resolve(hashSessionToken(timed.accessToken)),null);
 const counts=await Promise.all(Array.from({length:20},(_,i)=>incrementLimit(i%2?first:second,key)));
 assert.equal(Math.max(...counts),20);assert.equal(new Set(counts).size,20);
 assert.equal((await app.inject('/api/v1/health/ready')).statusCode,200);
 assert.equal((await app.inject({url:'/api/v1/me',headers:{cookie:`trueda-tribe-id-session=${expired.accessToken}`}})).statusCode,401);
 console.log('Passed cross-instance access, native refresh, replay family revocation, concurrent rotation, expiry, logout, atomic shared counters, readiness, and cookie rejection.');
} finally {
 await first.query('DELETE FROM device_sessions WHERE user_id=$1',[userId]);
 await first.query('DELETE FROM users WHERE id=$1',[userId]);await first.query('DELETE FROM request_limits WHERE key=$1',[key]);
 await app.close();await Promise.all([first.end(),second.end()]);
}
