import test from 'node:test';
import assert from 'node:assert/strict';
import { timedFetch } from './transport';
test('a stalled request is aborted once without replaying a mutation', async () => {
  let calls = 0;
  const request = timedFetch(async (_input, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('Aborted'))));
  }, 10);
  await assert.rejects(request('https://api.invalid', { method: 'POST' }), /Aborted/);
  assert.equal(calls, 1);
});

import { ApiClient, ApiFailure } from './client';
test('member network failure is retryable without clearing or fabricating a session', async () => {
  let cleared=false;
  const client=new ApiClient('https://api.invalid',{token:()=> 'a'.repeat(43),refresh:async()=>null,clear:async()=>{cleared=true;}},async()=>{throw new Error('Network failed');});
  await assert.rejects(client.get('/api/v1/me'),error=>error instanceof ApiFailure && error.status===0);
  assert.equal(cleared,false);
});
