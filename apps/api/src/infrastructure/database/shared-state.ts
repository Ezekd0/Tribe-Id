import type { Pool } from 'pg';
export async function incrementLimit(database:Pool,key:string) {
    const result = await database.query<{count:number}>(`INSERT INTO request_limits(key,window_start,count) VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.window_start=EXCLUDED.window_start THEN request_limits.count+1 ELSE 1 END,window_start=EXCLUDED.window_start RETURNING count`, [key]);
 return result.rows[0]!.count;
}
export async function ready(database:Pool) {
 const result=await database.query("SELECT 1 FROM schema_migrations WHERE name='012_push_delivery_receipts.sql'");
 return Boolean(result.rowCount);
}
