import {test,expect} from '@playwright/test';
async function edit(page:import('@playwright/test').Page,scenario='normal'){
 await page.goto(`/?feature=profile&state=${scenario}`);await page.getByRole('button',{name:'Edit About Me',exact:true}).click();await expect(page.getByRole('textbox',{name:'About me',exact:true})).toBeVisible();
}
test('native profile form saves approved fields and cancel discards drafts',async({page})=>{
 await edit(page);await expect(page.getByRole('textbox')).toHaveCount(4);
 await page.getByRole('textbox',{name:'About me',exact:true}).fill('A profile saved through the native editor');await page.getByRole('textbox',{name:'Phone',exact:true}).fill('+1 (202) 555-0123');await page.getByRole('textbox',{name:'Location',exact:true}).fill(' Example Updated City ');
 await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('Your profile has been saved.',{exact:true})).toBeVisible();await expect(page.getByText('A profile saved through the native editor',{exact:true})).toBeVisible();await expect(page.getByText('+12025550123',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit information',exact:true}).click();await page.getByRole('textbox',{name:'Location',exact:true}).fill('Discard this');await page.getByRole('button',{name:'Cancel profile editing'}).click();await expect(page.getByText('Discard this',{exact:true})).toHaveCount(0);await expect(page.getByText('Example Updated City',{exact:true}).last()).toBeVisible();
});
test('native profile validation and no-change behavior do not submit writes',async({page})=>{
 await edit(page);await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('No profile changes to save.',{exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Phone',exact:true}).fill('123');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByRole('alert')).toContainText('7–15 digits');await expect(page.getByRole('textbox',{name:'Phone',exact:true})).toHaveValue('123');
});
test('native editor reconciles an uncertain committed write without claiming confirmed success',async({page})=>{
 await edit(page,'profile-uncertain');await page.getByRole('textbox',{name:'About me',exact:true}).fill('Persisted before response loss');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('Persisted before response loss',{exact:true})).toBeVisible();await expect(page.getByText('The save response could not be confirmed.',{exact:false})).toBeVisible();await expect(page.getByText('Your profile has been saved.',{exact:true})).toHaveCount(0);
});
test('native editor blocks another write when reconciliation fails',async({page})=>{
 await edit(page,'profile-reload-error');await page.getByRole('textbox',{name:'About me',exact:true}).fill('Uncertain');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('The save outcome could not be confirmed.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Save profile',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Reload latest profile'})).toBeVisible();await expect(page.getByRole('textbox',{name:'About me',exact:true})).not.toBeEditable();
});
test('native profile rejection preserves the draft for correction',async({page})=>{
 await edit(page,'profile-rejected');await page.getByRole('textbox',{name:'About me',exact:true}).fill('Keep this draft');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('Profile update is not permitted.',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'About me',exact:true})).toHaveValue('Keep this draft');await expect(page.getByRole('button',{name:'Save profile',exact:true})).toBeEnabled();await expect(page.getByText('Your profile has been saved.',{exact:true})).toHaveCount(0);
});
