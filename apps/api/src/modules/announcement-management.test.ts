import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {validateAnnouncement,validateAnnouncementList,type AnnouncementManagementService} from './announcements/service.js';
import {registerAnnouncementManagementRoutes} from './announcements/routes.js';
test('announcement authoring validates strict plain text fields without rewriting contents',()=>{
 const input={title:'  Member news ',body:'Line one\n\n <plain text> ',category:'important'};
 assert.deepEqual(validateAnnouncement(input),input);
 assert.deepEqual(validateAnnouncement({body:' revised '},true),{body:' revised '});
 for(const input of [null,[],{}, {title:'a',body:'b'}, {title:1,body:'b',category:'general'},{title:' ',body:'b',category:'general'},{title:'a',body:'x'.repeat(20001),category:'general'},{title:'a'.repeat(201),body:'b',category:'general'},{title:'a',body:'b',category:'other'},{title:'a',body:'b',category:'general',status:'published'},{title:'a',body:'b',category:'general',author_membership_id:'spoof'}]) assert.throws(()=>validateAnnouncement(input),{statusCode:400,code:'VALIDATION_FAILED'});
 for(const input of [{body:null},{category:['general']},{title:[]},{publishedAt:'now'},{}]) assert.throws(()=>validateAnnouncement(input,true),{statusCode:400});
});
test('announcement admin listing is bounded and rejects unknown, duplicate and coerced query fields',()=>{
 assert.deepEqual(validateAnnouncementList({}),{limit:50,offset:0});
 assert.deepEqual(validateAnnouncementList({limit:'100',offset:'10000',status:'archived',search:"%_' OR true"}),{limit:100,offset:10000,status:'archived',search:"%_' OR true"});
 for(const input of [{limit:'0'},{limit:'101'},{limit:10},{offset:'10001'},{offset:'-1'},{status:'deleted'},{search:['a','b']},{sort:'title'},{search:'x'.repeat(201)}]) assert.throws(()=>validateAnnouncementList(input),{statusCode:400});
});
test('announcement routes reject mass assignment and coercion before reaching service',async t=>{
 const app=Fastify(),calls:unknown[]=[];
 const service={change:async(...args:unknown[])=>{calls.push(args);return {announcement:{id:'fixture'}};},list:async()=>({announcements:[]})} as unknown as AnnouncementManagementService;
 registerAnnouncementManagementRoutes(app,service,{resolve:async()=>({userId:'user',sessionId:'session',email:'fixture@example.invalid'}),revoke:async()=>{}});
 t.after(()=>app.close());
 const base='/api/v1/tribes/11111111-1111-4111-8111-111111111111/admin/announcements',headers={authorization:'Bearer '+'a'.repeat(43)};
 for(const payload of [{title:9,body:'b',category:'general'},{title:'a',body:'b',category:'general',status:'published'}]) assert.equal((await app.inject({method:'POST',url:base,headers,payload})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:base,headers,payload:{title:'a',body:'b',category:'general'}})).statusCode,201);
 assert.equal(calls.length,1);
 assert.equal((await app.inject({method:'POST',url:base+'/22222222-2222-4222-8222-222222222222/publish',headers,payload:{}})).statusCode,400);
 assert.equal((await app.inject({url:base+'?limit=1&limit=2',headers})).statusCode,400);
 assert.equal((await app.inject({url:base+'?role=owner',headers})).statusCode,400);
 assert.equal((await app.inject({url:base})).statusCode,401);
});
