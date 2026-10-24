import {Pool} from 'pg';
import {readEnvironment} from '../config/env.js';
import {createR2Store} from '../infrastructure/storage/r2.js';
import {drainAssetDeletions} from '../modules/profiles/portrait-service.js';
const env=readEnvironment();
if(!env.databaseUrl||!env.r2)throw new Error('Configured database and private R2 storage are required');
const pool=new Pool({connectionString:env.databaseUrl,max:2});
try{console.log(await drainAssetDeletions(pool,createR2Store(env.r2)));}catch{console.error('Private asset cleanup failed; no credentials emitted.');process.exitCode=1;}finally{await pool.end();}
