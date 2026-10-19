// D10: monthly range partitioning of monitoring_log, ingestion limits and 90-day retention (A9).

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { appPool, adminPool, closePools, resetDatabase, allocate, one, hasCode } from './helpers/db.js';
import { createFixture } from './helpers/fixture.js';

let fx;
let vmId;
beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
  vmId = await allocate(appPool, { user: fx.alice, project: fx.acmeProj, name: 'a', region: fx.ap });
});
after(closePools);

/** A timestamp on the 5th of the month `offset` months from the current UTC month, as an ISO string. */
async function monthTs(offset, day = 5) {
  const r = await one(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => $1, days => $2 - 1),
                    'YYYY-MM-DD"T"HH24:MI:SS"+00"') AS ts,
            to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => $1), 'YYYY_MM') AS part`,
    [offset, day]);
  return { ts: r.ts, part: `monitoring_log_${r.part}` };
}

const insert = (ts) => appPool.query(
  `INSERT INTO monitoring_log (vm_id, logged_at, cpu_pct, ram_pct, disk_pct, net_in_kbps, net_out_kbps)
   VALUES ($1, $2, 50, 40, 30, 100, 200) ON CONFLICT (vm_id, logged_at) DO NOTHING`, [vmId, ts]);

describe('monitoring_log partitions', () => {
  test('migration created 6 monthly partitions: current month -2 .. +3', async () => {
    const { rows } = await adminPool.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'monitoring_log'::regclass ORDER BY 1`);
    assert.equal(rows.length, 6);
    const expected = [];
    for (let o = -2; o <= 3; o++) expected.push((await monthTs(o)).part);
    assert.deepEqual(rows.map((r) => r.relname), expected);
  });

  test('rows are routed to the partition for their month', async () => {
    const months = [-1, 0, 1];
    for (const m of months) await insert((await monthTs(m)).ts);
    const { rows } = await adminPool.query(`SELECT tableoid::regclass::text AS part FROM monitoring_log ORDER BY logged_at`);
    const expected = [];
    for (const m of months) expected.push((await monthTs(m)).part);
    assert.deepEqual(rows.map((r) => r.part), expected);
  });

  test('partition bounds are UTC month boundaries (a row at the last UTC second goes to the earlier month)', async () => {
    const cur = await one(`SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY_MM') AS m`);
    const edge = await one(
      `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 second',
                      'YYYY-MM-DD"T"HH24:MI:SS"+00"') AS ts,
              to_char(date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 second', 'YYYY_MM') AS part`);
    await insert(edge.ts);
    const first = await one(`SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"+00"') AS ts`);
    await insert(first.ts);
    const { rows } = await adminPool.query(`SELECT tableoid::regclass::text AS part FROM monitoring_log ORDER BY logged_at`);
    assert.deepEqual(rows.map((r) => r.part), [`monitoring_log_${edge.part}`, `monitoring_log_${cur.m}`]);
  });

  test('a timestamp outside every existing partition is rejected (there is no DEFAULT partition)', async () => {
    const far = await monthTs(24);
    await assert.rejects(insert(far.ts), (err) => /no partition/i.test(err.message));
    const past = await monthTs(-24);
    await assert.rejects(insert(past.ts), (err) => /no partition/i.test(err.message));
  });

  test('batch ingestion is idempotent on (vm_id, logged_at)', async () => {
    const { ts } = await monthTs(0);
    await insert(ts);
    await insert(ts);
    assert.equal((await one('SELECT count(*)::int AS n FROM monitoring_log')).n, 1);
  });

  test('a one-month query is pruned to a single partition', async () => {
    const lower = await monthTs(0, 1);
    const upper = await monthTs(1, 1);
    const { rows } = await adminPool.query(
      `EXPLAIN (COSTS OFF) SELECT * FROM monitoring_log
        WHERE vm_id = ${Number(vmId)} AND logged_at >= '${lower.ts}' AND logged_at < '${upper.ts}'`);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    assert.ok(plan.includes(lower.part), plan);
    assert.equal((plan.match(/monitoring_log_\d{4}_\d{2}/g) ?? []).filter((p, i, a) => a.indexOf(p) === i).length, 1, plan);
  });

  test('ensure_monitoring_partitions is idempotent', async () => {
    assert.equal((await one('SELECT ensure_monitoring_partitions(2, 3) AS n')).n, 0);
    assert.equal((await one('SELECT ensure_monitoring_partitions(3, 3) AS n')).n, 1);   // one older month is new
    assert.equal((await one('SELECT ensure_monitoring_partitions(3, 3) AS n')).n, 0);
  });
});

describe('retention (90 days, whole partitions)', () => {
  test('drops exactly the partitions that ended before the cutoff and keeps their neighbours', async () => {
    await adminPool.query('SELECT ensure_monitoring_partitions(8, 3)');
    const oldTs = (await monthTs(-7)).ts;
    await insert(oldTs).catch(() => {});            // app role may insert; the row dies with its partition
    const keepTs = (await monthTs(0)).ts;
    await insert(keepTs);

    const before = (await adminPool.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'monitoring_log'::regclass`)).rows
      .map((r) => r.relname);
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const expectedDropped = before.filter((name) => {
      const [, y, m] = /monitoring_log_(\d{4})_(\d{2})/.exec(name);
      return Date.UTC(Number(y), Number(m), 1) <= cutoff;      // month index m (1-12) is the NEXT month's 0-based index
    }).sort();
    assert.ok(expectedDropped.length >= 3, 'test needs several expired partitions to be meaningful');

    const dropped = (await adminPool.query('SELECT drop_expired_monitoring_partitions(90) AS name')).rows.map((r) => r.name).sort();
    assert.deepEqual(dropped, expectedDropped);

    const after = (await adminPool.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'monitoring_log'::regclass`)).rows
      .map((r) => r.relname);
    assert.deepEqual(after.sort(), before.filter((n) => !expectedDropped.includes(n)).sort());
    assert.equal((await one('SELECT count(*)::int AS n FROM monitoring_log')).n, 1);       // current-month row survives
    assert.equal((await one('SELECT count(*)::int AS n FROM drop_expired_monitoring_partitions(90)')).n, 0);   // idempotent: nothing left
  });
});
