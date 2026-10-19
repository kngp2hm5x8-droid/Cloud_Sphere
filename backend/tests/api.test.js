import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { adminPool, closePools, resetDatabase } from './helpers/db.js';
import { createFixture } from './helpers/fixture.js';

// The test fixture truncates TEST_DATABASE_URL, so the API under test must use that same database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { default: app } = await import('../src/app.js');

let server;
let base;
let fx;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await resetDatabase(); fx = await createFixture(); });
after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closePools();
});

test('core API workflow: auth, projects, estimate, VM lifecycle, monitoring and dashboard', async () => {
  const anonymous = await fetch(`${base}/api/v1/auth/me`);
  assert.equal(anonymous.status, 401);
  assert.equal((await fetch(`${base}/api/health/db`)).status, 401);

  const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`);
  assert.equal(csrfResponse.status, 200);
  const csrf = (await csrfResponse.json()).data.csrf_token;
  const csrfCookie = csrfResponse.headers.getSetCookie().find((value) => value.startsWith('cloudsphere_csrf='));
  assert.ok(csrfCookie);
  const cookiePair = csrfCookie.split(';', 1)[0];

  const csrfRejected = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(csrfRejected.status, 403);
  const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Requested-With': 'CloudSphere', 'X-CSRF-Token': csrf, Cookie: cookiePair,
  }, body: JSON.stringify({ email: 'alice@acme.test', password: 'Demo@12345' }) });
  assert.equal(login.status, 200);
  const user = (await login.json()).data;
  assert.equal(user.email, 'alice@acme.test');
  const sessionCookie = login.headers.getSetCookie().find((value) => value.startsWith('cloudsphere_session='));
  assert.ok(sessionCookie);
  const cookie = `${cookiePair}; ${sessionCookie.split(';', 1)[0]}`;
  const headers = { Cookie: cookie };
  const writeHeaders = { ...headers, 'Content-Type': 'application/json', 'X-Requested-With': 'CloudSphere', 'X-CSRF-Token': csrf };

  const me = await fetch(`${base}/api/v1/auth/me`, { headers });
  assert.equal((await me.json()).data.user_id, user.user_id);
  const projectsResponse = await fetch(`${base}/api/v1/projects`, { headers });
  assert.equal(projectsResponse.status, 200);
  const projects = (await projectsResponse.json()).data;
  assert.ok(projects.length > 0, 'the signed-in organization should have projects');
  assert.ok(projects.every((item) => item.organization_id === user.organization_id), 'project listing must stay within the signed-in organization');
  const project = projects.find((item) => item.name === 'web-prod');
  assert.ok(project);
  assert.equal((await fetch(`${base}/api/v1/projects/${fx.globexProj}`, { headers })).status, 404);
  const createdProject = await fetch(`${base}/api/v1/projects`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ name: 'api-project', description: 'Created through the API', monthly_budget: 250 }) });
  assert.equal(createdProject.status, 201);
  const createdProjectBody = (await createdProject.json()).data;
  assert.equal(createdProjectBody.name, 'api-project');
  assert.equal((await fetch(`${base}/api/v1/projects/${createdProjectBody.project_id}`, { headers })).status, 200);

  const estimate = await fetch(`${base}/api/v1/vms/estimate`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: project.project_id, vcpu: 2, ram_gb: 4, storage_gb: 20 }) });
  assert.equal(estimate.status, 200);
  assert.equal((await estimate.json()).data.monthly_total_cost, '75.00');

  const create = await fetch(`${base}/api/v1/vms`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: project.project_id, name: 'api-web-1', vcpu: 2, ram_gb: 4, storage_gb: 20, os_image: 'ubuntu-22.04', volume_type: 'SSD' }) });
  assert.equal(create.status, 201);
  const vm = (await create.json()).data;
  assert.equal(vm.state, 'RUNNING');

  const list = await fetch(`${base}/api/v1/vms?project_id=${project.project_id}`, { headers });
  assert.ok((await list.json()).data.some((item) => item.vm_id === vm.vm_id));
  const detail = await fetch(`${base}/api/v1/vms/${vm.vm_id}`, { headers });
  assert.equal((await detail.json()).data.name, 'api-web-1');
  const metrics = await fetch(`${base}/api/v1/vms/${vm.vm_id}/metrics`, { headers });
  assert.deepEqual((await metrics.json()).data, []);
  const summary = await fetch(`${base}/api/v1/monitoring/summary`, { headers });
  assert.equal(summary.status, 200);
  assert.equal((await fetch(`${base}/api/v1/dashboard/summary`, { headers })).status, 200);
  assert.ok((await fetch(`${base}/api/v1/regions`, { headers })).ok);
  assert.ok((await fetch(`${base}/api/v1/configurations`, { headers })).ok);
  assert.ok((await fetch(`${base}/api/v1/quotas`, { headers })).ok);
  const unreadCount = (await (await fetch(`${base}/api/v1/notifications/unread-count`, { headers })).json()).data.unread_count;
  assert.ok(Number.isInteger(unreadCount) && unreadCount >= 0, 'unread notification count should be a non-negative integer');

  for (const action of ['stop', 'start', 'terminate']) {
    const response = await fetch(`${base}/api/v1/vms/${vm.vm_id}/${action}`, { method: 'POST', headers: writeHeaders });
    assert.equal(response.status, 200, `${action}: ${await response.text()}`);
  }
  const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: writeHeaders });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: cookiePair } })).status, 401);

  // The allocator's existing database integration suite continues to exercise concurrency and rollback guarantees.
  const { rows } = await adminPool.query(`SELECT count(*)::int AS n FROM virtual_machine WHERE name='api-web-1' AND state='TERMINATED'`);
  assert.equal(rows[0].n, 1);
});
