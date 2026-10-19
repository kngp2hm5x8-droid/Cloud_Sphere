// Shared database helpers for the test suite.
//
// SAFETY: the suite EMPTIES the database it connects to, so it only runs against a database whose name ends in
// "_test" (see database/scripts/01_bootstrap_test_db.sql). Your development database is never touched.

import 'dotenv/config';
import pg from 'pg';

const APP_URL = process.env.TEST_DATABASE_URL;
const MIGRATOR_URL = process.env.TEST_MIGRATOR_DATABASE_URL;

function assertTestDatabase(url, variable) {
  if (!url) {
    throw new Error(`${variable} is not set. See backend/.env.example and database/scripts/01_bootstrap_test_db.sql.`);
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run: ${variable} points at database "${name}", which does not end in "_test".`);
  }
}
assertTestDatabase(APP_URL, 'TEST_DATABASE_URL');
assertTestDatabase(MIGRATOR_URL, 'TEST_MIGRATOR_DATABASE_URL');

/** Connects as the API role (cloudsphere_app): what the Express server will use. */
export const appPool = new pg.Pool({ connectionString: APP_URL, max: 25 });
/** Connects as the schema owner (cloudsphere_migrator): fixtures, assertions, privileged setup. */
export const adminPool = new pg.Pool({ connectionString: MIGRATOR_URL, max: 5 });

export async function closePools() {
  await Promise.all([appPool.end(), adminPool.end()]);
}

/** Empties every application table (not schema_migrations) and restarts identities. */
export async function resetDatabase() {
  const { rows } = await adminPool.query(`
    SELECT quote_ident(c.relname) AS name
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
       AND NOT c.relispartition AND c.relname <> 'schema_migrations'`);
  await adminPool.query(`TRUNCATE ${rows.map((r) => r.name).join(', ')} RESTART IDENTITY CASCADE`);

  // Restore the baseline partition set (current month -2 .. +3) so tests that create or drop partitions cannot affect each other.
  const parts = await adminPool.query(
    `SELECT quote_ident(c.relname) AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'monitoring_log'::regclass`);
  for (const p of parts.rows) await adminPool.query(`DROP TABLE ${p.name}`);
  await adminPool.query('SELECT ensure_monitoring_partitions(2, 3)');
}

const q = (sql, params) => adminPool.query(sql, params);

export async function one(sql, params, pool = adminPool) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

/** CALL allocate_resource(...) and return the new VM id (a string, as node-postgres returns BIGINT). */
export async function allocate(pool, o) {
  const { rows } = await pool.query(
    `CALL allocate_resource($1::bigint,$2::bigint,$3::text,$4::int,$5::int,$6::int,$7::text,$8::text,$9::bigint,$10::numeric,$11::bigint)`,
    [o.user, o.project, o.name, o.vcpu ?? 2, o.ram ?? 4, o.storage ?? 20, o.os ?? 'ubuntu-22.04',
     o.volume ?? 'SSD', o.region ?? null, o.hourlyCap ?? null, null],
  );
  return rows[0].p_vm_id;
}

/** Same as allocate, but retries on deadlock/serialization failure like the Express layer is meant to. */
export async function allocateWithRetry(pool, o, stats = { retries: 0 }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await allocate(pool, o);
    } catch (err) {
      if ((err.code === '40P01' || err.code === '40001') && attempt < 5) {
        stats.retries++;
        continue;
      }
      throw err;
    }
  }
}

export const call = (pool, sql, params) => pool.query(sql, params);
export const complete = (pool, vmId) => pool.query('CALL complete_provisioning($1::bigint)', [vmId]);
export const stop = (pool, user, vmId) => pool.query('CALL stop_vm($1::bigint,$2::bigint)', [user, vmId]);
export const start = (pool, user, vmId) => pool.query('CALL start_vm($1::bigint,$2::bigint)', [user, vmId]);
export const terminate = (pool, user, vmId) => pool.query('CALL terminate_vm($1::bigint,$2::bigint)', [user, vmId]);

/**
 * The reconciliation query from the design: every counter must equal what the active VMs and root volumes imply.
 * Returns the offending rows; an empty array means everything reconciles.
 */
export async function reconcile() {
  const hosts = await q(`
    SELECT h.host_id, h.allocated_cpu, h.allocated_ram_gb,
           COALESCE(s.cpu, 0) AS expected_cpu, COALESCE(s.ram, 0) AS expected_ram
      FROM cloud_host h
      LEFT JOIN (SELECT vm.host_id, SUM(c.vcpu) cpu, SUM(c.ram_gb) ram
                   FROM virtual_machine vm JOIN vm_configuration c USING (vm_configuration_id)
                  WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED') GROUP BY vm.host_id) s USING (host_id)
     WHERE h.allocated_cpu <> COALESCE(s.cpu, 0) OR h.allocated_ram_gb <> COALESCE(s.ram, 0)`);

  const usage = `
    SELECT p.project_id, p.organization_id,
           COALESCE(SUM(c.vcpu)  FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')), 0) AS cpu,
           COALESCE(SUM(c.ram_gb) FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')), 0) AS ram,
           COUNT(vm.vm_id) FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')) AS vms,
           COALESCE((SELECT SUM(v.size_gb) FROM storage_volume v
                      WHERE v.project_id = p.project_id AND v.is_root AND v.state <> 'DELETED'), 0) AS storage
      FROM project p
      LEFT JOIN virtual_machine vm ON vm.project_id = p.project_id
      LEFT JOIN vm_configuration c ON c.vm_configuration_id = vm.vm_configuration_id
     GROUP BY p.project_id, p.organization_id`;

  const projectQuotas = await q(`
    SELECT q.project_id, q.used_vcpu, q.used_ram_gb, q.used_vms, q.used_storage_gb, u.cpu, u.ram, u.vms, u.storage
      FROM resource_quota q JOIN (${usage}) u ON u.project_id = q.project_id
     WHERE q.used_vcpu <> u.cpu OR q.used_ram_gb <> u.ram OR q.used_vms <> u.vms OR q.used_storage_gb <> u.storage`);

  const orgQuotas = await q(`
    SELECT q.organization_id, q.used_vcpu, q.used_ram_gb, q.used_vms, q.used_storage_gb,
           SUM(u.cpu) cpu, SUM(u.ram) ram, SUM(u.vms) vms, SUM(u.storage) storage
      FROM resource_quota q JOIN (${usage}) u ON u.organization_id = q.organization_id
     WHERE q.project_id IS NULL
     GROUP BY q.quota_id, q.organization_id, q.used_vcpu, q.used_ram_gb, q.used_vms, q.used_storage_gb
    HAVING q.used_vcpu <> SUM(u.cpu) OR q.used_ram_gb <> SUM(u.ram) OR q.used_vms <> SUM(u.vms)
        OR q.used_storage_gb <> SUM(u.storage)`);

  return [...hosts.rows, ...projectQuotas.rows, ...orgQuotas.rows];
}

/** Asserts a pg error carries the given SQLSTATE; use with assert.rejects. */
export const hasCode = (code) => (err) => {
  if (err.code !== code) {
    throw new Error(`expected SQLSTATE ${code} but got ${err.code}: ${err.message}`);
  }
  return true;
};
