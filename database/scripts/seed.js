// Applies database/seeds/*.sql in filename order using the schema-owning role (MIGRATOR_DATABASE_URL).
// Seeds are idempotent on their own (001_demo.sql does nothing if Acme Robotics already exists) and are not recorded
// in schema_migrations. DEVELOPMENT DATA ONLY: all demo accounts share the password Demo@12345.
//
// Usage (from backend/):  npm run seed

import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const pg = require('pg');
try {
  require('dotenv').config({ path: fileURLToPath(new URL('../../backend/.env', import.meta.url)), quiet: true });
} catch {
  // dotenv is optional here; real environment variables still work
}

const SEEDS_DIR = fileURLToPath(new URL('../seeds/', import.meta.url));

export async function seed({ connectionString = process.env.MIGRATOR_DATABASE_URL, log = console.log } = {}) {
  if (!connectionString) throw new Error('MIGRATOR_DATABASE_URL is not set (see backend/.env.example).');
  const files = (await readdir(SEEDS_DIR)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const client = new pg.Client({ connectionString });
  client.on('notice', (n) => log(`  ${n.message}`));
  await client.connect();
  try {
    for (const file of files) {
      log(`seed   ${file}`);
      await client.query(await readFile(path.join(SEEDS_DIR, file), 'utf8'));
    }
    log('done');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().catch((err) => {
    console.error(`seed failed: ${err.message}`);
    process.exit(1);
  });
}
