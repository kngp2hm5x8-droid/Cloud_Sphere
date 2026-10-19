// The demo seed (database/seeds/001_demo.sql): it builds a consistent world through the real routines,
// is idempotent, and makes each rule demonstrable (capacity, quota, budget, hourly cap, carbon preference).

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { appPool, adminPool, closePools, resetDatabase, allocate, one, reconcile, hasCode } from './helpers/db.js';

const SEED_SQL = await readFile(fileURLToPath(new URL('../../database/seeds/001_demo.sql', import.meta.url)), 'utf8');
const runSeed = () => adminPool.query(SEED_SQL);

const id = async (sql, params) => Object.values(await one(sql, params))[0];
const userId = (email) => id('SELECT user_id FROM app_user WHERE email = $1', [email]);
const projectId = (name) => id('SELECT project_id FROM project WHERE name = $1', [name]);
const regionId = (code) => id('SELECT region_id FROM cloud_region WHERE code = $1', [code]);

beforeEach(async () => {
  await resetDatabase();
  await runSeed();
});
after(closePools);

describe('seed data', () => {
  test('counters reconcile and the sample VMs are in the intended states', async () => {
    assert.deepEqual(await reconcile(), []);
    const { rows } = await adminPool.query('SELECT name, state, is_spot FROM virtual_machine ORDER BY vm_id');
    assert.deepEqual(rows.map((r) => `${r.name}:${r.state}${r.is_spot ? ':spot' : ''}`), [
      'web-1:RUNNING', 'web-2:RUNNING', 'web-win:RUNNING', 'etl-batch:STOPPED', 'report-worker:PROVISIONING',
      'old-staging:TERMINATED', 'batch-render:RUNNING', 'spot-render:RUNNING:spot', 'sbx-api:STOPPED', 'sbx-db:RUNNING', 'it-wiki:RUNNING',
    ]);
    const hosts = (await adminPool.query('SELECT hostname, status, allocated_cpu FROM cloud_host ORDER BY host_id')).rows;
    assert.deepEqual(hosts.map((h) => [h.hostname, h.status, h.allocated_cpu]), [
      ['eun-host-01', 'ACTIVE', 12], ['eun-host-02', 'ACTIVE', 0], ['aps-host-01', 'ACTIVE', 9], ['aps-host-02', 'ACTIVE', 0],
      ['aps-host-03', 'MAINTENANCE', 0], ['use-host-01', 'ACTIVE', 1], ['use-host-02', 'ACTIVE', 7],
    ]);
  });

  test('running it again changes nothing', async () => {
    const count = () => id('SELECT (SELECT count(*) FROM virtual_machine) + (SELECT count(*) FROM monitoring_log) + (SELECT count(*) FROM app_user)');
    const before = await count();
    await runSeed();
    assert.equal(await count(), before);
  });

  test('every demo account can sign in with the demo password (pgcrypto, as the API role)', async () => {
    const { rows } = await appPool.query(`SELECT email, (password_hash = crypt($1, password_hash)) AS ok FROM app_user ORDER BY user_id`, ['Demo@12345']);
    assert.deepEqual(rows.map((r) => r.email), ['admin@cloudsphere.test', 'alice@acme.test', 'bob@acme.test', 'carol@globex.test', 'dave@initech.test']);
    assert.ok(rows.every((r) => r.ok));
  });

  test('monitoring: three VMs, 2016-sample windows, web-1 has the 8-sample gap, previous-month partition has rows, SLA breach is real', async () => {
    const perVm = (await adminPool.query(
      `SELECT vm.name, count(*)::int AS n FROM monitoring_log m JOIN virtual_machine vm USING (vm_id)
        WHERE m.logged_at >= date_trunc('hour', now()) - interval '7 days' GROUP BY 1 ORDER BY 1`)).rows;
    assert.deepEqual(perVm, [{ name: 'it-wiki', n: 2016 }, { name: 'web-1', n: 2008 }, { name: 'web-2', n: 2016 }]);

    const prev = await one(
      `SELECT count(*)::int AS n FROM monitoring_log
        WHERE logged_at < date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    assert.ok(prev.n > 0, 'previous-month samples exist');

    const sla = await one('SELECT * FROM sla_record');
    assert.equal(sla.received_samples, 2008);
    assert.equal(sla.expected_samples, 2016);
    assert.equal(sla.is_breach, true);

    const cpu = (await adminPool.query(
      `SELECT vm.name, avg(cpu_pct)::float AS a FROM monitoring_log m JOIN virtual_machine vm USING (vm_id) GROUP BY 1`)).rows
      .reduce((o, r) => ({ ...o, [r.name]: r.a }), {});
    assert.ok(cpu['web-1'] > 70 && cpu['web-2'] > 25 && cpu['web-2'] < 55 && cpu['it-wiki'] < 5);
  });

  test('the low-capacity alert for use-host-02 reached the admin through the real trigger', async () => {
    const n = await one(`SELECT count(*)::int AS c, min(title) AS t FROM notification_queue WHERE notification_type = 'HOST_LOW_CAPACITY'`);
    assert.deepEqual([n.c, n.t], [1, 'Host use-host-02 is low on capacity']);
  });
});

describe('seed data: each rule is demonstrable as the API role', () => {
  test('capacity (CS001): within web-prod quota but larger than any eu-north-1 host can still hold', async () => {
    await assert.rejects(
      allocate(appPool, { user: await userId('alice@acme.test'), project: await projectId('web-prod'), name: 'huge',
                          vcpu: 22, ram: 44, storage: 100, region: await regionId('eu-north-1') }),
      hasCode('CS001'));
    assert.deepEqual(await reconcile(), []);
  });

  test('the literal "128 vCPU" request fails on quota first (CS002), which is why the demo uses 22', async () => {
    await assert.rejects(
      allocate(appPool, { user: await userId('alice@acme.test'), project: await projectId('web-prod'), name: 'huge',
                          vcpu: 128, ram: 512, region: await regionId('ap-south-1') }),
      hasCode('CS002'));
  });

  test('quota (CS002): Globex sandbox has no VM slot left', async () => {
    await assert.rejects(
      allocate(appPool, { user: await userId('carol@globex.test'), project: await projectId('sandbox'), name: 'one-more', vcpu: 1, ram: 1, storage: 5 }),
      hasCode('CS002'));
  });

  test('budget (CS005): a second it-wiki-sized VM would pass the 150.00 budget', async () => {
    await assert.rejects(
      allocate(appPool, { user: await userId('dave@initech.test'), project: await projectId('internal-tools'), name: 'it-wiki-2', vcpu: 2, ram: 4, storage: 30 }),
      (err) => hasCode('CS005')(err) && /173\.04/.test(err.message));
  });

  test('hourly cap (CS005): a per-request cap below the VM price is refused', async () => {
    await assert.rejects(
      allocate(appPool, { user: await userId('dave@initech.test'), project: await projectId('internal-tools'), name: 'cheap', vcpu: 1, ram: 1, storage: 5, hourlyCap: 0.01 }),
      hasCode('CS005'));
  });

  test('carbon preference: no region lands in eu-north-1; success keeps everything reconciled', async () => {
    const vmId = await allocate(appPool, { user: await userId('alice@acme.test'), project: await projectId('web-prod'), name: 'green', vcpu: 2, ram: 4, storage: 20 });
    const host = await one('SELECT h.hostname FROM virtual_machine vm JOIN cloud_host h USING (host_id) WHERE vm.vm_id = $1', [vmId]);
    assert.equal(host.hostname, 'eun-host-01');
    assert.deepEqual(await reconcile(), []);
  });
});
