import test from 'node:test';
import assert from 'node:assert/strict';
import {privacyRequestType,privacyRequestPagination} from './privacy-requests/service.js';
test('privacy request input allows only bounded request kinds without caller identity or fulfillment fields',()=>{
 assert.equal(privacyRequestType({type:'export'}),'export');assert.equal(privacyRequestType({type:'deletion'}),'deletion');
 for(const input of [null,[],{}, {type:'erase'},{type:1},{type:'export',userId:'foreign'},{type:'deletion',fulfilled:true},{type:'export',reason:'private note'}])assert.throws(()=>privacyRequestType(input),{statusCode:400,code:'VALIDATION_FAILED'});
});
test('privacy request pagination is bounded and administrator review filters do not imply fulfillment',()=>{
 assert.deepEqual(privacyRequestPagination({}),{limit:50,offset:0,status:'pending'});assert.deepEqual(privacyRequestPagination({status:'reviewed',limit:'100',offset:'10000'},true),{status:'reviewed',limit:100,offset:10000});
 for(const query of [{status:'fulfilled'},{limit:'101'},{offset:'10001'},{userId:'foreign'},{limit:['1','2']}])assert.throws(()=>privacyRequestPagination(query,true),{statusCode:400,code:'VALIDATION_FAILED'});
 assert.throws(()=>privacyRequestPagination({status:'pending'}),{statusCode:400});
});
