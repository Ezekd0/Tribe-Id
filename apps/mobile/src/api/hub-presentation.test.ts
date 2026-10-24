import {test} from 'node:test';
import assert from 'node:assert/strict';
import {announcementAge,eventDate,hubLayout} from '../components/tribe/format';
import {developmentMemberView} from '../../../api/src/development/member-fixture';
test('Hub adapts smaller screens and enlarged text without shrinking the source ID card',()=>{
  assert.deepEqual(hubLayout(402,1),{stackWelcome:false,stackQuickAccess:false,stackEvents:false});
  assert.equal(hubLayout(360,1).stackWelcome,true);
  assert.equal(hubLayout(402,1.5).stackQuickAccess,true);
  assert.equal(hubLayout(320,1).stackEvents,true);
});
test('announcement age is API-derived, handles future timestamps and invalid dates',()=>{
  const now=Date.parse('2026-10-04T12:00:00Z');
  assert.equal(announcementAge('2026-10-04T10:00:00Z',now),'2h ago');
  assert.equal(announcementAge('2026-10-05T10:00:00Z',now),'0m ago');
  assert.equal(announcementAge('invalid',now),'');
});
test('event calendar uses the event timezone and supports multi-day dates',()=>{
  const event={...developmentMemberView.events[0]!,startsAt:'2027-04-10T23:30:00Z',endsAt:'2027-04-14T12:00:00Z',timezone:'Africa/Lagos'};
  assert.deepEqual(eventDate(event),{day:'11–14',month:'APR',time:'12:30 AM'});
});
