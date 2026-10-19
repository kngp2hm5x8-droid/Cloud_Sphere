import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  appPool, adminPool, closePools, resetDatabase, allocate, complete, stop, start, terminate, one, reconcile, hasCode,
} from './helpers/db.js';
import { createFixture, hostRow, vmRow, quotaRow } from './helpers/fixture.js';

let fx;
beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});
after(closePools);

const mk = async (name, o = {}) => allocate(appPool, { user: fx.alice, project: fx.acmeProj, name, region: fx.ap, ...o });
const running = async (name, o) => {
  const id = await mk(name, o);
  await complete(appPool, id);
  return id;
};
const noDrift = async () => assert.deepEqual(await reconcile(), []);
const counters = async () => {
  const h = await hostRow(fx.apHost);
  const q = await quotaRow(fx.acmeProj);
  return [h.allocated_cpu, h.allocated_ram_gb, q.used_vcpu, q.used_ram_gb, q.used_vms, q.used_storage_gb];
};

describe('complete_provisioning', () => {
  test('PROVISIONING -> RUNNING once; a second call is an invalid transition (CS004)', async () => {
    const id = await mk('a');
    await complete(appPool, id);
    const vm = await vmRow(id);
    assert.equal(vm.state, 'RUNNING');
    assert.ok(vm.started_at);
    await assert.rejects(complete(appPool, id), hasCode('CS004'));
    await assert.rejects(complete(appPool, 999999), hasCode('CS006'));
  });

  test('the state change is audited with a system actor (NULL)', async () => {
    const id = await mk('a');
    await complete(appPool, id);
    const row = await one(`SELECT * FROM audit_log WHERE entity_type = 'virtual_machine' AND entity_id = $1`, [id]);
    assert.equal(row.action, 'vm.state_change');
    assert.equal(row.actor_user_id, null);
    assert.deepEqual(row.old_values, { state: 'PROVISIONING' });
    assert.equal(row.new_values.state, 'RUNNING');
  });
});

describe('stop / start (D2: a stopped VM keeps its reservation)', () => {
  test('stop and start change no host or quota counter, and the VM keeps its host', async () => {
    const id = await running('a', { vcpu: 2, ram: 4, storage: 30 });
    const before = await counters();
    const hostBefore = (await vmRow(id)).host_id;

    await stop(appPool, fx.alice, id);
    let vm = await vmRow(id);
    assert.equal(vm.state, 'STOPPED');
    assert.ok(vm.stopped_at);
    assert.equal(vm.host_id, hostBefore);
    assert.deepEqual(await counters(), before);

    await start(appPool, fx.alice, id);
    vm = await vmRow(id);
    assert.equal(vm.state, 'RUNNING');
    assert.equal(vm.stopped_at, null);
    assert.deepEqual(await counters(), before);
    await noDrift();
  });

  test('invalid transitions are refused (CS004)', async () => {
    const id = await mk('a');                                       // PROVISIONING
    await assert.rejects(stop(appPool, fx.alice, id), hasCode('CS004'));
    await assert.rejects(start(appPool, fx.alice, id), hasCode('CS004'));
    await complete(appPool, id);
    await assert.rejects(start(appPool, fx.alice, id), hasCode('CS004'));   // already RUNNING
    await stop(appPool, fx.alice, id);
    await assert.rejects(stop(appPool, fx.alice, id), hasCode('CS004'));    // already STOPPED
  });

  test('start fails (CS001) if the retained host is in MAINTENANCE; DRAINING still allows it', async () => {
    const id = await running('a');
    await stop(appPool, fx.alice, id);

    await adminPool.query(`UPDATE cloud_host SET status = 'MAINTENANCE' WHERE host_id = $1`, [fx.apHost]);
    await assert.rejects(start(appPool, fx.alice, id), hasCode('CS001'));
    assert.equal((await vmRow(id)).state, 'STOPPED');

    await adminPool.query(`UPDATE cloud_host SET status = 'DRAINING' WHERE host_id = $1`, [fx.apHost]);
    await start(appPool, fx.alice, id);
    assert.equal((await vmRow(id)).state, 'RUNNING');
  });

  test('changing a host status as the API role does not touch allocation counters', async () => {
    await running('a');
    const before = await counters();
    await appPool.query(`UPDATE cloud_host SET status = 'DRAINING' WHERE host_id = $1`, [fx.apHost]);
    await appPool.query(`UPDATE cloud_host SET status = 'MAINTENANCE' WHERE host_id = $1`, [fx.apHost]);
    assert.deepEqual(await counters(), before);
    await noDrift();
  });

  test('another organization’s user cannot stop or start the VM (CS006); the audit actor is the caller', async () => {
    const id = await running('a');
    await assert.rejects(stop(appPool, fx.bob, id), hasCode('CS006'));
    await stop(appPool, fx.alice, id);
    const row = await one(
      `SELECT actor_user_id FROM audit_log WHERE entity_id = $1 AND new_values->>'state' = 'STOPPED'`, [id]);
    assert.equal(row.actor_user_id, fx.alice);
  });
});

describe('terminate / fail / preempt release a reservation exactly once', () => {
  test('terminating a RUNNING VM releases host, quota and the root volume', async () => {
    const id = await running('a', { vcpu: 3, ram: 6, storage: 40 });
    await terminate(appPool, fx.alice, id);

    assert.deepEqual(await counters(), [0, 0, 0, 0, 0, 0]);
    const vm = await vmRow(id);
    assert.equal(vm.state, 'TERMINATED');
    assert.ok(vm.terminated_at);
    const vol = await one('SELECT * FROM storage_volume WHERE name = $1', ['a-root']);
    assert.equal(vol.state, 'DELETED');
    assert.equal(vol.vm_id, null);
    const log = await one(`SELECT * FROM resource_allocation_log WHERE vm_id = $1 AND action = 'DEALLOCATE'`, [id]);
    assert.equal(log.vcpu_delta, -3);
    assert.equal(log.ram_gb_delta, -6);
    await noDrift();
  });

  test('terminating a STOPPED VM releases the reservation it kept (D2)', async () => {
    const id = await running('a', { vcpu: 2, ram: 4 });
    await stop(appPool, fx.alice, id);
    assert.deepEqual((await counters()).slice(0, 2), [2, 4]);          // still reserved while stopped
    await terminate(appPool, fx.alice, id);
    assert.deepEqual(await counters(), [0, 0, 0, 0, 0, 0]);
  });

  test('a second terminate is refused (CS004) and releases nothing more', async () => {
    const keep = await running('keep', { vcpu: 2, ram: 4, storage: 10 });
    const id = await running('gone', { vcpu: 3, ram: 6, storage: 20 });
    await terminate(appPool, fx.alice, id);
    const after1 = await counters();
    await assert.rejects(terminate(appPool, fx.alice, id), hasCode('CS004'));
    assert.deepEqual(await counters(), after1);
    assert.deepEqual(after1, [2, 4, 2, 4, 1, 10]);
    assert.equal((await vmRow(keep)).state, 'RUNNING');
    await noDrift();
  });

  test('data volumes are detached and kept; load balancer link is cleared', async () => {
    const id = await running('a');
    const net = (await one(
      `INSERT INTO virtual_network (project_id, region_id, name, cidr_block) VALUES ($1,$2,'vpc','10.0.0.0/16') RETURNING virtual_network_id`,
      [fx.acmeProj, fx.ap])).virtual_network_id;
    const lb = (await one(
      `INSERT INTO load_balancer (project_id, virtual_network_id, name) VALUES ($1,$2,'lb') RETURNING load_balancer_id`,
      [fx.acmeProj, net])).load_balancer_id;
    await adminPool.query('UPDATE virtual_machine SET load_balancer_id = $2 WHERE vm_id = $1', [id, lb]);
    await adminPool.query(
      `INSERT INTO storage_volume (project_id, region_id, vm_id, name, size_gb, volume_type, state)
       VALUES ($1,$2,$3,'data-1',100,'HDD','ATTACHED')`, [fx.acmeProj, fx.ap, id]);

    await terminate(appPool, fx.alice, id);

    const data = await one(`SELECT state, vm_id FROM storage_volume WHERE name = 'data-1'`);
    assert.deepEqual(data, { state: 'AVAILABLE', vm_id: null });
    assert.equal((await vmRow(id)).load_balancer_id, null);
  });

  test('fail_provisioning: only from PROVISIONING, releases the reservation', async () => {
    const id = await mk('a', { vcpu: 2, ram: 4 });
    await appPool.query('CALL fail_provisioning($1::bigint)', [id]);
    assert.equal((await vmRow(id)).state, 'FAILED');
    assert.deepEqual(await counters(), [0, 0, 0, 0, 0, 0]);
    const log = await one(`SELECT action FROM resource_allocation_log WHERE vm_id = $1 ORDER BY allocation_log_id DESC LIMIT 1`, [id]);
    assert.equal(log.action, 'PROVISION_FAILED');
    await assert.rejects(appPool.query('CALL fail_provisioning($1::bigint)', [id]), hasCode('CS004'));

    const live = await running('b');
    await assert.rejects(appPool.query('CALL fail_provisioning($1::bigint)', [live]), hasCode('CS004'));
    await noDrift();
  });

  test('preempt_vm: only a RUNNING spot VM', async () => {
    const normal = await running('normal');
    await assert.rejects(appPool.query('CALL preempt_vm($1::bigint)', [normal]), hasCode('CS004'));

    const spot = await running('spot', { vcpu: 1, ram: 1, storage: 5 });
    await adminPool.query('UPDATE virtual_machine SET is_spot = true WHERE vm_id = $1', [spot]);
    const before = await counters();
    await appPool.query('CALL preempt_vm($1::bigint)', [spot]);
    assert.equal((await vmRow(spot)).state, 'PREEMPTED');
    assert.deepEqual(await counters(), [before[0] - 1, before[1] - 1, before[2] - 1, before[3] - 1, before[4] - 1, before[5] - 5]);
    await assert.rejects(appPool.query('CALL preempt_vm($1::bigint)', [spot]), hasCode('CS004'));
    await noDrift();
  });

  test('an admin can terminate a customer’s VM; another customer cannot', async () => {
    const id = await running('a');
    await assert.rejects(terminate(appPool, fx.bob, id), hasCode('CS006'));
    await terminate(appPool, fx.admin, id);
    assert.equal((await vmRow(id)).state, 'TERMINATED');
  });

  test('the database itself refuses an invalid transition even if a routine is bypassed (CS004)', async () => {
    const id = await mk('a');
    await assert.rejects(adminPool.query(`UPDATE virtual_machine SET state = 'STOPPED' WHERE vm_id = $1`, [id]), hasCode('CS004'));
  });
});

describe('host low-capacity notification', () => {
  test('notifies each active admin once per day, not on every allocation', async () => {
    await adminPool.query(`UPDATE cloud_host SET low_capacity_threshold_pct = 50 WHERE host_id = $1`, [fx.euHost]);
    await allocate(appPool, { user: fx.alice, project: fx.acmeProj, name: 'a', vcpu: 3, ram: 4, region: fx.eu });
    assert.equal((await one(`SELECT count(*)::int n FROM notification_queue`)).n, 0);        // 62.5% free

    await allocate(appPool, { user: fx.alice, project: fx.acmeProj, name: 'b', vcpu: 2, ram: 4, region: fx.eu });   // 37.5% free
    let n = await one(`SELECT count(*)::int n, min(notification_type) t, min(user_id) u FROM notification_queue`);
    assert.deepEqual([n.n, n.t, n.u], [1, 'HOST_LOW_CAPACITY', fx.admin]);

    await allocate(appPool, { user: fx.alice, project: fx.acmeProj, name: 'c', vcpu: 1, ram: 4, region: fx.eu });   // 25% free
    n = await one(`SELECT count(*)::int n FROM notification_queue`);
    assert.equal(n.n, 1);
  });
});
