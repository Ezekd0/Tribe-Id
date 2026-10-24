import { Pool } from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { readEnvironment } from '../apps/api/src/config/env.js';

// Credentials come only from the caller's environment. Errors are sanitized.
const env = readEnvironment();
if (!env.databaseUrl) throw new Error('Private DATABASE_URL required');
const pool = new Pool({ connectionString: env.databaseUrl });
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const identity = (await pool.query('SELECT current_database() AS db, current_user AS role')).rows[0];
  if (identity.db !== 'trueda_tribe_id' || identity.role !== 'trueda_tribe_id_app') throw new Error('identity');
  const migration = await pool.query("SELECT 1 FROM schema_migrations WHERE name='012_push_delivery_receipts.sql'");
  if (!migration.rowCount) {
    console.error('Required migration 009 is missing. Apply approved migrations with an authorized migration role, then rerun.');
    process.exitCode = 1;
  } else {
    app = await buildApp(env);
    // Port 0 defaults to an available port; an explicitly supplied PORT must be free.
    const address = await app.listen({ host: '127.0.0.1', port: process.env.PORT ? env.port : 0 });
    for (const path of ['/api/v1/health', '/api/v1/health/ready']) {
      const response = await fetch(address + path, { signal: AbortSignal.timeout(5000) });
      console.log(`${path}: HTTP ${response.status}`);
      if (response.status !== 200) throw new Error('health');
    }
    console.log(`Verified Trueda API: ${address}; authentication ${env.auth ? 'enabled' : 'disabled (health verification only)'}. Ctrl+C stops this instance.`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app!.close(); });
  }
} catch {
  console.error('Actual database/API verification failed. Check app-role login, schema permissions/migrations and the selected port. No credentials emitted.');
  await app?.close();
  process.exitCode = 1;
} finally {
  await pool.end();
}
