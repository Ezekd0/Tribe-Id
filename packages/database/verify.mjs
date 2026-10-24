import assert from 'node:assert/strict';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; use a disposable test database.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let savepoint = 0;
async function rejectsConstraint(sql, parameters, expectedCode) {
  const name = `constraint_check_${savepoint++}`;
  await client.query(`SAVEPOINT ${name}`);
  let actualCode;
  try { await client.query(sql, parameters); } catch (error) { actualCode = error.code; }
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  assert.equal(actualCode, expectedCode);
}
try {
  await client.query('BEGIN');
  const user = (await client.query("INSERT INTO users(email,password_hash) VALUES ('schema-check-' || gen_random_uuid() || '@example.invalid','test-hash-not-a-credential') RETURNING id")).rows[0].id;
  const tribeA = (await client.query("INSERT INTO tribes(name,slug) VALUES ('Schema check',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  const tribeB = (await client.query("INSERT INTO tribes(name,slug) VALUES ('Schema check B',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  const membership = (await client.query("INSERT INTO tribe_memberships(tribe_id,user_id,member_number,status) VALUES ($1,$2,'TEST-1','active') RETURNING id", [tribeA, user])).rows[0].id;
  await rejectsConstraint("INSERT INTO tribe_memberships(tribe_id,user_id,member_number) VALUES ($1,$2,'TEST-2')", [tribeA, user], '23505');
  await rejectsConstraint("UPDATE tribe_memberships SET role='superuser' WHERE id=$1", [membership], '23514');
  const eventA = (await client.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at) VALUES ($1,'Test event','Test location',now(),now()+interval '1 hour') RETURNING id", [tribeA])).rows[0].id;
  const eventB = (await client.query("INSERT INTO events(tribe_id,title,location,starts_at,ends_at) VALUES ($1,'Test event B','Test location',now(),now()+interval '1 hour') RETURNING id", [tribeB])).rows[0].id;
  await rejectsConstraint('INSERT INTO event_registrations(event_id,membership_id,tribe_id) VALUES ($1,$2,$3)', [eventB, membership, tribeA], '23503');
  await client.query('INSERT INTO event_registrations(event_id,membership_id,tribe_id) VALUES ($1,$2,$3)', [eventA, membership, tribeA]);
  await rejectsConstraint('INSERT INTO event_registrations(event_id,membership_id,tribe_id) VALUES ($1,$2,$3)', [eventA, membership, tribeA], '23505');
  await client.query("INSERT INTO id_cards(membership_id,tribe_id,verification_token_hash) VALUES ($1,$2,gen_random_uuid()::text)", [membership, tribeA]);
  await rejectsConstraint('INSERT INTO id_cards(membership_id,tribe_id,verification_token_hash) VALUES ($1,$2,gen_random_uuid()::text)', [membership, tribeA], '23505');
  await rejectsConstraint('INSERT INTO profiles(membership_id,tribe_id,display_name) VALUES ($1,$2,$3)', [membership, tribeB, 'Schema test'], '23503');
  console.log('Verified membership uniqueness, role checks, Tribe isolation, registration uniqueness, and single issued card. All test data rolled back.');
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
