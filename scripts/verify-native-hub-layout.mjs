import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.cache/mobile-qa',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
  for(const viewport of [{width:402,height:769},{width:360,height:640}]) {
    const page=await browser.newPage({viewport});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    for(const scenario of ['normal','long','empty','loading','error','signed-out']) {
      await page.goto(`http://127.0.0.1:5180/?state=${scenario}`);await page.getByRole('tab',{name:'Home',exact:true}).waitFor();
      if(['normal','long','empty'].includes(scenario)) await page.getByText('QUICK ACCESS',{exact:true}).waitFor();
      else if(scenario==='loading') await page.getByText('Loading your Tribe Hub…',{exact:true}).waitFor();
      else if(scenario==='error') {await page.getByRole('button',{name:'Try again'}).click();await page.getByText('Unable to load your Tribe Hub. Attempts: 1').waitFor();}
      else await page.getByText('A member session is required.').waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const overflow=await page.evaluate(()=>{
        const viewport=innerWidth;
        return [...document.querySelectorAll('div')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>viewport+1);}).map(el=>({text:el.textContent.slice(0,70),width:el.getBoundingClientRect().width}));
      });
      assert.deepEqual(overflow,[],`${viewport.width}/${scenario}: horizontal overflow`);
      assert.deepEqual(errors,[],`${viewport.width}/${scenario}: runtime errors`);
      await page.screenshot({path:`.cache/mobile-qa/${viewport.width}-${scenario}.png`});
      if(['normal','long','empty'].includes(scenario)) {
        const scroll=page.getByTestId('hub-scroll');await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);
        await page.screenshot({path:`.cache/mobile-qa/${viewport.width}-${scenario}-events.png`});
      }
      results.push({viewport,scenario,horizontalOverflow:0,runtimeErrors:0});
    }
    await page.goto('http://127.0.0.1:5180/');await page.getByText('QUICK ACCESS',{exact:true}).waitFor();
    await page.getByRole('button',{name:'View my ID Card',exact:true}).click();await page.getByText('Destination: id-card').waitFor();
    await page.getByRole('tab',{name:'Home',exact:true}).click();await page.getByText('QUICK ACCESS',{exact:true}).waitFor();
    for(const [name,destination] of [['My ID Card','id-card'],['My Profile','profile'],['Announcement','announcements']]) {
      await page.getByRole('button',{name,exact:true}).last().click();await page.getByText(`Destination: ${destination}`).waitFor();await page.getByRole('tab',{name:'Home',exact:true}).click();
    }
    await page.getByRole('button',{name:'Open member menu'}).click();await page.getByRole('button',{name:'Close menu'}).waitFor();await page.getByRole('button',{name:'Announcement',exact:true}).last().click();await page.getByText('Destination: announcements').waitFor();
    await page.getByRole('tab',{name:'Home',exact:true}).click();
    await page.getByRole('button',{name:'Announcements',exact:true}).click();await page.getByText('Destination: announcements').waitFor();
    for(const name of ['Home','My ID Card','Announcement','My Profile']) {await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');}
    await page.close();
  }
  await writeFile('.cache/mobile-qa/results.json',JSON.stringify(results,null,2));console.log(`PASS: ${results.length} viewport/state combinations, navigation, retry, runtime and overflow checks.`);
} finally {await browser.close();}
