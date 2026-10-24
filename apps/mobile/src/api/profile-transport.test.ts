import {test} from 'node:test';import assert from 'node:assert/strict';
import {ApiClient} from './client';
test('PATCH retains null values and bearer authorization without retrying ambiguous writes',async()=>{
 let calls=0;let sent:RequestInit|undefined;const session={token:()=> 'access',refresh:async()=>null,clear:async()=>{}};
 const api=new ApiClient('https://api.example.invalid',session,async(_input,init)=>{calls++;sent=init;throw new Error('Response lost');});
 await assert.rejects(api.patch('/api/v1/tribes/123/profile',{phone:null,bio:'Updated'}));
 assert.equal(calls,1);assert.equal(sent?.method,'PATCH');assert.equal((sent?.headers as Record<string,string>).Authorization,'Bearer access');assert.deepEqual(JSON.parse(sent!.body as string),{phone:null,bio:'Updated'});
});
