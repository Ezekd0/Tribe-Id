import {test} from 'node:test';import assert from 'node:assert/strict';import {ApiClient} from './client';
test('bounded query parameters encode only after strict pathname validation and survive bearer retry',async()=>{
 const urls:string[]=[];let calls=0;const api=new ApiClient('https://api.example.invalid',{token:()=> 'old',refresh:async()=> 'new',clear:async()=>{}},async(input)=>{urls.push(String(input));return ++calls===1?new Response(null,{status:401}):Response.json({members:[]});});
 await api.get('/api/v1/tribes/abc/admin/members',{search:'A & B? /',limit:50,offset:0,status:undefined});assert.equal(urls.length,2);assert.equal(urls[0],urls[1]);assert.equal(new URL(urls[0]!).searchParams.get('search'),'A & B? /');
 await assert.rejects(api.get('/api/v1/me?ignored=1'));await assert.rejects(api.get('/api/v1/me',{'bad-key':'value'}));assert.equal(urls.length,2);
});
