import test from 'node:test';
import assert from 'node:assert/strict';
import { can, type MembershipContext } from './authorization.js';
const member: MembershipContext = { userId: 'user-a', tribeId: 'tribe-a', role: 'member', status: 'active' };
test('anonymous, inactive and cross-Tribe access is denied', () => {
  assert.equal(can(null, 'member:read', { tribeId: 'tribe-a' }), false);
  for (const status of ['pending', 'suspended', 'revoked'] as const) assert.equal(can({ ...member, status }, 'member:read', { tribeId: 'tribe-a' }), false);
  assert.equal(can({ ...member, role: 'owner' }, 'tribe:manage', { tribeId: 'tribe-b' }), false);
});
test('members edit only their own profile and cannot administer', () => {
  assert.equal(can(member, 'profile:update', { tribeId: 'tribe-a', userId: 'user-a' }), true);
  assert.equal(can(member, 'profile:update', { tribeId: 'tribe-a', userId: 'user-b' }), false);
  assert.equal(can(member, 'tribe:manage', { tribeId: 'tribe-a' }), false);
});
test('only owners manage roles; administrators manage Tribe resources', () => {
  assert.equal(can({ ...member, role: 'administrator' }, 'tribe:manage', { tribeId: 'tribe-a' }), true);
  assert.equal(can({ ...member, role: 'administrator' }, 'roles:manage', { tribeId: 'tribe-a' }), false);
  assert.equal(can({ ...member, role: 'owner' }, 'roles:manage', { tribeId: 'tribe-a' }), true);
});
