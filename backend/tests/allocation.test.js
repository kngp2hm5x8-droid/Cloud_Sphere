import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { appPool, adminPool, closePools, resetDatabase, allocate, complete, stop, one, reconcile, hasCode } from './helpers/db.js';
import { createFixture, hostRow, vmRow, quotaRow, orgQuotaRow } from './helpers/fixture.js';

let fx;
beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});
after(closePools);

const alice = (o) => ({ user: fx.alice, project: fx.acmeProj, ...o });
const noDrift = async () => assert.deepEqual(await reconcile(), []);

describe('allocate_resource: success path', () => {
  test('creates a PROVISIONING VM, reserves host and quota, adds a root volume and a log entry', async () => {
    const vmId = await allocate(appPool, alice({ name: 'web-1', vcpu: 2, ram: 4, storage: 50, region: fx.ap }));

    const vm = await vmRow(vmId);
    assert.equal(vm.state, 'PROVISIONING');
    assert.equal(vm.host_id, fx.apHost);
    assert.equal(vm.created_by, fx.alice);
    assert.equal(vm.name, 'web-1');

    const host = await hostRow(fx.apHost);
    assert.equal(host.allocated_cpu, 2);
    assert.equal(host.allocated_ram_gb, 4);

    const quota = await quotaRow(fx.acmeProj);
    assert.deepEqual([quota.used_vcpu, quota.used_ram_gb, quota.used_vms, quota.used_storage_gb], [2, 4, 1, 50]);

    const volume = await one('SELECT * FROM storage_volume WHERE vm_id = $1', [vmId]);
    assert.equal(volume.name, 'web-1-root');
    assert.equal(volume.is_root, true);
    assert.equal(volume.state, 'ATTACHED');
    assert.equal(volume.size_gb, 50);
    assert.equal(volume.region_id, fx.ap);

    const log = await one('SELECT * FROM resource_allocation_log WHERE vm_id = $1', [vmId]);
    assert.equal(log.action, 'ALLOCATE');
    assert.equal(log.vcpu_delta, 2);
    assert.equal(log.ram_gb_delta, 4);
    assert.equal(log.performed_by, fx.alice);
    await noDrift();
  });

  test('reuses a shared vm_configuration and classifies the OS family', async () => {
    await allocate(appPool, alice({ name: 'a', os: 'ubuntu-22.04' }));
    await allocate(appPool, alice({ name: 'b', os: 'ubuntu-22.04' }));
    await allocate(appPool, alice({ name: 'c', os: 'Windows-Server-2022' }));
    const rows = (await adminPool.query('SELECT os_family, os_image FROM vm_configuration ORDER BY vm_configuration_id')).rows;
    assert.deepEqual(rows, [
      { os_family: 'LINUX', os_image: 'ubuntu-22.04' },
      { os_family: 'WINDOWS', os_image: 'Windows-Server-2022' },
    ]);
  });

  test('the same VM name can be reused after the first VM is terminated, but not while it is active', async () => {
    const first = await allocate(appPool, alice({ name: 'dup' }));
    await assert.rejects(allocate(appPool, alice({ name: 'dup' })), hasCode('23505'));
    await appPool.query('CALL terminate_vm($1::bigint,$2::bigint)', [fx.alice, first]);
    await allocate(appPool, alice({ name: 'dup' }));
    await noDrift();
  });
});

describe('allocate_resource: placement (A1)', () => {
  test('with no region it picks the lowest-carbon region', async () => {
    const vmId = await allocate(appPool, alice({ name: 'green', vcpu: 2 }));
    assert.equal((await vmRow(vmId)).host_id, fx.euHost);
  });

  test('an explicit region wins over carbon', async () => {
    const vmId = await allocate(appPool, alice({ name: 'mumbai', region: fx.ap }));
    assert.equal((await vmRow(vmId)).host_id, fx.apHost);
  });

  test('carbon never overrides capacity: a request too big for the green host goes to the next region', async () => {
    const vmId = await allocate(appPool, alice({ name: 'big', vcpu: 10, ram: 20 }));
    assert.equal((await vmRow(vmId)).host_id, fx.apHost);
  });

  test('non-ACTIVE hosts are never chosen', async () => {
    await adminPool.query(`UPDATE cloud_host SET status = 'MAINTENANCE' WHERE host_id = $1`, [fx.apHost]);
    await adminPool.query(`UPDATE cloud_host SET status = 'DRAINING' WHERE host_id = $1`, [fx.euHost]);
    await assert.rejects(allocate(appPool, alice({ name: 'x', region: fx.ap })), hasCode('CS001'));
    await assert.rejects(allocate(appPool, alice({ name: 'y', region: fx.eu })), hasCode('CS001'));
    await assert.rejects(allocate(appPool, alice({ name: 'z' })), hasCode('CS001'));

    await adminPool.query(`UPDATE cloud_host SET status = 'ACTIVE' WHERE host_id = $1`, [fx.apHost]);
    const vmId = await allocate(appPool, alice({ name: 'z' }));
    assert.equal((await vmRow(vmId)).host_id, fx.apHost);   // the only ACTIVE host, even though eu is greener
  });
});

describe('allocate_resource: rejections leave no trace', () => {
  async function snapshot() {
    return {
      host: (await adminPool.query('SELECT host_id, allocated_cpu, allocated_ram_gb FROM cloud_host ORDER BY 1')).rows,
      quota: (await adminPool.query('SELECT quota_id, used_vcpu, used_ram_gb, used_vms, used_storage_gb FROM resource_quota ORDER BY 1')).rows,
      vms: (await one('SELECT count(*)::int AS n FROM virtual_machine')).n,
      volumes: (await one('SELECT count(*)::int AS n FROM storage_volume')).n,
      logs: (await one('SELECT count(*)::int AS n FROM resource_allocation_log')).n,
    };
  }

  test('insufficient capacity (CS001)', async () => {
    // Quota is checked before capacity, so give the project enough quota that capacity is what fails.
    await adminPool.query('UPDATE resource_quota SET max_vcpu = 1000, max_ram_gb = 10000 WHERE project_id = $1', [fx.acmeProj]);
    const before = await snapshot();
    await assert.rejects(allocate(appPool, alice({ name: 'huge', vcpu: 128, ram: 512, region: fx.ap })), hasCode('CS001'));
    await assert.rejects(allocate(appPool, alice({ name: 'too-big-for-region', vcpu: 20, ram: 8, region: fx.ap })), hasCode('CS001'));
    assert.deepEqual(await snapshot(), before);
  });

  test('a failure after the counters were updated rolls everything back (23505 on the root volume name)', async () => {
    // A leftover non-root volume called "x-root" makes the root-volume INSERT fail, which happens after the
    // host and quota counters have already been incremented inside the same CALL.
    await adminPool.query(
      `INSERT INTO storage_volume (project_id, region_id, name, size_gb, volume_type, is_root, state)
       VALUES ($1, $2, 'x-root', 1, 'SSD', false, 'AVAILABLE')`, [fx.acmeProj, fx.ap]);
    const before = await snapshot();
    const configsBefore = (await one('SELECT count(*)::int AS n FROM vm_configuration')).n;

    await assert.rejects(allocate(appPool, alice({ name: 'x', vcpu: 3, ram: 5, region: fx.ap })), hasCode('23505'));

    assert.deepEqual(await snapshot(), before);
    assert.equal((await one('SELECT count(*)::int AS n FROM vm_configuration')).n, configsBefore);
    await noDrift();
  });

  test('invalid requests (CS003)', async () => {
    const bad = [
      { name: 'v0', vcpu: 0 }, { name: 'r0', ram: 0 }, { name: 's0', storage: 0 },
      { name: 'vt', volume: 'NVME' }, { name: '   ' }, { name: 'reg', region: 999999 },
      { name: 'cap', hourlyCap: -1 }, { name: 'vbig', vcpu: 100000 },
    ];
    for (const o of bad) {
      await assert.rejects(allocate(appPool, alice(o)), hasCode('CS003'), JSON.stringify(o));
    }
    await noDrift();
  });

  test('inactive user, suspended organization and archived project are refused (CS003)', async () => {
    await adminPool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [fx.alice]);
    await assert.rejects(allocate(appPool, alice({ name: 'u' })), hasCode('CS003'));
    await adminPool.query('UPDATE app_user SET is_active = true WHERE user_id = $1', [fx.alice]);

    await adminPool.query(`UPDATE organization SET status = 'SUSPENDED' WHERE organization_id = $1`, [fx.acme]);
    await assert.rejects(allocate(appPool, alice({ name: 'o' })), hasCode('CS003'));
    await adminPool.query(`UPDATE organization SET status = 'ACTIVE' WHERE organization_id = $1`, [fx.acme]);

    await adminPool.query(`UPDATE project SET status = 'ARCHIVED' WHERE project_id = $1`, [fx.acmeProj]);
    await assert.rejects(allocate(appPool, alice({ name: 'p' })), hasCode('CS003'));
  });

  test('a customer cannot allocate in another organization’s project (CS006), an admin can', async () => {
    await assert.rejects(allocate(appPool, { user: fx.bob, project: fx.acmeProj, name: 'sneaky' }), hasCode('CS006'));
    await assert.rejects(allocate(appPool, { user: fx.alice, project: 999999, name: 'ghost' }), hasCode('CS006'));
    const vmId = await allocate(appPool, { user: fx.admin, project: fx.acmeProj, name: 'by-admin' });
    assert.equal((await vmRow(vmId)).created_by, fx.admin);
  });
});

describe('allocate_resource: quotas (CS002)', () => {
  const small = (o) => ({ user: fx.alice, project: fx.acmeSmall, ...o });

  test('vCPU, RAM, VM-count and storage limits', async () => {
    await allocate(appPool, small({ name: 's1', vcpu: 3, ram: 6, storage: 60 }));
    await assert.rejects(allocate(appPool, small({ name: 's2', vcpu: 2, ram: 1, storage: 1 })), /vCPU quota exceeded/);
    await assert.rejects(allocate(appPool, small({ name: 's3', vcpu: 1, ram: 3, storage: 1 })), /RAM quota exceeded/);
    await assert.rejects(allocate(appPool, small({ name: 's4', vcpu: 1, ram: 1, storage: 50 })), /Storage quota exceeded/);
    await allocate(appPool, small({ name: 's5', vcpu: 1, ram: 1, storage: 10 }));   // exactly at the vCPU limit now
    await assert.rejects(allocate(appPool, small({ name: 's6', vcpu: 1, ram: 1, storage: 1 })), hasCode('CS002'));
    await noDrift();
  });

  test('VM-count limit', async () => {
    await adminPool.query('UPDATE resource_quota SET max_vms = 1 WHERE project_id = $1', [fx.acmeProj]);
    await allocate(appPool, alice({ name: 'only-one' }));
    await assert.rejects(allocate(appPool, alice({ name: 'two' })), /VM count quota exceeded/);
    await noDrift();
  });

  test('a project with no quota row is denied (A8)', async () => {
    await adminPool.query('DELETE FROM resource_quota WHERE project_id = $1', [fx.acmeProj]);
    await assert.rejects(allocate(appPool, alice({ name: 'noquota' })), hasCode('CS002'));
  });

  test('an organization-level quota is enforced and its counters are maintained', async () => {
    await adminPool.query(
      `INSERT INTO resource_quota (organization_id, max_vcpu, max_ram_gb, max_vms, max_storage_gb) VALUES ($1, 3, 100, 10, NULL)`, [fx.acme]);
    await assert.rejects(allocate(appPool, alice({ name: 'org-big', vcpu: 4 })), /organization/);
    await allocate(appPool, alice({ name: 'org-ok', vcpu: 2, storage: 30 }));
    const org = await orgQuotaRow(fx.acme);
    assert.deepEqual([org.used_vcpu, org.used_ram_gb, org.used_vms, org.used_storage_gb], [2, 4, 1, 30]);
    await noDrift();
  });
});

describe('allocate_resource: budgets (CS005, A2)', () => {
  const budgeted = (o) => ({ user: fx.alice, project: fx.acmeBudget, ...o });

  test('estimate_vm_cost matches the arithmetic (0.10/h, 73.00 + 2.00 per month)', async () => {
    const e = await one('SELECT * FROM estimate_vm_cost($1, 2, 4, 20)', [fx.acmeBudget], appPool);
    assert.equal(Number(e.hourly_compute_cost), 0.1);
    assert.equal(e.monthly_compute_cost, '73.00');
    assert.equal(e.monthly_storage_cost, '2.00');
    assert.equal(e.monthly_total_cost, '75.00');
    assert.equal(e.projected_monthly_before, '0.00');
    assert.equal(e.projected_monthly_after, '75.00');
    assert.equal(e.within_monthly_budget, true);
  });

  test('the monthly budget is enforced on the projection including existing VMs', async () => {
    await allocate(appPool, budgeted({ name: 'b1' }));                        // 75.00 of 100.00
    await assert.rejects(allocate(appPool, budgeted({ name: 'b2' })), hasCode('CS005'));   // would be 150.00
    const e = await one('SELECT * FROM estimate_vm_cost($1, 2, 4, 20)', [fx.acmeBudget], appPool);
    assert.equal(e.projected_monthly_before, '75.00');
    assert.equal(e.within_monthly_budget, false);
  });

  test('a STOPPED VM counts storage only toward the projection (A12)', async () => {
    const vmId = await allocate(appPool, budgeted({ name: 'b1' }));
    await complete(appPool, vmId);
    await stop(appPool, fx.alice, vmId);
    assert.equal((await one('SELECT project_projected_monthly_cost($1) AS c', [fx.acmeBudget])).c, '2.00');
    await allocate(appPool, budgeted({ name: 'b2' }));                        // 2.00 + 75.00 = 77.00 <= 100.00
  });

  test('the per-request hourly cap is separate from the monthly budget; equality is allowed', async () => {
    await assert.rejects(allocate(appPool, budgeted({ name: 'h1', hourlyCap: 0.05 })), hasCode('CS005'));
    await allocate(appPool, budgeted({ name: 'h2', hourlyCap: 0.1 }));
    await noDrift();
  });

  test('a project without a budget is not budget-limited', async () => {
    await allocate(appPool, alice({ name: 'free-for-all', vcpu: 8, ram: 16 }));
  });
});
