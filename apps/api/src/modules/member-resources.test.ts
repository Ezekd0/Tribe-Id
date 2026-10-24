import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { PostgresMemberRepository, projectResource, type MemberResource } from './members/repository.js';
import { MemberService } from './members/service.js';
import { developmentMemberView } from '../development/member-fixture.js';
const view = developmentMemberView;
const userId = 'resource-test-user', tribeId = view.identity.tribeId;
function fixture(options: { inactive?: boolean; foreign?: boolean; disappeared?: boolean; fail?: string } = {}) {
  const calls: string[] = [];
  const pool = { query: async (sql: string, params: string[]) => {
    calls.push(sql);
    if (options.fail && sql.includes(options.fail)) throw new Error('Unrelated reader unavailable');
    if (sql.includes('SELECT user_id AS')) return {rows: [{userId,tribeId: options.foreign ? 'foreign' : tribeId,status: options.inactive ? 'suspended' : 'active',role:'member'}]};
    if (sql.includes('SELECT m.id AS')) {
      assert.deepEqual(params,[userId,tribeId]);
      assert.ok(sql.includes("m.status='active'"));
      return {rows: options.disappeared ? [] : [view.identity]};
    }
    assert.equal(params[0], sql.includes('FROM announcements') || sql.includes('FROM events') ? tribeId : view.identity.membershipId);
    if (sql.includes('FROM profiles')) { const {skills,teams,achievements,...profile} = view.profile!; return {rows:[profile]}; }
    if (sql.includes('FROM member_skills')) return {rows:view.profile!.skills.map(name=>({name}))};
    if (sql.includes('FROM team_memberships')) return {rows:view.profile!.teams.map(name=>({name}))};
    if (sql.includes('FROM member_achievements')) return {rows:view.profile!.achievements};
    if (sql.includes('FROM id_cards')) return {rows:[view.card]};
    if (sql.includes('FROM announcements')) {
      assert.ok(sql.includes("status='published' AND published_at<=now()"));
      return {rows:view.announcements};
    }
    if (sql.includes('FROM events')) {
      assert.ok(sql.includes("e.status='published' AND e.ends_at>=now()"));
      assert.equal(params[1],view.identity.membershipId);
      return {rows:view.events};
    }
    throw new Error('Unexpected query');
  }} as unknown as Pool;
  return {calls,service:new MemberService(new PostgresMemberRepository(pool))};
}
test('focused resources preserve exact projection with fewer deterministic queries', async () => {
  // Counts include the live membership authorization query, exclude bearer resolution.
  for (const [resource,count] of [['member-view',9],['hub',5],['profile',6],['id-card',4],['announcements',3],['events',3]] as const) {
    const {calls,service} = fixture();
    assert.deepEqual(await service.resource(userId,tribeId,resource),projectResource(view,resource));
    assert.equal(calls.length,count,resource);
  }
});
test('unrelated failing readers cannot break focused resources', async () => {
  for (const [resource,fail] of [['announcements','FROM events'],['events','FROM profiles'],['id-card','FROM announcements'],['profile','FROM id_cards'],['hub','FROM member_skills']] as const) {
    const {service,calls} = fixture({fail});
    assert.deepEqual(await service.resource(userId,tribeId,resource),projectResource(view,resource));
    assert.ok(!calls.some(sql=>sql.includes(fail)));
  }
  const {service} = fixture({fail:'FROM events'});
  await assert.rejects(service.resource(userId,tribeId,'member-view'),/Unrelated reader unavailable/);
});
test('every focused resource authorizes live active scope and handles lost membership', async () => {
  for (const resource of ['member-view','hub','profile','id-card','announcements','events'] as MemberResource[]) {
    for (const options of [{inactive:true},{foreign:true},{disappeared:true}]) {
      const {service,calls} = fixture(options);
      await assert.rejects(service.resource(userId,tribeId,resource),{code:'MEMBER_NOT_FOUND',statusCode:404});
      assert.equal(calls.length,options.disappeared ? 2 : 1);
    }
  }
});
