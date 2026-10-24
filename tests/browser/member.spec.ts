import { test, expect } from '@playwright/test';
const paths=['/hub','/id-card','/profile','/announcements'];
for (const width of [320,375,402,768,1440]) {
  test(`audited member routes fit ${width}px and navigation works`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    for(const path of paths){
      await page.goto(path);await expect(page.getByText('Development preview · Illustrative data',{exact:false})).toBeVisible();
      await expect(page.getByRole('heading',{name:path==='/hub'?'Example Test Member':path==='/id-card'?'My ID Card':path==='/profile'?'My Profile':'Announcement',exact:true})).toBeVisible();
      await expect(page.getByText('Loading your Tribe…')).toBeHidden();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      for(const card of await page.locator('.profile-panel,.event-card,.announcement-card,.member-summary').all()){
        expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
      }
    }
    await page.getByRole('navigation',{name:'Tribe navigation',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
    await expect(page).toHaveURL(/\/hub/);
    await page.getByRole('button',{name:'Open Tribe navigation'}).click();
    const drawer=page.getByRole('dialog',{name:'Tribe navigation'});await expect(drawer).toBeVisible();
    await drawer.getByRole('link',{name:'My Profile',exact:true}).click();await expect(drawer).toBeHidden();await expect(page).toHaveURL(/\/profile/);
    await page.goBack();await expect(page.getByRole('heading',{name:'Example Test Member',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('empty state uses existing views without sample content',async({page})=>{
  for(const path of paths){await page.goto(`${path}?previewState=empty`);await expect(page.getByText('Loading your Tribe…')).toBeHidden();await expect(page.getByRole('main')).toContainText(path==='/hub'?'No upcoming events yet.':path==='/profile'?'Your profile has not been completed yet.':path==='/id-card'?'Your Tribe ID card has not been issued yet.':'No announcements yet.');}
});
test('long data reflows, incomplete actions are honest, drawer keyboard focus returns',async({page})=>{
  await page.setViewportSize({width:320,height:800});await page.goto('/profile?previewState=long');
  await expect(page.getByText('Loading your Tribe…')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Edit About Me'}).click({force:true});await expect(page.getByRole('status')).toContainText('Profile editing is not available yet.');
  await page.goto('/hub');await page.getByRole('button',{name:'Open Tribe navigation'}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Open Tribe navigation'})).toBeFocused();
});
test('API errors show retry and loading state resolves',async({page})=>{
  await page.route('**/api/v1/development/member-view*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"UNAVAILABLE","message":"Unavailable","requestId":"test"}}'}));
  await page.goto('/hub');await expect(page.getByRole('heading',{name:'Unable to load your Tribe'})).toBeVisible();
  await page.unroute('**/api/v1/development/member-view*');await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('heading',{name:'Example Test Member',exact:true})).toBeVisible();
});
for(const status of ['expired','revoked']){
  test(`compact and full ID cards preserve ${status} status`,async({page})=>{
    await page.route('**/api/v1/development/member-view*',async route=>{const response=await route.fetch();const body=await response.json();body.view.card.status=status;await route.fulfill({response,json:body});});
    await page.goto('/hub');const compact=page.getByLabel('Tribe ID card preview');await expect(compact).toContainText(status.toUpperCase());await expect(compact).not.toContainText('ACTIVE MEMBER');
    await page.getByRole('link',{name:'View my ID Card'}).click();await expect(page.getByLabel('Tribe ID card',{exact:true})).toContainText(status.toUpperCase());await expect(page.getByRole('main')).toContainText(`This Tribe ID card is ${status}.`);
  });
}
