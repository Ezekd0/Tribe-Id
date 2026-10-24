import test from 'node:test';
import assert from 'node:assert/strict';
import {inboxPagination} from './notifications/inbox-service.js';
test('inbox queries have bounded explicit pagination and reject unknown or malformed fields',()=>{
 assert.deepEqual(inboxPagination({}),{limit:50,offset:0});assert.deepEqual(inboxPagination({limit:'100',offset:'10000'}),{limit:100,offset:10000});
 for(const input of [null,[],{limit:'101'},{limit:'0'},{offset:'10001'},{limit:'1.2'},{limit:'-1'},{limit:['1','2']},{userId:'foreign'}]) assert.throws(()=>inboxPagination(input),{statusCode:400,code:'VALIDATION_FAILED'});
});
