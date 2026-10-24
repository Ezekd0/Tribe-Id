import {test,expect} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:5174'});
const pair={accessToken:'a'.repeat(43),refreshToken:'r'.repeat(43),expiresIn:900};
test('normal reference requires explicit sign-in and never uses preview or persistent credentials',async({page})=>{
  const paths:string[]=[];page.on('request',request=>{if(request.url().includes('/api/'))paths.push(new URL(request.url()).pathname);});
  await page.goto('/hub');await expect(page.getByRole('heading',{name:'A member session is required'})).toBeVisible();
  await expect(page.getByText('Development preview',{exact:false})).toBeHidden();expect(paths.some(path=>path.includes('/development/'))).toBe(false);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
});
test('existing-account bearer login rotates on expiry, logs out with bearer, and reload loses credentials',async({page})=>{
  const requests:{path:string;authorization:string|undefined;body:unknown}[]=[];
  let meCalls=0;
  await page.route('**/api/v1/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    requests.push({path,authorization:request.headers().authorization,body:request.postDataJSON()});
    if(path.endsWith('/auth/login'))return route.fulfill({json:pair});
    if(path.endsWith('/auth/refresh'))return route.fulfill({json:{...pair,accessToken:'b'.repeat(43),refreshToken:'s'.repeat(43)}});
    if(path.endsWith('/me')){meCalls++;return meCalls===1?route.fulfill({status:401,json:{error:{code:'UNAUTHORIZED'}}}):route.fulfill({json:{memberships:[]}});}
    if(path.endsWith('/auth/logout'))return route.fulfill({status:204});
    throw new Error('Unexpected path '+path);
  });
  await page.goto('/profile');await page.getByLabel('Email',{exact:true}).fill('member@example.invalid');await page.getByLabel('Password',{exact:true}).fill(' correct password ');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No active Tribe membership'})).toBeVisible();
  expect(requests.find(r=>r.path.endsWith('/auth/login'))?.body).toEqual({email:'member@example.invalid',password:' correct password ',deviceName:'Trueda web reference'});
  expect(requests.find(r=>r.path.endsWith('/auth/refresh'))?.body).toEqual({refreshToken:pair.refreshToken});
  expect(requests.filter(r=>r.path.endsWith('/me')).map(r=>r.authorization)).toEqual(['Bearer '+pair.accessToken,'Bearer '+'b'.repeat(43)]);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie])).toEqual([0,0,'']);
  await page.goto('/hub');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill('member@example.invalid');await page.getByLabel('Password',{exact:true}).fill('password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'No active Tribe membership'})).toBeVisible();
  await page.getByRole('button',{name:'Open Tribe navigation'}).click();await page.getByRole('button',{name:'Log Out',exact:true}).click();await expect(page.getByRole('heading',{name:'You have been signed out'})).toBeVisible();
  expect(requests.find(r=>r.path.endsWith('/auth/logout'))?.authorization).toBe('Bearer '+pair.accessToken);
});
test('MFA challenge does not grant member access until verification succeeds',async({page})=>{
  let memberCalls=0;
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/auth/login'))return route.fulfill({json:{challengeToken:'c'.repeat(43),enrollmentRequired:false}});
    if(path.endsWith('/auth/mfa/verify'))return route.fulfill({json:pair});
    if(path.endsWith('/me')){memberCalls++;return route.fulfill({json:{memberships:[]}});}
    throw new Error('Unexpected path '+path);
  });
  await page.goto('/hub');await page.getByLabel('Email',{exact:true}).fill('member@example.invalid');await page.getByLabel('Password',{exact:true}).fill('password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByLabel('Authenticator code')).toBeVisible();expect(memberCalls).toBe(0);
  await page.getByLabel('Authenticator code').fill('123456');await page.getByRole('button',{name:'Verify authenticator'}).click();await expect(page.getByRole('heading',{name:'No active Tribe membership'})).toBeVisible();expect(memberCalls).toBe(1);
});
test('web authenticator enrollment shows recovery codes once and requires acknowledgment before member access',async({page})=>{
 let memberCalls=0;
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/auth/login'))return route.fulfill({json:{challengeToken:'c'.repeat(43),enrollmentRequired:true}});
  if(path.endsWith('/auth/mfa/setup'))return route.fulfill({json:{secret:'TESTONLYSETUPKEY',otpAuthUrl:'otpauth://totp/Tribe?secret=TESTONLYSETUPKEY'}});
  if(path.endsWith('/auth/mfa/verify'))return route.fulfill({json:{...pair,recoveryCodes:['a'.repeat(32),'b'.repeat(32)]}});
  if(path.endsWith('/me')){memberCalls++;return route.fulfill({json:{memberships:[]}});}throw new Error(path);
 });
 await page.goto('/hub');await page.getByLabel('Email',{exact:true}).fill('owner@example.invalid');await page.getByLabel('Password',{exact:true}).fill('password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await expect(page.getByText('TESTONLYSETUPKEY',{exact:true})).toBeVisible();await page.getByLabel('Authenticator code').fill('123456');await page.getByRole('button',{name:'Verify authenticator',exact:true}).click();await expect(page.getByRole('heading',{name:'Save your recovery codes',exact:true})).toBeVisible();expect(memberCalls).toBe(0);await expect(page.getByText('TESTONLYSETUPKEY',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'I have saved my recovery codes'}).click();await expect(page.getByRole('heading',{name:'No active Tribe membership'})).toBeVisible();expect(memberCalls).toBe(1);await expect(page.getByText('a'.repeat(32),{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
});
test('web authenticator recovery requires replacement setup and factor verification',async({page})=>{
 const calls:string[]=[];
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push(path);
  if(path.endsWith('/auth/login'))return route.fulfill({json:{challengeToken:'c'.repeat(43),enrollmentRequired:false}});
  if(path.endsWith('/auth/mfa/recover')){expect(route.request().postDataJSON()).toEqual({challengeToken:'c'.repeat(43),recoveryCode:'private-recovery'});return route.fulfill({json:{challengeToken:'d'.repeat(43),enrollmentRequired:true}});}
  if(path.endsWith('/auth/mfa/setup'))return route.fulfill({json:{secret:'REPLACEMENTSETUPKEY',otpAuthUrl:'otpauth://totp/Tribe?secret=REPLACEMENTSETUPKEY'}});
  if(path.endsWith('/auth/mfa/verify'))return route.fulfill({json:{...pair,recoveryCodes:['e'.repeat(32)]}});
  if(path.endsWith('/me'))return route.fulfill({json:{memberships:[]}});throw new Error(path);
 });
 await page.goto('/hub');await page.getByLabel('Email',{exact:true}).fill('owner@example.invalid');await page.getByLabel('Password',{exact:true}).fill('password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Use a recovery code'}).click();await page.getByLabel('Recovery code',{exact:true}).fill('private-recovery');await page.getByRole('button',{name:'Recover authenticator',exact:true}).click();await expect(page.getByRole('button',{name:'Set up authenticator',exact:true})).toBeVisible();expect(calls.some(path=>path.endsWith('/me'))).toBe(false);await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await page.getByLabel('Authenticator code').fill('123456');await page.getByRole('button',{name:'Verify authenticator',exact:true}).click();await page.getByRole('button',{name:'I have saved my recovery codes'}).click();await expect(page.getByRole('heading',{name:'No active Tribe membership'})).toBeVisible();
});
