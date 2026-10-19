// Concurrency: the invariants must hold when many allocations race for the same capacity or quota.
// Each "client" is a separate pooled connection, like concurrent Express requests.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  appPool, adminPool, closePools, resetDatabase, allocateWithRetry, complete, terminate, one, reconcile,
} from './helpers/db.js';
import { createFixture, createTenant, hostRow, quotaRow, vmRow } from './helpers/fixture.js';

let fx;
beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});
after(closePools);

const codes = (results) => results.map((r) => (r.status === 'fulfilled' ? 'ok' : r.reason.code));
const tally = (list) => list.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});

describe('concurrent allocations', () => {
  test('12 tenants race for a host that fits exactly 4: exactly 4 succeed, 8 get CS001, no drift', async () => {
    // eu-host-1 has 8 vCPU; each request takes 2 -> K = 4. Separate organizations, so only the host lock serialises them.
    const tenants = [];
    for (let i = 1; i <= 12; i++) tenants.push(await createTenant(fx.plan, i));
    const stats = { retries: 0 };

    const results = await Promise.allSettled(tenants.map((t, i) =>
      allocateWithRetry(appPool, { user: t.user, project: t.project, name: `vm-${i}`, vcpu: 2, ram: 4, storage: 10, region: fx.eu }, stats)));

    assert.deepEqual(tally(codes(results)), { ok: 4, CS001: 8 }, JSON.stringify(codes(results)));
    const host = await hostRow(fx.euHost);
    assert.equal(host.allocated_cpu, 8);
    assert.equal(host.allocated_ram_gb, 16);
    assert.deepEqual(await reconcile(), []);
    console.log(`  (deadlock/serialization retries needed: ${stats.retries})`);
  });

  test('one project, quota for exactly 5 VMs, 15 parallel requests: exactly 5 succeed, 10 get CS002', async () => {
    await adminPool.query('UPDATE resource_quota SET max_vms = 5 WHERE project_id = $1', [fx.acmeProj]);
    const stats = { retries: 0 };
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) =>
      allocateWithRetry(appPool, { user: fx.alice, project: fx.acmeProj, name: `q-${i}`, vcpu: 1, ram: 1, storage: 5, region: fx.ap }, stats)));

    assert.deepEqual(tally(codes(results)), { ok: 5, CS002: 10 }, JSON.stringify(codes(results)));
    assert.equal((await quotaRow(fx.acmeProj)).used_vms, 5);
    assert.deepEqual(await reconcile(), []);
  });

  test('no-region requests spread over both hosts without oversubscribing either', async () => {
    // eu fits 4 x 2 vCPU, ap fits 8 x 2 vCPU (16 vCPU): 12 requests fit exactly, the 13th..20th must fail.
    const tenants = [];
    for (let i = 1; i <= 20; i++) tenants.push(await createTenant(fx.plan, i));
    const results = await Promise.allSettled(tenants.map((t, i) =>
      allocateWithRetry(appPool, { user: t.user, project: t.project, name: `s-${i}`, vcpu: 2, ram: 4, storage: 10 })));

    assert.deepEqual(tally(codes(results)), { ok: 12, CS001: 8 }, JSON.stringify(codes(results)));
    assert.equal((await hostRow(fx.euHost)).allocated_cpu, 8);
    assert.equal((await hostRow(fx.apHost)).allocated_cpu, 16);
    assert.deepEqual(await reconcile(), []);
  });

  test('parallel allocations racing with parallel terminations stay consistent', async () => {
    const tenants = [];
    for (let i = 1; i <= 8; i++) tenants.push(await createTenant(fx.plan, i));
    // Fill eu-host-1 with 4 VMs from tenants 1..4.
    const existing = [];
    for (const t of tenants.slice(0, 4)) {
      const id = await allocateWithRetry(appPool, { user: t.user, project: t.project, name: 'old', vcpu: 2, ram: 4, region: fx.eu });
      await complete(appPool, id);
      existing.push({ t, id });
    }
    // Now terminate those 4 while tenants 5..8 try to take the same space.
    const stats = { retries: 0 };
    const results = await Promise.allSettled([
      ...existing.map(({ t, id }) => terminate(appPool, t.user, id)),
      ...tenants.slice(4).map((t, i) => allocateWithRetry(appPool, { user: t.user, project: t.project, name: `new-${i}`, vcpu: 2, ram: 4, region: fx.eu }, stats)),
    ]);

    const outcome = codes(results);
    assert.ok(outcome.every((c) => c === 'ok' || c === 'CS001'), `unexpected error codes: ${JSON.stringify(outcome)}`);
    assert.ok(outcome.slice(0, 4).every((c) => c === 'ok'), 'every termination must succeed');
    const host = await hostRow(fx.euHost);
    const succeeded = outcome.slice(4).filter((c) => c === 'ok').length;
    assert.equal(host.allocated_cpu, succeeded * 2);
    assert.ok(host.allocated_cpu <= 8);
    assert.deepEqual(await reconcile(), []);
  });

  test('10 concurrent terminations of the same VM: exactly one succeeds, the reservation is released once', async () => {
    const keep = await allocateWithRetry(appPool, { user: fx.alice, project: fx.acmeProj, name: 'keep', vcpu: 2, ram: 4, storage: 10, region: fx.ap });
    const target = await allocateWithRetry(appPool, { user: fx.alice, project: fx.acmeProj, name: 'target', vcpu: 3, ram: 6, storage: 20, region: fx.ap });
    await complete(appPool, target);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => terminate(appPool, fx.alice, target)));
    assert.deepEqual(tally(codes(results)), { ok: 1, CS004: 9 }, JSON.stringify(codes(results)));

    const host = await hostRow(fx.apHost);
    assert.deepEqual([host.allocated_cpu, host.allocated_ram_gb], [2, 4]);     // only "keep" remains; never negative
    const quota = await quotaRow(fx.acmeProj);
    assert.deepEqual([quota.used_vcpu, quota.used_ram_gb, quota.used_vms, quota.used_storage_gb], [2, 4, 1, 10]);
    assert.equal((await vmRow(keep)).state, 'PROVISIONING');
    assert.deepEqual(await reconcile(), []);
  });

  test('a host that is exactly full rejects the next request instead of oversubscribing (CHECK never trips)', async () => {
    const t = await createTenant(fx.plan, 1);
    for (let i = 0; i < 4; i++) {
      await allocateWithRetry(appPool, { user: t.user, project: t.project, name: `f-${i}`, vcpu: 2, ram: 8, region: fx.eu });
    }
    const err = await allocateWithRetry(appPool, { user: t.user, project: t.project, name: 'overflow', vcpu: 1, ram: 1, region: fx.eu })
      .then(() => null, (e) => e);
    assert.equal(err?.code, 'CS001');
    const host = await one('SELECT free_cpu, free_ram_gb FROM cloud_host WHERE host_id = $1', [fx.euHost]);
    assert.deepEqual([host.free_cpu, host.free_ram_gb], [0, 0]);
  });
});
