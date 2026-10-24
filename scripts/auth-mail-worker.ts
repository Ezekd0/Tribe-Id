import { Pool } from 'pg';
import { readEnvironment } from '../apps/api/src/config/env.js';
import { deliverAuthMail } from '../apps/api/src/modules/auth/delivery.js';
import {assertAuthMailDeliveryAllowed} from '../apps/api/src/modules/auth/mail-policy.js';
const env = readEnvironment();
if (!env.auth || !env.databaseUrl)
    throw new Error('Configured authentication is required');
assertAuthMailDeliveryAllowed(env.auth,env.nodeEnv,process.env.AUTH_MAIL_DELIVERY_ENABLED);
const pool = new Pool({ connectionString: env.databaseUrl, max: 2 });
try {
    console.log(await deliverAuthMail(pool, env.auth));
}
catch {console.error(JSON.stringify({event:'auth_mail_worker_failed',code:'operation_failed'}));process.exitCode=1;}
finally {
    await pool.end();
}
