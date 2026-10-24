import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnvironment, runChecks, execute } from './ci-plan.mjs';

test('CI gates discard service credentials and public environment overrides', () => {
  const env=isolatedEnvironment({PATH:'/tool/bin',DATABASE_URL:'private',PGPASSWORD:'private',SMTP_URL:'private',AUTH_ENCRYPTION_KEY:'private',AWS_SECRET_ACCESS_KEY:'private',NODE_OPTIONS:'--require private',EXPO_PUBLIC_API_URL:'https://production.invalid',PLAYWRIGHT_CHANNEL:'chromium'});
  assert.equal(env.PATH,'/tool/bin');assert.equal(env.PLAYWRIGHT_CHANNEL,'chromium');
  for(const key of ['DATABASE_URL','PGPASSWORD','SMTP_URL','AUTH_ENCRYPTION_KEY','AWS_SECRET_ACCESS_KEY','NODE_OPTIONS']) assert.equal(env[key],undefined);
  assert.equal(env.EXPO_PUBLIC_API_URL,'https://api.example.invalid');assert.equal(env.CI,'true');assert.equal(env.AUTH_ENABLED,'false');
});
test('required failing command stops remaining gates and cannot pass CI',async()=>{
  const commands=[];
  await assert.rejects(runChecks(['check','database','mobile'],async(command,args)=>{commands.push(args);return args.includes('test:database-isolated')?17:0;},{}),/CI database failed \(exit 17\)/);
  assert.equal(commands.length,2);
  assert.equal(await execute(process.execPath,['-e','process.exit(23)'],isolatedEnvironment({PATH:process.env.PATH})),23);
});
test('CI runs selected fixed commands; unknown names fail before execution',async()=>{
  const calls=[];
  await runChecks(['mobile','browser'],async(command,args,env)=>{calls.push({command,args,env});return 0;},{});
  assert.equal(calls[0].env.NODE_ENV,'production');assert.ok(calls[0].args.includes('export'));assert.equal(calls[1].env.NODE_ENV,'test');
  await assert.rejects(runChecks(['check','untrusted'],async()=>{throw new Error('must not execute');},{}),/Unknown CI check/);
});
