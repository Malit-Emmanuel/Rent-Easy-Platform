import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

// Integration test: runs only when DATABASE_URL points at a migrated database.
const url = process.env.DATABASE_URL;
const t = url ? test : test.skip;

// Many events written at the same time from separate connections must still form one chain
// in id order: each event's prev_hash is the hash of the event with the next-lower id.
t('audit chain stays in id order under concurrent writes', async () => {
  const pool = new Pool({ connectionString: url, max: 20 });
  const run = randomUUID();
  try {
    await Promise.all(Array.from({ length: 40 }, (_, i) => pool.query(
      `INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata)
       VALUES (NULL, 'test.concurrent_write', 'test', $1, $2)`, [run, JSON.stringify({ i })])));

    const broken = await pool.query(`
      WITH e AS (
        SELECT id, subject_id, prev_hash, lag(hash) OVER (ORDER BY id) AS before
        FROM governance.audit_events)
      SELECT count(*)::int AS n FROM e
      WHERE subject_id = $1 AND prev_hash IS DISTINCT FROM before`, [run]);
    assert.equal(broken.rows[0].n, 0, 'every concurrent event links to the event just before it');
  } finally {
    await pool.end();
  }
});
