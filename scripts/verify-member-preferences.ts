import {SharedProfileService} from '../apps/api/src/modules/profiles/shared-service.js';
import {MobileSessionRepository} from '../apps/api/src/modules/auth/repository.js';
import type {ObjectStore} from '../apps/api/src/infrastructure/storage/r2.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../apps/api/src/app.js';
import {readEnvironment} from '../apps/api/src/config/env.js';
import {createSessionToken,hashSessionToken} from '../apps/api/src/modules/authentication/session.js';
if(!process.env.DATABASE_URL||process.env.AUTH_TEST_DISPOSABLE!=='true') throw new Error('Explicit disposable DATABASE_URL and AUTH_TEST_DISPOSABLE=true required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10}),app=await buildApp(readEnvironment({NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL}));
const tribe=randomUUID(),otherTribe=randomUUID(),defaults={emailNotifications:false,pushNotifications:false,profileVisibility:'private'};
async function member(scope:string) {
 const id=randomUUID(),token=createSessionToken();await pool.query("INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,'fixture-no-password',now())",[id,id+'@example.invalid']);
 const membership=(await pool.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES($1,$2,$3,'active') RETURNING id",[scope,id,'PRIVATE-MEMBER-'+id])).rows[0].id as string;
 await pool.query("INSERT INTO profiles(membership_id,tribe_id,display_name,bio,phone,date_of_birth,location,occupation) VALUES($1,$2,'Shared name','Approved bio','1234567890','1990-01-01','Example City','Engineer')",[membership,scope]);
 const session=(await pool.query("INSERT INTO device_sessions(user_id,device_name) VALUES($1,'Preference fixture') RETURNING id",[id])).rows[0].id as string;
 await pool.query('INSERT INTO access_tokens(session_id,token_hash) VALUES($1,$2)',[session,hashSessionToken(token)]);return {id,token,membership,session};
}
async function preferences(token:string,payload?:unknown,scope=tribe) {return app.inject({method:payload===undefined?'GET':'PATCH',url:`/api/v1/tribes/${scope}/preferences`,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload:payload as Record<string,unknown>})});}
async function shared(token:string,target:string,scope=tribe) {return app.inject({url:`/api/v1/tribes/${scope}/members/${target}/shared-profile`,headers:{authorization:'Bearer '+token}});}
async function settings(membership:string) {return (await pool.query('SELECT * FROM member_settings WHERE membership_id=$1',[membership])).rows[0];}
function hidden(response:{statusCode:number;json:()=>any}) {assert.equal(response.statusCode,404);assert.equal(response.json().error.code,'PROFILE_NOT_FOUND');assert.equal(response.json().error.message,'Shared profile is unavailable.');}
try {
 for(const id of [tribe,otherTribe]) await pool.query('INSERT INTO tribes(id,name,slug) VALUES($1,$2,$3)',[id,'Preferences test',id]);
 const a=await member(tribe),viewer=await member(tribe),foreign=await member(otherTribe),fresh=await member(tribe);
 const initial=await preferences(a.token);assert.equal(initial.statusCode,200);assert.equal(initial.headers['cache-control'],'no-store');assert.deepEqual(initial.json(),defaults);assert.equal(await settings(a.membership),undefined);hidden(await shared(viewer.token,a.membership));
 // Historic defaults and unproven sharing flags remain stored, but are never effective opt-in.
 await pool.query("INSERT INTO member_settings(membership_id,email_notifications,profile_visibility) VALUES($1,true,'tribe')",[a.membership]);
 assert.deepEqual((await preferences(a.token)).json(),defaults);hidden(await shared(viewer.token,a.membership));
 assert.equal((await preferences(a.token,{pushNotifications:true})).statusCode,200);
 assert.deepEqual((await preferences(a.token)).json(),{...defaults,pushNotifications:true});
 let raw=await settings(a.membership);assert.equal(raw.email_notifications,true);assert.equal(raw.profile_visibility,'tribe');assert.equal(raw.informational_email_consent_at,null);assert.equal(raw.profile_sharing_consent_at,null);hidden(await shared(viewer.token,a.membership));
 assert.deepEqual((await preferences(a.token,{emailNotifications:true,profileVisibility:'tribe'})).json(),{emailNotifications:true,pushNotifications:true,profileVisibility:'tribe'});
 raw=await settings(a.membership);assert.ok(raw.informational_email_consent_at);assert.ok(raw.profile_sharing_consent_at);
 const skill=(await pool.query("INSERT INTO skills(name) VALUES('Shared skill') RETURNING id")).rows[0].id;
 await pool.query('INSERT INTO member_skills(membership_id,skill_id) VALUES($1,$2)',[a.membership,skill]);
 const team=(await pool.query("INSERT INTO teams(tribe_id,name) VALUES($1,'Shared team') RETURNING id",[tribe])).rows[0].id;await pool.query('INSERT INTO team_memberships(team_id,membership_id,tribe_id) VALUES($1,$2,$3)',[team,a.membership,tribe]);
 const achievement=(await pool.query("INSERT INTO achievements(tribe_id,name,description) VALUES($1,'Shared award','Approved achievement') RETURNING id",[tribe])).rows[0].id;
 await pool.query("INSERT INTO member_achievements(achievement_id,membership_id,tribe_id,awarded_at) VALUES($1,$2,$3,'2026-01-01T00:00:00Z')",[achievement,a.membership,tribe]);
 const visible=await shared(viewer.token,a.membership);assert.equal(visible.statusCode,200);assert.equal(visible.headers['cache-control'],'no-store');
 assert.deepEqual(visible.json(),{displayName:'Shared name',avatarUrl:null,bio:'Approved bio',location:'Example City',occupation:'Engineer',skills:['Shared skill'],teams:['Shared team'],achievements:[{id:achievement,name:'Shared award',description:'Approved achievement',awardedAt:'2026-01-01T00:00:00Z'}]});
 for(const forbidden of ['email','phone','dateOfBirth','memberNumber','membershipId','userId','1234567890','1990-01-01','@example.invalid','PRIVATE-MEMBER-']) assert.ok(!visible.body.includes(forbidden));
 // Signing is restricted to explicitly shared, ready, target-owned portraits.
 const signCalls:{key:string;seconds:number}[]=[];
 const store:ObjectStore={presignDownload:async(key,seconds)=>{signCalls.push({key,seconds});return 'https://private.example.invalid/temporary-capability';},presignUpload:async()=>{throw new Error('unused');},read:async()=>{throw new Error('unused');},write:async()=>{throw new Error('unused');},delete:async()=>{throw new Error('unused');}};
 const sharedService=new SharedProfileService(pool,store),viewerIdentity=await new MobileSessionRepository(pool).resolve(hashSessionToken(viewer.token));assert.ok(viewerIdentity);
 const portraitKey='private-portrait-'+randomUUID(),portrait=(await pool.query("INSERT INTO assets(tribe_id,uploaded_by,storage_key,mime_type,size_bytes,status) VALUES($1,$2,$3,'image/webp',100,'ready') RETURNING id",[tribe,a.id,portraitKey])).rows[0].id;
 await pool.query('UPDATE profiles SET avatar_asset_id=$2 WHERE membership_id=$1',[a.membership,portrait]);
 const signed=await sharedService.read(viewerIdentity,tribe,a.membership);assert.equal(signed.avatarUrl,'https://private.example.invalid/temporary-capability');assert.deepEqual(signCalls,[{key:portraitKey,seconds:60}]);assert.ok(!JSON.stringify(signed).includes(portraitKey));assert.ok(!JSON.stringify(signed).includes('_avatarStorageKey'));
 assert.equal((await shared(viewer.token,a.membership)).json().avatarUrl,null);
 await pool.query("UPDATE assets SET status='pending' WHERE id=$1",[portrait]);assert.equal((await sharedService.read(viewerIdentity,tribe,a.membership)).avatarUrl,null);assert.equal(signCalls.length,1);
 await pool.query("UPDATE assets SET status='ready',uploaded_by=$2 WHERE id=$1",[portrait,viewer.id]);assert.equal((await sharedService.read(viewerIdentity,tribe,a.membership)).avatarUrl,null);assert.equal(signCalls.length,1);
 await pool.query('UPDATE assets SET uploaded_by=$2 WHERE id=$1',[portrait,a.id]);
 hidden(await shared(foreign.token,a.membership));hidden(await shared(viewer.token,foreign.membership));hidden(await shared(viewer.token,a.membership,otherTribe));hidden(await shared(viewer.token,randomUUID()));
 for(const status of ['pending','suspended','revoked']) {await pool.query('UPDATE tribe_memberships SET status=$2 WHERE id=$1',[a.membership,status]);hidden(await shared(viewer.token,a.membership));assert.equal((await preferences(a.token)).statusCode,404);assert.equal((await preferences(a.token,{pushNotifications:false})).statusCode,404);}
 await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[a.membership]);
 await pool.query("UPDATE users SET account_status='disabled' WHERE id=$1",[a.id]);hidden(await shared(viewer.token,a.membership));assert.equal((await preferences(a.token)).statusCode,401);
 await pool.query("UPDATE users SET account_status='enabled',email_verified_at=NULL WHERE id=$1",[a.id]);hidden(await shared(viewer.token,a.membership));await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[a.id]);
 await pool.query("UPDATE tribe_memberships SET status='suspended' WHERE id=$1",[viewer.membership]);hidden(await shared(viewer.token,a.membership));await pool.query("UPDATE tribe_memberships SET status='active' WHERE id=$1",[viewer.membership]);
 // Optout and a simultaneous profile read serialize without a lock cycle. A read may
 // finish before optout; every read after the completed optout must be hidden.
 for(const reverse of [false,true]) {
  assert.equal((await preferences(a.token,{profileVisibility:'tribe'})).statusCode,200);
  const race=await Promise.all(reverse?[preferences(a.token,{profileVisibility:'private'}),shared(viewer.token,a.membership)]:[shared(viewer.token,a.membership),preferences(a.token,{profileVisibility:'private'})]);
  const result=reverse?race[1]:race[0],optout=reverse?race[0]:race[1];
  assert.equal(optout!.statusCode,200);assert.ok([200,404].includes(result!.statusCode));hidden(await shared(viewer.token,a.membership));
 }
 assert.equal((await preferences(a.token,{profileVisibility:'private'})).statusCode,200);hidden(await shared(viewer.token,a.membership));assert.equal((await settings(a.membership)).profile_sharing_consent_at,null);
 const beforePrivateSigns=signCalls.length;await assert.rejects(sharedService.read(viewerIdentity,tribe,a.membership),{statusCode:404,code:'PROFILE_NOT_FOUND'});assert.equal(signCalls.length,beforePrivateSigns);
 const stable=await settings(a.membership),count=(await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='preferences.updated'")).rows[0].count;
 for(const value of [{},{emailNotifications:'true'},{pushNotifications:1},{profileVisibility:'public'},{profileVisibility:null},{emailNotifications:true,membershipId:viewer.membership},{emailNotifications:null},{securityEmails:false},{profileVisibility:'tribe',userId:viewer.id}]) assert.equal((await preferences(a.token,value)).statusCode,400);
 assert.deepEqual(await settings(a.membership),stable);assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='preferences.updated'")).rows[0].count,count);
 assert.equal((await preferences(a.token,{emailNotifications:false},otherTribe)).statusCode,404);assert.equal(await settings(viewer.membership),undefined);
 await pool.query("CREATE FUNCTION reject_preference_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit fixture unavailable'; END $$");
 await pool.query("CREATE TRIGGER reject_preference_audit_fixture BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='preferences.updated') EXECUTE FUNCTION reject_preference_audit_fixture()");
 assert.equal((await preferences(a.token,{profileVisibility:'tribe',emailNotifications:false})).statusCode,500);assert.deepEqual(await settings(a.membership),stable);hidden(await shared(viewer.token,a.membership));
 assert.equal((await preferences(fresh.token,{profileVisibility:'tribe'})).statusCode,500);assert.equal(await settings(fresh.membership),undefined);
 await pool.query('DROP TRIGGER reject_preference_audit_fixture ON audit_logs');await pool.query('DROP FUNCTION reject_preference_audit_fixture()');
 assert.deepEqual((await preferences(a.token,{emailNotifications:false,pushNotifications:false})).json(),defaults);assert.equal((await settings(a.membership)).informational_email_consent_at,null);
 const updates=await Promise.all([preferences(a.token,{emailNotifications:true}),preferences(a.token,{pushNotifications:true})]);assert.deepEqual(updates.map(response=>response.statusCode),[200,200]);assert.deepEqual((await preferences(a.token)).json(),{emailNotifications:true,pushNotifications:true,profileVisibility:'private'});
 assert.equal((await preferences(fresh.token,{pushNotifications:true})).statusCode,200);const newRow=await settings(fresh.membership);assert.equal(newRow.email_notifications,false);assert.equal(newRow.informational_email_consent_at,null);assert.equal(newRow.profile_visibility,'private');assert.equal(newRow.profile_sharing_consent_at,null);
 const logs=(await pool.query("SELECT * FROM audit_logs WHERE action='preferences.updated'")).rows;
 for(const row of logs) {assert.equal(row.tribe_id,tribe);assert.ok([a.id,fresh.id].includes(row.actor_user_id));assert.ok([a.membership,fresh.membership].includes(row.resource_id));assert.deepEqual(Object.keys(row.metadata),['changedFields']);assert.ok(row.metadata.changedFields.every((name:string)=>['emailNotifications','pushNotifications','profileVisibility'].includes(name)));}
 for(const secret of [a.token,'@example.invalid','1234567890','Approved bio']) assert.ok(!JSON.stringify(logs).includes(secret));
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM auth_outbox')).rows[0].count,0);
 await pool.query('UPDATE device_sessions SET revoked_at=now() WHERE id=$1',[viewer.session]);assert.equal((await shared(viewer.token,a.membership)).statusCode,401);
 assert.equal((await app.inject({url:`/api/v1/tribes/${tribe}/preferences`})).statusCode,401);
 console.log('PASS real PostgreSQL explicit preference consent/defaults, legacy non-consent, strict own-only updates/concurrency, shared approved-fields privacy and scoped/live-state denial, safe audit rollback and no delivery generation');
} finally {await app.close();await pool.end();}
