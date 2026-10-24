import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEventInput} from './events/admin-service.js';
const data={title:' Event ',description:'<b>Plain text</b>\n',location:' Example City ',startsAt:'2028-02-29T12:00:00+01:00',endsAt:'2028-02-29T13:00:00+01:00',timezone:'Africa/Lagos',capacity:null};
test('event inputs retain plain text, valid leap dates/timezones and nullable capacity',()=>{
 assert.deepEqual(normalizeEventInput(data),{...data,title:'Event',location:'Example City',startsAt:'2028-02-29T11:00:00.000Z',endsAt:'2028-02-29T12:00:00.000Z'});
 assert.deepEqual(normalizeEventInput({capacity:2147483647},true),{capacity:2147483647});
});
test('event writes reject coercion, status injection and malformed calendar/time values',()=>{
 for(const input of [{},[],null,{...data,status:'published'},{...data,capacity:'1'},{...data,capacity:0},{...data,capacity:1.5},{...data,capacity:2147483648},{...data,startsAt:'0000-02-29T12:00:00Z'},{...data,startsAt:'2027-02-29T12:00:00Z'},{...data,startsAt:'2028-02-30T12:00:00Z'},{...data,startsAt:'2028-02-29T24:00:00Z'},{...data,timezone:'Unknown/Zone'},{...data,endsAt:data.startsAt},{...data,title:' '},{...data,description:'x'.repeat(10001)}]) assert.throws(()=>normalizeEventInput(input),{statusCode:400,code:'VALIDATION_FAILED'});
 assert.throws(()=>normalizeEventInput({status:'published'},true),{statusCode:400});
});
