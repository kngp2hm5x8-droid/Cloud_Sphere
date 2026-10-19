// Small deterministic world used by every test (the demo seed data is separate).
//
// Prices: 0.04 per vCPU-hour, 0.005 per GB-RAM-hour, 0.10 per GB-storage-month.
//   2 vCPU / 4 GB RAM  -> 0.10 per hour  -> 73.00 per month (730 h)
//   20 GB storage      -> 2.00 per month
// Hosts: ap-host-1 (16 vCPU / 64 GB) in ap-south-1 (carbon 650); eu-host-1 (8 vCPU / 32 GB) in eu-north-1 (carbon 30).

import { adminPool, one } from './db.js';

const q = (sql, params) => adminPool.query(sql, params);

export async function createUser(email, role, organizationId) {
  const u = await one(
    `INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
     VALUES ($1, $2, crypt('Demo@12345', gen_salt('bf', 4)), $3, $4) RETURNING user_id`,
    [organizationId, email, email.split('@')[0], role],
  );
  return u.user_id;
}

export async function createOrg(name, planId) {
  const o = await one(
    `INSERT INTO organization (name, subscription_plan_id, billing_email) VALUES ($1, $2, $3) RETURNING organization_id`,
    [name, planId, `billing@${name.toLowerCase().replace(/\W+/g, '')}.test`],
  );
  return o.organization_id;
}

/** Creates a project (the default-quota trigger gives it a quota row) and overrides its limits. */
export async function createProject(orgId, name, { budget = null, vcpu = 64, ram = 256, vms = 50, storage = null } = {}) {
  const p = await one(
    `INSERT INTO project (organization_id, name, monthly_budget) VALUES ($1, $2, $3) RETURNING project_id`,
    [orgId, name, budget],
  );
  await q(
    `UPDATE resource_quota SET max_vcpu = $2, max_ram_gb = $3, max_vms = $4, max_storage_gb = $5 WHERE project_id = $1`,
    [p.project_id, vcpu, ram, vms, storage],
  );
  return p.project_id;
}

/** One customer user with their own organization and project: used to create many independent tenants. */
export async function createTenant(planId, n, quota = {}) {
  const org = await createOrg(`Tenant ${n}`, planId);
  const user = await createUser(`tenant${n}@tenant${n}.test`, 'customer', org);
  const project = await createProject(org, `proj-${n}`, quota);
  return { org, user, project };
}

export async function createFixture() {
  const plan = (await one(
    `INSERT INTO subscription_plan (name, monthly_fee, price_per_vcpu_hour, price_per_gb_ram_hour,
        price_per_gb_storage_month, sla_uptime_target_pct, default_max_vcpu, default_max_ram_gb, default_max_vms)
     VALUES ('Premium', 99, 0.04, 0.005, 0.10, 99.99, 32, 128, 10) RETURNING plan_id`)).plan_id;

  const ap = (await one(`INSERT INTO cloud_region (code, name, country) VALUES ('ap-south-1','Mumbai','IN') RETURNING region_id`)).region_id;
  const eu = (await one(`INSERT INTO cloud_region (code, name, country) VALUES ('eu-north-1','Stockholm','SE') RETURNING region_id`)).region_id;
  await q(`INSERT INTO carbon_profile (region_id, version, carbon_intensity_gco2_kwh, effective_from)
           VALUES ($1, 1, 650, now() - interval '1 day'), ($2, 1, 30, now() - interval '1 day')`, [ap, eu]);

  const apHost = (await one(
    `INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES ($1, 'ap-host-1', 16, 64) RETURNING host_id`, [ap])).host_id;
  const euHost = (await one(
    `INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES ($1, 'eu-host-1', 8, 32) RETURNING host_id`, [eu])).host_id;

  const acme = await createOrg('Acme', plan);
  const globex = await createOrg('Globex', plan);
  const admin = await createUser('admin@cloudsphere.test', 'admin', null);
  const alice = await createUser('alice@acme.test', 'customer', acme);
  const bob = await createUser('bob@globex.test', 'customer', globex);

  const acmeProj = await createProject(acme, 'web-prod');
  const acmeBudget = await createProject(acme, 'budgeted', { budget: 100 });
  const acmeSmall = await createProject(acme, 'small', { vcpu: 4, ram: 8, vms: 2, storage: 100 });
  const globexProj = await createProject(globex, 'sandbox');

  return { plan, ap, eu, apHost, euHost, acme, globex, admin, alice, bob, acmeProj, acmeBudget, acmeSmall, globexProj };
}

export const hostRow = (id) => one('SELECT * FROM cloud_host WHERE host_id = $1', [id]);
export const vmRow = (id) => one('SELECT * FROM virtual_machine WHERE vm_id = $1', [id]);
export const quotaRow = (projectId) => one('SELECT * FROM resource_quota WHERE project_id = $1', [projectId]);
export const orgQuotaRow = (orgId) => one('SELECT * FROM resource_quota WHERE organization_id = $1 AND project_id IS NULL', [orgId]);
