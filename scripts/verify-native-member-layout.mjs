import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('.cache/member-qa',{recursive:true});
const features=(process.argv[2]||'id-card').split(',');
const browser=await chromium.launch({channel:'chrome',headless:true});let combinations=0;
try {
 for(const viewport of [{width:402,height:769},{width:360,height:640}]) {
  const page=await browser.newPage({viewport});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const feature of features)for(const state of ['normal','empty','error','loading','expired','long']) {
   await page.goto(`http://127.0.0.1:5180/?feature=${feature}&state=${state}`);
   if(state==='loading')await page.getByLabel('Loading',{exact:true}).waitFor();
   else if(state==='error'){await page.getByRole('button',{name:'Try again'}).click();await page.getByText('Unable to contact the Tribe service. Please try again.',{exact:true}).waitFor({state:'hidden'});}
   else if(state==='expired')await page.getByText('Your session has expired.',{exact:true}).waitFor();
   else if(feature==='id-card')await page.getByText(state==='empty'?'Your Tribe ID card has not been issued yet.':'TRIBE MEMBER',{exact:true}).waitFor();
   else if(feature==='profile')await page.getByText(state==='empty'?'Your profile has not been provided yet.':'ABOUT ME',{exact:true}).waitFor();
   else if(feature==='announcements')await page.getByText(state==='empty'?'No announcements yet.':'IMPORTANT',{exact:true}).first().waitFor();
   else if(feature==='events')await (state==='empty'?page.getByText('No upcoming events.',{exact:true}):page.getByRole('button',{name:/^View details:/}).first()).waitFor();
   else await page.getByRole('heading',{name:({'profile':'My Profile','announcements':'Announcement','events':'Upcoming Events','settings':'Account Settings'})[feature],exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   if(state==='error')await page.getByRole('button',{name:'Try again'}).waitFor({state:'hidden'});
   const overflow=await page.evaluate(()=>[...document.querySelectorAll('div')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>innerWidth+1);}).length);
   assert.equal(overflow,0,`${feature}/${state}/${viewport.width}: overflow`);assert.deepEqual(errors,[],'runtime errors');
   if(feature==='events'&&['normal','long'].includes(state)){await page.getByRole('button',{name:/^View details:/}).first().click();await page.getByText('EVENT DETAILS',{exact:true}).waitFor();await page.getByRole('button',{name:'Back to events',exact:true}).click();}
   await page.screenshot({path:`.cache/member-qa/${feature}-${viewport.width}-${state}.png`});combinations++;
  }
  await page.close();
 }
 console.log(`PASS: ${combinations} member viewport/state combinations, retry, expiry and horizontal-overflow checks.`);
}finally{await browser.close();}
