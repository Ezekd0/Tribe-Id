import {test,expect} from '@playwright/test';
const button=(page:import('@playwright/test').Page,label:string)=>page.getByRole('button',{name:new RegExp('^'+label+': ')});
test('native events register, explicitly cancel and re-register with persisted status',async({page})=>{
 await page.goto('/');await button(page,'Register').click();await expect(button(page,'Cancel registration')).toBeVisible();await expect(page.getByText('Your event registration is confirmed.',{exact:true})).toBeVisible();await button(page,'Cancel registration').click();await expect(button(page,'Register again')).toBeVisible();await expect(page.getByText('Your event registration has been cancelled.',{exact:true})).toBeVisible();await button(page,'Register again').click();await expect(button(page,'Cancel registration')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {eventWrites:number}).eventWrites)).toBe(3);
});
test('Hub event participation performs the same real mutation workflow',async({page})=>{
 await page.goto('/?feature=hub');await button(page,'Register').click();await expect(button(page,'Cancel registration')).toBeVisible();await button(page,'Cancel registration').click();await expect(button(page,'Register again')).toBeVisible();expect(await page.evaluate(()=>(window as unknown as {eventWrites:number}).eventWrites)).toBe(2);
});
test('full and closed events expose honest disabled controls without capacity numbers',async({page})=>{
 await page.goto('/?state=full');await button(page,'Register').click();await expect(button(page,'Event full')).toBeDisabled();await expect(page.getByText('This event is full. There is no waitlist.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Reload events',exact:true}).click();await expect(button(page,'Register')).toBeEnabled();
 await page.goto('/?state=closed');await expect(button(page,'Registration closed')).toBeDisabled();expect(await page.evaluate(()=>(window as unknown as {eventWrites?:number}).eventWrites??0)).toBe(0);
 await page.goto('/?state=attended');await expect(button(page,'Attended')).toBeDisabled();
});
test('uncertain committed response reloads participation without duplicate writes',async({page})=>{
 await page.goto('/?state=uncertain');await button(page,'Register').click();await expect(button(page,'Cancel registration')).toBeVisible();await expect(page.getByText('The response could not be confirmed.',{exact:false})).toBeVisible();expect(await page.evaluate(()=>(window as unknown as {eventWrites:number}).eventWrites)).toBe(1);
});
test('failed reconciliation blocks further event writes pending successful reload',async({page})=>{
 await page.goto('/?state=reload-error');await button(page,'Register').click();await expect(page.getByText('Reload events before making another change.',{exact:false})).toBeVisible();await expect(button(page,'Register')).toBeDisabled();await page.getByRole('button',{name:'Reload events',exact:true}).click();await expect(button(page,'Register')).toBeDisabled();expect(await page.evaluate(()=>(window as unknown as {eventWrites:number}).eventWrites)).toBe(1);
});
test('pending event mutation disables duplicate submissions and details use stored timezone',async({page})=>{
 await page.goto('/?state=loading');await button(page,'Register').click();await expect(button(page,'Updating…')).toBeDisabled();await expect(button(page,'Cancel registration')).toBeVisible();expect(await page.evaluate(()=>(window as unknown as {eventWrites:number}).eventWrites)).toBe(1);await page.getByRole('button',{name:/^View details:/}).click();await expect(page.getByText('Timezone:',{exact:false})).toContainText('Africa/Lagos');await expect(page.getByRole('button',{name:'Cancel registration',exact:true})).toBeVisible();
});
