import test from 'node:test';import assert from 'node:assert/strict';
import {scenarioCost,scenarios} from './staging-cost-model.mjs';
test('three scenarios expose budget risk without inventing a confirmed account quote',()=>{
 const result=scenarios.map(scenarioCost);assert.deepEqual(result.map(r=>r.preTaxMonthly),[55.62,91.19,169.02]);
 assert.ok(result[1].preTaxMonthly<100);assert.ok(result[2].preTaxMonthly>100);
 for(const row of result){assert.equal(row.accountSpecificQuoteConfirmed,false);assert.equal(row.spendingAuthorized,false);assert.equal(row.tax,null);}
});
test('cron minimum and operation rounding are charged even for tiny non-free usage',()=>{
 const cost=scenarioCost({...scenarios[0],r2ClassA:1,r2ClassB:1,r2GbMonths:0.1});
 assert.equal(cost.components.applicationJobs,4);assert.equal(cost.components.backupJob,1);assert.equal(cost.components.r2,4.875);
});
