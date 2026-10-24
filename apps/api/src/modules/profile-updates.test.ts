import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfileUpdate } from './profiles/service.js';
test('profile normalization preserves bio, trims optional text and normalizes phone without a country assumption',()=>{
    assert.deepEqual(normalizeProfileUpdate({bio:'  bio\n',phone:'+1 (202) 555-0123',location:'  Example City ',occupation:'   '}),{bio:'  bio\n',phone:'+12025550123',location:'Example City',occupation:null});
    assert.deepEqual(normalizeProfileUpdate({phone:'0202 555 0123'}),{phone:'02025550123'});
    assert.deepEqual(normalizeProfileUpdate({phone:'   ',location:null}),{phone:null,location:null});
    assert.deepEqual(normalizeProfileUpdate({bio:''}),{bio:''});
});
test('profile validation rejects protected fields, malformed values and invalid phone lengths',()=>{
    for(const input of [null,[],{}, {bio:null},{bio:'x'.repeat(2001)},{phone:'123456'},{phone:'+1234567890123456'},{phone:'1234567x'},{phone:'++1234567'},{occupation:{}},{location:'x'.repeat(201)},{bio:'valid',role:'owner'}]) assert.throws(()=>normalizeProfileUpdate(input),{statusCode:400,code:'VALIDATION_FAILED'});
});
