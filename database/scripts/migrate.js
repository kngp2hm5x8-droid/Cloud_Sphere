// Lightweight migration runner (D14).
//
// Applies database/migrations/*.sql in filename order, one transaction per file, and records each applied
// file (with a SHA-256 checksum) in schema_migrations. It never drops anything and never edits an applied file:
// if an already-applied file has changed on disk the run stops with an error.
//
// Usage (from backend/):  npm run migrate         -> uses MIGRATOR_DATABASE_URL
//                         npm run migrate:test    -> uses TEST_MIGRATOR_DATABASE_URL (the throwaway *_test database)
// The URL is read from the environment or backend/.env and must use the schema-owning role.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Reuse the backend's installed dependencies instead of adding a second package.json.
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const pg = require('pg');
try {
  require('dotenv').config({ path: fileURLToPath(new URL('../../backend/.env', import.meta.url)), quiet: true });
} catch {
  // dotenv is optional here; real environment variables still work
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 726_001; // arbitrary constant; stops two runners migrating at once

export async function migrate({ connectionString, log = console.log } = {}) {
  const useTest = process.argv.includes('--test');
  const variable = useTest ? 'TEST_MIGRATOR_DATABASE_URL' : 'MIGRATOR_DATABASE_URL';
  connectionString ??= process.env[variable];
  if (!connectionString) {
    throw new Error(`${variable} is not set (see backend/.env.example).`);
  }

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => FILE_PATTERN.test(f)).sort();
  const client = new pg.Client({ connectionString });
  await client.connect();

  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT        NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      if (done.has(file)) {
        if (done.get(file) !== checksum) {
          throw new Error(
            `${file} was already applied but has changed on disk. Never edit an applied migration; add a new numbered file instead.`,
          );
        }
        log(`skip   ${file}`);
        continue;
      }

      log(`apply  ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `${file}: ${err.message}`;
        throw err;
      }
      applied.push(file);
    }
    log(applied.length ? `done: applied ${applied.length} migration(s)` : 'done: database already up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().catch((err) => {
    console.error(`migration failed: ${err.message}`);
    process.exit(1);
  });
}
