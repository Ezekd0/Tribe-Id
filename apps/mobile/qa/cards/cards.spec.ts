import {test,expect} from '@playwright/test';
test('native card presents selectable expiring proof and refresh replaces it',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Get card proof',exact:true}).click();await expect(page.getByText('opaque-test-proof-1',{exact:true})).toBeVisible();await expect(page.getByText('Proof expires:',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Refresh card proof',exact:true}).click();await expect(page.getByText('opaque-test-proof-2',{exact:true})).toBeVisible();await expect(page.getByText('opaque-test-proof-1',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
});
test('expired and revoked owner card proofs are not presented',async({page})=>{
 await page.goto('/?state=expired');await page.getByRole('button',{name:'Get card proof',exact:true}).click();await expect(page.getByText('This proof has expired.',{exact:false})).toBeVisible();await expect(page.getByLabel('Card proof',{exact:true})).toHaveCount(0);
 await page.goto('/?state=revoked');await expect(page.getByRole('button',{name:'Get card proof',exact:true})).toHaveCount(0);await expect(page.getByText('A proof is available only for your active, issued card.',{exact:true})).toBeVisible();
});
test('verification shows approved fields and input changes clear previous result',async({page})=>{
 await page.goto('/');await page.getByRole('textbox',{name:'Card proof to verify',exact:true}).fill('valid-proof');await page.getByRole('button',{name:'Verify card proof',exact:true}).click();await expect(page.getByText('Display name: Verified Member',{exact:true})).toBeVisible();await expect(page.getByText('Member number: TRIBE-001',{exact:true})).toBeVisible();await expect(page.getByText('Status: issued',{exact:true})).toBeVisible();await expect(page.getByText('Card expires:',{exact:false})).toBeVisible();await page.getByRole('textbox',{name:'Card proof to verify',exact:true}).fill('changed');await expect(page.getByText('Verification result',{exact:true})).toHaveCount(0);
});
for(const scenario of ['invalid','scope','revoked-proof','malformed'])test(`verification safely rejects ${scenario} responses`,async({page})=>{
 await page.goto(`/?state=${scenario}`);await page.getByRole('textbox',{name:'Card proof to verify',exact:true}).fill('valid-proof');await page.getByRole('button',{name:'Verify card proof',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText('Verification result',{exact:true})).toHaveCount(0);await expect(page.getByText('must-not-display@example.invalid',{exact:false})).toHaveCount(0);
});
