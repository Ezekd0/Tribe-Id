import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; no default credentials are provided.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(734821006)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(734821006)').catch(() => {});
  await client.end();
}
