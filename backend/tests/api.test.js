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
  assert.equal((await fetch(`${base}/api/v1/volumes`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/snapshots`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/networks`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/firewall-rules`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/load-balancers`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/billing/invoices`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/carbon-profiles`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/sla-records`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/recommendations`)).status, 401);

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

  const carbonProfilesResponse = await fetch(`${base}/api/v1/carbon-profiles`, { headers });
  assert.equal(carbonProfilesResponse.status, 200);
  const carbonProfiles = (await carbonProfilesResponse.json()).data;
  assert.equal(carbonProfiles.length, 2);
  assert.equal(carbonProfiles[0].region_code, 'eu-north-1', 'profiles should be ordered by current carbon intensity');
  assert.equal(Number(carbonProfiles[0].carbon_intensity_gco2_kwh), 30);

  const foreignVm = (await adminPool.query(`INSERT INTO virtual_machine (project_id,vm_configuration_id,name,state)
    SELECT $1,vm_configuration_id,'foreign-sla-vm','FAILED' FROM virtual_machine WHERE vm_id=$2
    RETURNING vm_id`, [fx.globexProj, vm.vm_id])).rows[0];
  for (const vmId of [vm.vm_id, foreignVm.vm_id]) {
    await adminPool.query(`INSERT INTO sla_record (vm_id,subscription_plan_id,period_start,period_end,target_uptime_pct,
      measured_uptime_pct,expected_samples,received_samples,downtime_minutes)
      VALUES ($1,$2,now()-interval '7 days',now(),99.990,99.603,2016,2008,40)`, [vmId, fx.plan]);
  }
  const slaResponse = await fetch(`${base}/api/v1/sla-records`, { headers });
  assert.equal(slaResponse.status, 200);
  const slaRecords = (await slaResponse.json()).data;
  assert.equal(slaRecords.length, 1, 'SLA records must be scoped to the signed-in organization');
  assert.equal(slaRecords[0].vm_name, 'api-web-1');
  assert.equal(slaRecords[0].is_breach, true);
  assert.equal(slaRecords[0].received_samples, 2008);

  await adminPool.query(`INSERT INTO recommendation_log (vm_id,recommendation_type,rule_code,trigger_metrics,
    window_start,window_end,recommended_vm_configuration_id)
    SELECT $1,'SCALE_UP','CPU_HIGH_7D','{"avg_cpu_pct":82.5,"p95_cpu_pct":94,"samples":2016}'::jsonb,
      now()-interval '7 days',now(),vm_configuration_id FROM virtual_machine WHERE vm_id=$1`, [vm.vm_id]);
  await adminPool.query(`INSERT INTO recommendation_log (vm_id,recommendation_type,rule_code,trigger_metrics,
    window_start,window_end,estimated_monthly_saving)
    VALUES ($1,'TERMINATE_IDLE','CPU_IDLE_7D','{"avg_cpu_pct":1.2,"samples":2016}'::jsonb,
      now()-interval '7 days',now(),42.50)`, [foreignVm.vm_id]);
  const recommendationsResponse = await fetch(`${base}/api/v1/recommendations`, { headers });
  assert.equal(recommendationsResponse.status, 200);
  const recommendations = (await recommendationsResponse.json()).data;
  assert.equal(recommendations.length, 1, 'recommendations must be scoped to the signed-in organization');
  assert.equal(recommendations[0].vm_name, 'api-web-1');
  assert.equal(recommendations[0].rule_code, 'CPU_HIGH_7D');
  assert.equal(recommendations[0].trigger_metrics.avg_cpu_pct, 82.5);
  assert.ok(recommendations[0].recommended_vm_configuration_id);
  assert.equal(recommendations[0].recommended_vcpu, 2);
  assert.equal(recommendations[0].recommended_ram_gb, 4);

  const tenantNetwork = (await adminPool.query(`INSERT INTO virtual_network (project_id,region_id,name,cidr_block)
    VALUES ($1,$2,'api-vpc','10.20.0.0/16') RETURNING virtual_network_id`, [project.project_id, fx.eu])).rows[0];
  const tenantSubnet = (await adminPool.query(`INSERT INTO virtual_network (project_id,region_id,parent_network_id,name,cidr_block)
    VALUES ($1,$2,$3,'api-subnet','10.20.1.0/24') RETURNING virtual_network_id`, [project.project_id, fx.eu, tenantNetwork.virtual_network_id])).rows[0];
  const foreignNetwork = (await adminPool.query(`INSERT INTO virtual_network (project_id,region_id,name,cidr_block)
    VALUES ($1,$2,'foreign-vpc','10.30.0.0/16') RETURNING virtual_network_id`, [fx.globexProj, fx.ap])).rows[0];
  await adminPool.query(`INSERT INTO firewall_rule (virtual_network_id,direction,action,protocol,port_from,port_to,remote_cidr,priority,description)
    VALUES ($1,'INGRESS','ALLOW','TCP',443,443,'0.0.0.0/0',100,'HTTPS access'),($2,'INGRESS','DENY','ANY',NULL,NULL,'0.0.0.0/0',1000,'Foreign rule')`,
    [tenantNetwork.virtual_network_id, foreignNetwork.virtual_network_id]);
  const loadBalancer = (await adminPool.query(`INSERT INTO load_balancer (project_id,virtual_network_id,name,listener_protocol,listener_port)
    VALUES ($1,$2,'api-lb','HTTPS',443) RETURNING load_balancer_id`, [project.project_id, tenantNetwork.virtual_network_id])).rows[0];
  await adminPool.query(`UPDATE virtual_machine SET subnet_id=$2,private_ip='10.20.1.11',load_balancer_id=$3 WHERE vm_id=$1`,
    [vm.vm_id, tenantSubnet.virtual_network_id, loadBalancer.load_balancer_id]);

  const networks = (await (await fetch(`${base}/api/v1/networks`, { headers })).json()).data;
  assert.equal(networks.length, 2, 'networks must be scoped to the signed-in organization');
  assert.equal(networks.find((item) => item.virtual_network_id === tenantSubnet.virtual_network_id).parent_network_name, 'api-vpc');
  assert.equal(networks.find((item) => item.virtual_network_id === tenantSubnet.virtual_network_id).attached_vm_names, 'api-web-1');
  assert.equal(networks.find((item) => item.virtual_network_id === tenantNetwork.virtual_network_id).firewall_rule_count, 1);
  const firewallRules = (await (await fetch(`${base}/api/v1/firewall-rules`, { headers })).json()).data;
  assert.equal(firewallRules.length, 1);
  assert.equal(firewallRules[0].remote_cidr, '0.0.0.0/0');
  const loadBalancers = (await (await fetch(`${base}/api/v1/load-balancers`, { headers })).json()).data;
  assert.equal(loadBalancers.length, 1);
  assert.equal(loadBalancers[0].attached_vm_names, 'api-web-1');

  const billingInvoice = (await adminPool.query(`INSERT INTO billing_invoice
    (organization_id,project_id,invoice_type,period_start,period_end,subtotal,tax_amount,total_amount,status,due_date)
    VALUES ($1,$2,'USAGE',current_date,current_date+30,25,0,25,'ISSUED',current_date+40) RETURNING invoice_id`,
    [fx.acme, project.project_id])).rows[0];
  await adminPool.query(`INSERT INTO payment (invoice_id,amount,method,status,transaction_ref,paid_at)
    VALUES ($1,10,'SIMULATED_CARD','SUCCEEDED','API-TEST-PAYMENT-1',now())`, [billingInvoice.invoice_id]);
  const foreignInvoice = await adminPool.query(`INSERT INTO billing_invoice
    (organization_id,invoice_type,period_start,period_end,subtotal,tax_amount,total_amount,status,due_date)
    VALUES ($1,'SUBSCRIPTION',current_date,current_date+30,99,0,99,'PAID',current_date+40) RETURNING invoice_id`, [fx.globex]);
  await adminPool.query(`INSERT INTO payment (invoice_id,amount,method,status,transaction_ref,paid_at)
    VALUES ($1,99,'SIMULATED_UPI','SUCCEEDED','API-TEST-PAYMENT-FOREIGN',now())`, [foreignInvoice.rows[0].invoice_id]);
  const invoices = (await (await fetch(`${base}/api/v1/billing/invoices`, { headers })).json()).data;
  assert.equal(invoices.length, 1, 'invoice listing must stay within the signed-in organization');
  assert.equal(invoices[0].project_name, 'web-prod');
  assert.equal(invoices[0].payments.length, 1);
  assert.equal(invoices[0].payments[0].transaction_ref, 'API-TEST-PAYMENT-1');

  // Storage inventory and snapshots use project ownership, not caller-supplied organization IDs.
  const volumeResponse = await fetch(`${base}/api/v1/volumes`, { headers });
  assert.equal(volumeResponse.status, 200);
  const volumes = (await volumeResponse.json()).data;
  const rootVolume = volumes.find((item) => item.vm_id === vm.vm_id);
  assert.ok(rootVolume, 'the VM root volume should be visible to its tenant');
  assert.equal(rootVolume.project_name, 'web-prod');
  assert.equal(rootVolume.vm_name, 'api-web-1');
  assert.equal(rootVolume.is_root, true);
  assert.equal(rootVolume.state, 'ATTACHED');

  const otherTenantVolume = (await adminPool.query(`INSERT INTO storage_volume
    (project_id,region_id,name,size_gb,volume_type,state) VALUES ($1,$2,'private-volume',20,'SSD','AVAILABLE') RETURNING volume_id`,
    [fx.globexProj, fx.eu])).rows[0];
  await adminPool.query(`INSERT INTO backup_snapshot
    (volume_id,name,status,size_gb,taken_at,retention_days,expires_at,created_by)
    VALUES ($1,'api-workflow-snapshot','COMPLETED',12,now(),30,now()+interval '30 days',$2)`, [rootVolume.volume_id, user.user_id]);
  await adminPool.query(`INSERT INTO backup_snapshot
    (volume_id,name,status,size_gb,taken_at,retention_days,expires_at,created_by)
    VALUES ($1,'private-snapshot','COMPLETED',8,now(),30,now()+interval '30 days',$2)`, [otherTenantVolume.volume_id, fx.bob]);
  const snapshotsResponse = await fetch(`${base}/api/v1/snapshots`, { headers });
  assert.equal(snapshotsResponse.status, 200);
  const snapshots = (await snapshotsResponse.json()).data;
  assert.ok(snapshots.some((item) => item.name === 'api-workflow-snapshot' && item.vm_name === 'api-web-1'));
  assert.ok(!snapshots.some((item) => item.name === 'private-snapshot'), 'snapshot listing must exclude other organizations');

  const metrics = await fetch(`${base}/api/v1/vms/${vm.vm_id}/metrics`, { headers });
  assert.deepEqual((await metrics.json()).data, []);
  const summary = await fetch(`${base}/api/v1/monitoring/summary`, { headers });
  assert.equal(summary.status, 200);
  assert.equal((await fetch(`${base}/api/v1/dashboard/summary`, { headers })).status, 200);
  assert.ok((await fetch(`${base}/api/v1/regions`, { headers })).ok);
  assert.ok((await fetch(`${base}/api/v1/configurations`, { headers })).ok);
  assert.ok((await fetch(`${base}/api/v1/quotas`, { headers })).ok);
  const unreadCount = (await (await fetch(`${base}/api/v1/notifications/unread-count`, { headers })).json()).data.count;
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
