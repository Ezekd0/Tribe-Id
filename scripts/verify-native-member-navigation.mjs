import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const viewport of [{width:402,height:769},{width:360,height:640}]) {
  const page=await browser.newPage({viewport});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5180/?feature=profile');await page.getByText('ABOUT ME',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Account Settings',exact:true}).click();await page.getByRole('heading',{name:'Account Settings',exact:true}).waitFor();
  for(const label of ['Password, email and device security','Notification Settings','Privacy Settings'])await page.getByText(label,{exact:true}).waitFor();
  await page.screenshot({path:`.cache/member-qa/settings-${viewport.width}.png`});
  await page.getByRole('button',{name:'Back to My Profile'}).click();await page.getByText('ABOUT ME',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'My ID Card',exact:true}).click();await page.getByText('TRIBE MEMBER',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Announcement',exact:true}).click();await page.getByText('IMPORTANT',{exact:true}).first().waitFor();
  await page.getByRole('tab',{name:'Home',exact:true}).click();await page.getByText('QUICK ACCESS',{exact:true}).waitFor();
  await page.getByRole('button',{name:'View all upcoming events',exact:true}).click();await page.getByRole('button',{name:/^View details:/}).first().click();await page.getByText('EVENT DETAILS',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to events'}).click();await page.getByRole('button',{name:'Back to Tribe Hub'}).click();await page.getByText('QUICK ACCESS',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Open member menu'}).click();await page.getByRole('button',{name:'My Profile',exact:true}).last().click();await page.getByText('ABOUT ME',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Log Out',exact:true}).first().click();await page.getByText('Your session has expired.',{exact:true}).waitFor();
  for(const state of ['normal','expired','loading']) {
   await page.goto(`http://127.0.0.1:5180/?feature=auth&state=${state}`);
   if(state==='loading')await page.getByLabel('Loading',{exact:true}).waitFor();else {await page.getByRole('button',{name:'Restore saved session',exact:true}).click();await page.getByText(state==='expired'?'Your session has expired.':'No valid saved session was found.',{exact:true}).waitFor();}
   await page.screenshot({path:`.cache/member-qa/auth-${viewport.width}-${state}.png`});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: member tabs/menu, Hub→events→detail→back, Profile→Settings→back, logout affordance and provisional auth states at both viewports.');
}finally{await browser.close();}
