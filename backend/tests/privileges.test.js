// A7: the API role cannot touch capacity/quota counters or VM state directly; only the routines can.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { appPool, adminPool, closePools, resetDatabase, allocate, one, hasCode } from './helpers/db.js';
import { createFixture, hostRow, quotaRow, vmRow } from './helpers/fixture.js';

let fx;
let vmId;
beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
  vmId = await allocate(appPool, { user: fx.alice, project: fx.acmeProj, name: 'a', region: fx.ap });
});
after(closePools);

const denied = (sql, params) => assert.rejects(appPool.query(sql, params), hasCode('42501'), sql);

describe('counters and VM state are protected from the API role', () => {
  test('cloud_host: counters, capacity and deletes are denied; status and threshold are allowed', async () => {
    await denied('UPDATE cloud_host SET allocated_cpu = 0 WHERE host_id = $1', [fx.apHost]);
    await denied('UPDATE cloud_host SET allocated_ram_gb = 0 WHERE host_id = $1', [fx.apHost]);
    await denied('UPDATE cloud_host SET total_cpu = 9999 WHERE host_id = $1', [fx.apHost]);
    await denied('DELETE FROM cloud_host WHERE host_id = $1', [fx.apHost]);
    await denied(`INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb, allocated_cpu)
                  VALUES ($1, 'rogue', 8, 8, 4)`, [fx.ap]);

    await appPool.query(`UPDATE cloud_host SET status = 'DRAINING', low_capacity_threshold_pct = 20 WHERE host_id = $1`, [fx.apHost]);
    await appPool.query(`INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES ($1, 'new-host', 8, 16)`, [fx.ap]);
    const h = await hostRow(fx.apHost);
    assert.deepEqual([h.status, h.allocated_cpu], ['DRAINING', 2]);
  });

  test('resource_quota: usage columns are denied; limits are editable', async () => {
    await denied('UPDATE resource_quota SET used_vcpu = 0 WHERE project_id = $1', [fx.acmeProj]);
    await denied('UPDATE resource_quota SET used_vms = 0 WHERE project_id = $1', [fx.acmeProj]);
    await denied('DELETE FROM resource_quota WHERE project_id = $1', [fx.acmeProj]);
    await denied(`INSERT INTO resource_quota (organization_id, max_vcpu, max_ram_gb, max_vms, used_vcpu)
                  VALUES ($1, 10, 10, 10, 5)`, [fx.acme]);

    await appPool.query('UPDATE resource_quota SET max_vcpu = 40, max_storage_gb = 500 WHERE project_id = $1', [fx.acmeProj]);
    const q = await quotaRow(fx.acmeProj);
    assert.deepEqual([q.max_vcpu, q.max_storage_gb, q.used_vcpu], [40, 500, 2]);
  });

  test('virtual_machine: no insert, delete or state/host changes; renaming is allowed', async () => {
    await denied('UPDATE virtual_machine SET state = $2 WHERE vm_id = $1', [vmId, 'RUNNING']);
    await denied('UPDATE virtual_machine SET host_id = $2 WHERE vm_id = $1', [vmId, fx.euHost]);
    await denied('UPDATE virtual_machine SET project_id = $2 WHERE vm_id = $1', [vmId, fx.globexProj]);
    await denied('DELETE FROM virtual_machine WHERE vm_id = $1', [vmId]);
    await denied(`INSERT INTO virtual_machine (project_id, vm_configuration_id, host_id, name, state)
                  SELECT project_id, vm_configuration_id, host_id, 'forged', 'RUNNING' FROM virtual_machine WHERE vm_id = $1`, [vmId]);

    await appPool.query(`UPDATE virtual_machine SET name = 'renamed' WHERE vm_id = $1`, [vmId]);
    assert.equal((await vmRow(vmId)).name, 'renamed');
  });

  test('audit_log is append-only for the API role; schema_migrations is invisible', async () => {
    await denied(`UPDATE audit_log SET action = 'x'`);
    await denied('DELETE FROM audit_log');
    await denied('SELECT * FROM schema_migrations');
    await appPool.query(`INSERT INTO audit_log (action, entity_type) VALUES ('test', 'test')`);
    assert.ok((await appPool.query('SELECT * FROM audit_log')).rowCount >= 1);
  });
});

describe('routine execution rights', () => {
  test('internal helpers and destructive maintenance are not executable by the API role', async () => {
    await denied('SELECT release_active_vm($1, $2, NULL, $3)', [vmId, 'TERMINATED', 'DEALLOCATE']);
    await denied('SELECT assert_project_access($1, $2)', [fx.alice, fx.acmeProj]);
    await denied('SELECT drop_expired_monitoring_partitions(1)');
  });

  test('the lifecycle procedures and pricing functions are executable', async () => {
    await appPool.query('CALL complete_provisioning($1::bigint)', [vmId]);
    await appPool.query('CALL stop_vm($1::bigint, $2::bigint)', [fx.alice, vmId]);
    const e = await one('SELECT * FROM estimate_vm_cost($1, 1, 1, 1)', [fx.acmeProj], appPool);
    assert.ok(e.monthly_total_cost);
  });

  test('login support still works: pgcrypto crypt() is callable by the API role', async () => {
    const ok = await one(
      `SELECT (password_hash = crypt($2, password_hash)) AS ok FROM app_user WHERE lower(email) = lower($1)`,
      ['ALICE@acme.test', 'Demo@12345'], appPool);
    assert.equal(ok.ok, true);
    const bad = await one(
      `SELECT (password_hash = crypt($2, password_hash)) AS ok FROM app_user WHERE email = $1`,
      ['alice@acme.test', 'wrong'], appPool);
    assert.equal(bad.ok, false);
  });

  test('triggers still fire for the API role without EXECUTE on trigger functions', async () => {
    await appPool.query(`UPDATE project SET description = 'edited' WHERE project_id = $1`, [fx.acmeProj]);
    const p = await one('SELECT description, updated_at > created_at AS touched FROM project WHERE project_id = $1', [fx.acmeProj]);
    assert.deepEqual([p.description, p.touched], ['edited', true]);

    const created = await one(
      `INSERT INTO project (organization_id, name) VALUES ($1, 'fresh') RETURNING project_id`, [fx.acme], appPool);
    const q = await quotaRow(created.project_id);
    assert.deepEqual([q.max_vcpu, q.max_ram_gb, q.max_vms], [32, 128, 10]);        // plan defaults via the trigger
  });
});

test('routines run as the schema owner, not the caller', async () => {
  const { rows } = await adminPool.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
       FROM pg_proc p WHERE p.proname IN ('allocate_resource','stop_vm','start_vm','terminate_vm','complete_provisioning',
                                          'fail_provisioning','preempt_vm') ORDER BY 1`);
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.equal(r.owner, 'cloudsphere_migrator', r.proname);
    assert.equal(r.prosecdef, true, `${r.proname} must be SECURITY DEFINER`);
  }
});
