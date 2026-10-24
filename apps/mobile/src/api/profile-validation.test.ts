import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileDraft,validateProfileDraft,normalizeProfileDraft,changedProfileFields} from '../features/profile/editable-fields';
import {developmentMemberView} from '../../../api/src/development/member-fixture';
test('editable fields exclude protected identity/email and validate approved boundaries',()=>{
 const draft=profileDraft(developmentMemberView.profile!);assert.equal('email' in draft,false);assert.equal('memberNumber' in draft,false);assert.deepEqual(validateProfileDraft({...draft,phone:'+1 202 555 0123'}),{});
 assert.deepEqual(Object.keys(validateProfileDraft({bio:'x'.repeat(2001),phone:'not-a-number',location:'x'.repeat(201),occupation:'x'.repeat(201)})).sort(),['bio','location','occupation','phone']);
 for(const phone of ['123456','1234567890123456','++12025550123','1234567+','123.4567'])assert.ok(validateProfileDraft({...draft,phone}).phone,phone);
 for(const phone of ['1234567','+123456789012345',' (123) 456-7890 ',''])assert.equal(validateProfileDraft({...draft,phone}).phone,undefined,phone);
});
test('normalization preserves bio and phone country intent, clears nullable fields and sends only semantic changes',()=>{
 const original={bio:' Bio ',phone:'+12025550123',location:'Example City',occupation:'Engineer'};
 assert.deepEqual(changedProfileFields(original,{...original,phone:'+1 202 555 0123',location:' Example City '}),{});
 assert.deepEqual(changedProfileFields(original,{...original,phone:'',location:' ',occupation:' Artist '}),{phone:null,location:null,occupation:'Artist'});
 assert.deepEqual(normalizeProfileDraft({bio:' exact bio ',phone:'0202 555 0123',location:' ',occupation:''}),{bio:' exact bio ',phone:'02025550123',location:null,occupation:null});
});
