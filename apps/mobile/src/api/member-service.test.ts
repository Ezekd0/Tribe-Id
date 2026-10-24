import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemberService} from './member-service';
import {isMemberRoute, memberRoutes} from '../navigation/routes';
test('member service calls protected versioned contracts and rejects invalid Tribe paths',async () => {
  const paths:string[] = [];
  const service = new MemberService({get:async <T>(path:string) => {paths.push(path);return {} as T;}});
  await service.memberships();await service.hub('12345678-1234-1234-1234-123456789abc');
  assert.deepEqual(paths,['/api/v1/me','/api/v1/tribes/12345678-1234-1234-1234-123456789abc/hub']);
  assert.throws(() => service.hub('../foreign'));
});
test('all audited shell routes are reachable; unknown routes are rejected',() => {for(const route of memberRoutes) assert.equal(isMemberRoute(route),true);assert.equal(isMemberRoute('admin'),false);});
test('profile updates use scoped PATCH, preserve null clearing and reject unsafe Tribe paths',async()=>{
 const calls:unknown[]=[];const service=new MemberService({get:async<T>()=>({} as T),patch:async<T>(path:string,body:Record<string,string|null>)=>{calls.push({path,body});return undefined as T;}});
 await service.updateProfile('12345678-1234-1234-1234-123456789abc',{bio:'New bio',phone:null});
 assert.deepEqual(calls,[{path:'/api/v1/tribes/12345678-1234-1234-1234-123456789abc/profile',body:{bio:'New bio',phone:null}}]);
 assert.throws(()=>service.updateProfile('../foreign',{bio:'No'}));assert.equal(calls.length,1);
});
