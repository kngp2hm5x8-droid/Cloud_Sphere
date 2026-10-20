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
  assert.equal((await fetch(`${base}/api/v1/spot-requests`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/notifications`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/support/tickets`)).status, 401);

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

  await adminPool.query(`INSERT INTO vm_configuration (name,vcpu,ram_gb,os_family,os_image,is_catalog)
    VALUES ('api-spot-small',1,2,'LINUX','api-spot-test-image',true)`);
  const configurations = (await (await fetch(`${base}/api/v1/configurations`, { headers })).json()).data;
  assert.ok(configurations.length > 0);
  const spotRequestResponse = await fetch(`${base}/api/v1/spot-requests`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: String(project.project_id), vm_configuration_id: String(configurations[0].vm_configuration_id),
      region_id: String(fx.eu), max_price_per_hour: 0.025 }) });
  assert.equal(spotRequestResponse.status, 201);
  const spotRequest = (await spotRequestResponse.json()).data;
  assert.equal(spotRequest.status, 'OPEN');
  assert.equal(spotRequest.project_name, 'web-prod');
  assert.equal(spotRequest.region_code, 'eu-north-1');
  assert.equal(Number(spotRequest.max_price_per_hour), 0.025);
  const foreignSpotRequest = (await adminPool.query(`INSERT INTO spot_bid_request
    (project_id,requested_by,vm_configuration_id,max_price_per_hour)
    VALUES ($1,$2,$3,0.0300) RETURNING bid_id`, [fx.globexProj, fx.bob, configurations[0].vm_configuration_id])).rows[0];
  const spotRequestsResponse = await fetch(`${base}/api/v1/spot-requests`, { headers });
  assert.equal(spotRequestsResponse.status, 200);
  const spotRequests = (await spotRequestsResponse.json()).data;
  assert.equal(spotRequests.length, 1, 'spot bids must be scoped to the signed-in organization');
  assert.equal(spotRequests[0].bid_id, spotRequest.bid_id);
  assert.ok(!spotRequests.some((item) => item.bid_id === foreignSpotRequest.bid_id));
  const foreignSpotCreate = await fetch(`${base}/api/v1/spot-requests`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: String(fx.globexProj), vm_configuration_id: String(configurations[0].vm_configuration_id), max_price_per_hour: 0.025 }) });
  assert.equal(foreignSpotCreate.status, 404, 'customers cannot create bids for another organization');
  const invalidSpotCreate = await fetch(`${base}/api/v1/spot-requests`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: String(project.project_id), vm_configuration_id: String(configurations[0].vm_configuration_id), max_price_per_hour: 0 }) });
  assert.equal(invalidSpotCreate.status, 400, 'bid price must be positive');

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

  const notificationIds = (await adminPool.query(`INSERT INTO notification_queue
    (user_id,notification_type,title,payload,status,read_at,sent_at)
    VALUES ($1,'TEST_MESSAGE','Unread test message','{"vm_id":1}'::jsonb,'SENT',NULL,now()),
      ($1,'TEST_MESSAGE','Read test message',NULL,'SENT',now(),now()),
      ($2,'TEST_MESSAGE','Foreign tenant message',NULL,'SENT',NULL,now()),
      ($1,'TEST_MESSAGE','Queued message',NULL,'PENDING',NULL,NULL)
    RETURNING notification_id,user_id`, [user.user_id, fx.bob])).rows;
  const notificationsResponse = await fetch(`${base}/api/v1/notifications`, { headers });
  assert.equal(notificationsResponse.status, 200);
  const notifications = (await notificationsResponse.json()).data;
  assert.equal(notifications.length, 2, 'only this user’s sent notifications should be listed');
  assert.ok(notifications.some((item) => item.title === 'Unread test message' && item.payload.vm_id === 1));
  assert.ok(!notifications.some((item) => item.title === 'Foreign tenant message' || item.title === 'Queued message'));
  const currentUnreadCount = (await (await fetch(`${base}/api/v1/notifications/unread-count`, { headers })).json()).data.count;
  assert.equal(currentUnreadCount, 1);
  const sentOwnIds = notifications.filter((item) => item.title === 'Unread test message');
  assert.equal(sentOwnIds.length, 1);
  const markRead = await fetch(`${base}/api/v1/notifications/${sentOwnIds[0].notification_id}/read`, { method: 'POST', headers: writeHeaders });
  assert.equal(markRead.status, 200);
  assert.ok((await markRead.json()).data.read_at);
  assert.equal((await (await fetch(`${base}/api/v1/notifications/unread-count`, { headers })).json()).data.count, 0);
  const foreignNotificationId = notificationIds.find((item) => item.user_id !== user.user_id).notification_id;
  const foreignMarkRead = await fetch(`${base}/api/v1/notifications/${foreignNotificationId}/read`, { method: 'POST', headers: writeHeaders });
  assert.equal(foreignMarkRead.status, 404, 'users cannot change another user’s notification');

  await adminPool.query(`INSERT INTO support_ticket (created_by,project_id,subject,description,priority)
    VALUES ($1,$2,'Existing tenant issue','A persisted support ticket for the tenant.','HIGH'),
      ($3,$4,'Foreign tenant issue','This ticket belongs to another organization.','MEDIUM')`,
    [user.user_id,project.project_id,fx.bob,fx.globexProj]);
  const createTicket = await fetch(`${base}/api/v1/support/tickets`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: String(project.project_id), subject: 'API-created support issue',
      description: 'Created as part of the API workflow verification.', priority: 'MEDIUM' }) });
  assert.equal(createTicket.status, 201);
  const ticket = (await createTicket.json()).data;
  assert.equal(ticket.status, 'OPEN');
  assert.equal(ticket.subject, 'API-created support issue');
  assert.equal(ticket.project_name, 'web-prod');
  const tickets = (await (await fetch(`${base}/api/v1/support/tickets`, { headers })).json()).data;
  assert.equal(tickets.length, 2, 'support history should include own and same-organization tickets only');
  assert.ok(tickets.some((item) => item.ticket_id === ticket.ticket_id));
  assert.ok(!tickets.some((item) => item.subject === 'Foreign tenant issue'));
  const foreignTicket = await fetch(`${base}/api/v1/support/tickets`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ project_id: String(fx.globexProj), subject: 'Foreign project issue',
      description: 'This must be rejected for a different tenant.', priority: 'HIGH' }) });
  assert.equal(foreignTicket.status, 404);
  const invalidTicket = await fetch(`${base}/api/v1/support/tickets`, { method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ subject: 'bad', description: 'too short', priority: 'URGENT' }) });
  assert.equal(invalidTicket.status, 400);

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

async function loginAs(email) {
  const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`);
  const csrf = (await csrfResponse.json()).data.csrf_token;
  const csrfCookie = csrfResponse.headers.getSetCookie().find((value) => value.startsWith('cloudsphere_csrf=')).split(';', 1)[0];
  const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Requested-With': 'CloudSphere', 'X-CSRF-Token': csrf, Cookie: csrfCookie,
  }, body: JSON.stringify({ email, password: 'Demo@12345' }) });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.getSetCookie().find((value) => value.startsWith('cloudsphere_session=')).split(';', 1)[0];
  const cookie = `${csrfCookie}; ${sessionCookie}`;
  return {
    headers: { Cookie: cookie },
    writeHeaders: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'CloudSphere', 'X-CSRF-Token': csrf },
  };
}

test('admin console APIs: authorization, host controls, organizations, users, quotas and audit', async () => {
  const customer = await loginAs('alice@acme.test');
  for (const path of ['/hosts', '/admin/organizations', '/admin/users', '/admin/audit']) {
    assert.equal((await fetch(`${base}/api/v1${path}`, { headers: customer.headers })).status, 403, `${path} is admin-only`);
  }
  assert.equal((await fetch(`${base}/api/v1/hosts/${fx.apHost}/status`, { method: 'PATCH', headers: customer.writeHeaders,
    body: JSON.stringify({ status: 'DRAINING' }) })).status, 403);
  assert.equal((await fetch(`${base}/api/v1/quotas/1`, { method: 'PATCH', headers: customer.writeHeaders,
    body: JSON.stringify({ max_vcpu: 99 }) })).status, 403);

  const admin = await loginAs('admin@cloudsphere.test');
  const organizationsResponse = await fetch(`${base}/api/v1/admin/organizations`, { headers: admin.headers });
  assert.equal(organizationsResponse.status, 200);
  const organizations = (await organizationsResponse.json()).data;
  assert.deepEqual(organizations.map((item) => item.name), ['Acme', 'Globex']);
  assert.ok(organizations.every((item) => item.user_count === 1));

  const usersResponse = await fetch(`${base}/api/v1/admin/users`, { headers: admin.headers });
  assert.equal(usersResponse.status, 200);
  const users = (await usersResponse.json()).data;
  assert.equal(users.length, 3);
  assert.ok(users.some((item) => item.email === 'admin@cloudsphere.test' && item.organization_id === null));
  assert.ok(users.every((item) => !Object.hasOwn(item, 'password_hash')));

  const quotasResponse = await fetch(`${base}/api/v1/quotas`, { headers: admin.headers });
  assert.equal(quotasResponse.status, 200);
  const quotas = (await quotasResponse.json()).data;
  assert.ok(quotas.some((item) => item.project_name === 'web-prod' && item.organization_name === 'Acme'));
  const quota = quotas.find((item) => item.project_id === fx.acmeProj);
  assert.ok(quota);

  const createVm = await fetch(`${base}/api/v1/vms`, { method: 'POST', headers: admin.writeHeaders,
    body: JSON.stringify({ project_id: String(fx.acmeProj), name: 'admin-capacity-check', vcpu: 2, ram_gb: 4, storage_gb: 20, os_image: 'ubuntu-22.04', volume_type: 'SSD' }) });
  const createdVm = await createVm.json();
  assert.equal(createVm.status, 201, JSON.stringify(createdVm));
  const vm = createdVm.data;
  const projectQuota = (await adminPool.query('SELECT * FROM resource_quota WHERE quota_id=$1', [quota.quota_id])).rows[0];
  assert.ok(projectQuota.used_vcpu >= 2);
  const tooSmall = await fetch(`${base}/api/v1/quotas/${quota.quota_id}`, { method: 'PATCH', headers: admin.writeHeaders,
    body: JSON.stringify({ max_vcpu: projectQuota.used_vcpu - 1 }) });
  assert.equal(tooSmall.status, 409);
  const quotaUpdate = await fetch(`${base}/api/v1/quotas/${quota.quota_id}`, { method: 'PATCH', headers: admin.writeHeaders,
    body: JSON.stringify({ max_vcpu: projectQuota.used_vcpu + 10 }) });
  assert.equal(quotaUpdate.status, 200);
  assert.equal((await quotaUpdate.json()).data.max_vcpu, projectQuota.used_vcpu + 10);

  const hostsResponse = await fetch(`${base}/api/v1/hosts`, { headers: admin.headers });
  assert.equal(hostsResponse.status, 200);
  const hosts = (await hostsResponse.json()).data;
  assert.equal(hosts.length, 2);
  const allocatedHost = hosts.find((item) => String(item.host_id) === String(vm.host_id));
  assert.ok(allocatedHost);
  const blockedDecommission = await fetch(`${base}/api/v1/hosts/${allocatedHost.host_id}/status`, { method: 'PATCH', headers: admin.writeHeaders,
    body: JSON.stringify({ status: 'DECOMMISSIONED' }) });
  assert.equal(blockedDecommission.status, 409);

  const idleHost = hosts.find((item) => String(item.host_id) !== String(allocatedHost.host_id));
  const hostUpdate = await fetch(`${base}/api/v1/hosts/${idleHost.host_id}/status`, { method: 'PATCH', headers: admin.writeHeaders,
    body: JSON.stringify({ status: 'DRAINING', low_capacity_threshold_pct: 18 }) });
  assert.equal(hostUpdate.status, 200);
  assert.equal((await hostUpdate.json()).data.status, 'DRAINING');
  const audit = (await (await fetch(`${base}/api/v1/admin/audit`, { headers: admin.headers })).json()).data;
  assert.ok(audit.some((item) => item.entity_type === 'cloud_host' && item.action === 'UPDATE'));
  assert.ok(audit.some((item) => item.entity_type === 'resource_quota' && item.action === 'UPDATE'));
});
