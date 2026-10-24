import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {validateAdminQuery,type AdministrationService} from './administration/service.js';
import {registerAdministrationRoutes} from './administration/routes.js';
test('administration filters are bounded, literal and resource-specific',()=>{
 assert.deepEqual(validateAdminQuery({},'context'),{limit:50,offset:0});
 assert.deepEqual(validateAdminQuery({limit:'100',offset:'10000',search:"%' OR true",role:'member',status:'pending'},'members'),{limit:100,offset:10000,search:"%' OR true",role:'member',status:'pending'});
 for(const input of [{limit:1},{limit:'0'},{limit:'101'},{offset:'-1'},{offset:'10001'},{search:['one','two']},{search:'x'.repeat(201)},{status:'deleted'},{role:'editor'},{email:'secret'},{sort:'email'}]) assert.throws(()=>validateAdminQuery(input,'members'),{statusCode:400});
 for(const input of [{role:'owner'},{status:'active'}]) assert.throws(()=>validateAdminQuery(input,'invitations'),{statusCode:400});
 assert.throws(()=>validateAdminQuery({role:'owner'},'context'),{statusCode:400});
});
test('administration route prevalidation rejects duplicate and unknown query keys before service use',async t=>{
 const app=Fastify();let called=0;
 const service={context:async()=>{called++;return {};},members:async()=>{called++;return {members:[]};},invitations:async()=>{called++;return {invitations:[]};}} as unknown as AdministrationService;
 registerAdministrationRoutes(app,service,{resolve:async()=>({userId:'fixture',sessionId:'fixture',email:'fixture@example.invalid'}),revoke:async()=>{}});
 t.after(()=>app.close());
 const base='/api/v1/tribes/11111111-1111-4111-8111-111111111111/admin/',headers={authorization:'Bearer '+'a'.repeat(43)};
 for(const suffix of ['members?limit=1&limit=2','members?email=secret','context?role=owner','invitations?status=active']) assert.equal((await app.inject({url:base+suffix,headers})).statusCode,400);
 assert.equal(called,0);
 assert.equal((await app.inject({url:base+'context',headers})).statusCode,200);assert.equal(called,1);
 assert.equal((await app.inject({url:base+'members'})).statusCode,401);
});
