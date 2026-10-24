import {pathToFileURL} from 'node:url';
// Public list rates reviewed 2026-10-24. No account, free-tier quota or tax assumed.
export function scenarioCost(s){
 const minutes=s.days*1440,rate=0.00016;
 const jobs=s.jobFractions.reduce((sum,f)=>sum+Math.max(1,minutes*f*rate),0);
 const backup=Math.max(1,minutes*s.backupFraction*rate);
 const storage=Math.ceil(s.r2GbMonths)*0.015;
 const operations=Math.ceil(s.r2ClassA/1e6)*4.5+Math.ceil(s.r2ClassB/1e6)*0.36;
 const overage=s.bandwidthOverGb*0.15+s.buildOverMinutes/1000*5;
 const components={api:25,postgres:19,postgresDisk:1.5,applicationJobs:jobs,backupJob:backup,r2:storage+operations,workspace:s.workspace,smtpReserve:s.smtpReserve,monitoringReserve:s.monitoringReserve,bandwidthAndBuildOverage:overage};
 const subtotal=Object.values(components).reduce((a,b)=>a+b,0);
 return {name:s.name,components,preTaxMonthly:Math.round((subtotal+Number.EPSILON)*100)/100,accountSpecificQuoteConfirmed:false,tax:null,spendingAuthorized:false};
}
export const scenarios=[
 {name:'baseline',days:30,jobFractions:[0,0,0,0],backupFraction:0,r2GbMonths:17,r2ClassA:50000,r2ClassB:100000,workspace:0,smtpReserve:0,monitoringReserve:0,bandwidthOverGb:0,buildOverMinutes:0},
 {name:'expected',days:30,jobFractions:[1/6,1/6,1/6,0],backupFraction:0,r2GbMonths:25,r2ClassA:200000,r2ClassB:500000,workspace:25,smtpReserve:5,monitoringReserve:5,bandwidthOverGb:0,buildOverMinutes:0},
 {name:'high_usage',days:31,jobFractions:[1,1,1,1],backupFraction:0,r2GbMonths:100,r2ClassA:2000000,r2ClassB:20000000,workspace:25,smtpReserve:20,monitoringReserve:10,bandwidthOverGb:75,buildOverMinutes:2000},
];
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({planningCeiling:100,prices:'public list rates; no free R2 allowance credited; usage and reserves are assumptions',excluded:'tax/FX, native signing/builds/devices, labor, one-time fees and unquoted network/recovery changes',scenarios:scenarios.map(scenarioCost)},null,2));
