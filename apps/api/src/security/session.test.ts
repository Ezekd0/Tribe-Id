import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, hashSessionToken, readSessionCookie } from '../modules/authentication/session.js';
test('session tokens are random, hashed and ambiguous cookies rejected',()=>{
  const token=createSessionToken();assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(token,createSessionToken());
  assert.equal(hashSessionToken(token).length,64);assert.notEqual(hashSessionToken(token),token);
  assert.equal(readSessionCookie(`other=x; trueda-tribe-id-session=${token}`,'trueda-tribe-id-session'),token);
  for(const value of [undefined,'trueda-tribe-id-session=bad',`trueda-tribe-id-session=${token}; trueda-tribe-id-session=${token}`])assert.equal(readSessionCookie(value,'trueda-tribe-id-session'),null);
});
