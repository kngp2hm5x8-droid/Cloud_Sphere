import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireAuth, requireCsrf } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, (req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requireCsrf(req, res, next));
const idSchema = z.string().regex(/^[1-9]\d*$/);
const idParam = (value, res) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A valid numeric identifier is required.' } }); return null; }
  return parsed.data;
};
const fail = (res, code = 'NOT_FOUND', message = 'Resource not found.') => res.status(404).json({ error: { code, message } });
const projectScope = (user, alias = 'p') => user.role === 'admin' ? 'TRUE' : `${alias}.organization_id = $1`;

router.get('/projects', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT p.project_id, p.organization_id, p.name, p.description, p.status, p.monthly_budget,
        p.created_at, q.max_vcpu, q.used_vcpu, q.max_ram_gb, q.used_ram_gb, q.max_vms, q.used_vms, q.max_storage_gb, q.used_storage_gb
      FROM project p LEFT JOIN resource_quota q ON q.project_id = p.project_id
      WHERE ${projectScope(req.user)} ORDER BY p.name`, req.user.role === 'admin' ? [] : [req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/projects/:projectId', async (req, res, next) => {
  const projectId = idParam(req.params.projectId, res); if (!projectId) return;
  try {
    const { rows } = await query(`SELECT p.project_id, p.organization_id, p.name, p.description, p.status, p.monthly_budget, p.created_at,
      q.max_vcpu, q.used_vcpu, q.max_ram_gb, q.used_ram_gb, q.max_vms, q.used_vms, q.max_storage_gb, q.used_storage_gb
      FROM project p LEFT JOIN resource_quota q ON q.project_id = p.project_id
      WHERE p.project_id = $1 AND ($2::boolean OR p.organization_id = $3)`, [projectId, req.user.role === 'admin', req.user.organization_id]);
    if (!rows[0]) return fail(res);
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.post('/projects', async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(1000).optional().nullable(), monthly_budget: z.number().nonnegative().finite().optional().nullable() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Project details are invalid.' } });
    if (!req.user.organization_id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'A project organization is required.' } });
    const { name, description, monthly_budget } = parsed.data;
    const { rows } = await query(`INSERT INTO project (organization_id,name,description,monthly_budget,created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING project_id, organization_id, name, description, status, monthly_budget, created_at`,
      [req.user.organization_id, name, description ?? null, monthly_budget ?? null, req.user.user_id]);
    res.status(201).json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.get('/regions', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT r.region_id,r.code,r.name,r.country,cp.carbon_intensity_gco2_kwh
      FROM cloud_region r LEFT JOIN carbon_profile cp ON cp.region_id=r.region_id AND cp.effective_to IS NULL
      WHERE r.is_active ORDER BY r.name`);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/configurations', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT vm_configuration_id,name,vcpu,ram_gb,os_family,os_image
      FROM vm_configuration WHERE is_catalog ORDER BY vcpu,ram_gb,os_family,name`);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/quotas', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT quota_id,organization_id,project_id,max_vcpu,used_vcpu,max_ram_gb,used_ram_gb,max_vms,used_vms,max_storage_gb,used_storage_gb
      FROM resource_quota WHERE ($1::boolean OR organization_id=$2) ORDER BY project_id NULLS FIRST,quota_id`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/carbon-profiles', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT cp.carbon_profile_id, r.region_id, r.code AS region_code, r.name AS region_name,
        r.country, cp.version, cp.carbon_intensity_gco2_kwh, cp.effective_from, cp.effective_to
      FROM carbon_profile cp JOIN cloud_region r USING (region_id)
      WHERE r.is_active AND cp.effective_to IS NULL
      ORDER BY cp.carbon_intensity_gco2_kwh, r.name`);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/sla-records', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT s.sla_record_id, s.vm_id, vm.name AS vm_name, vm.project_id, p.name AS project_name,
        r.code AS region_code, r.name AS region_name, plan.name AS plan_name,
        s.period_start, s.period_end, s.target_uptime_pct, s.measured_uptime_pct, s.expected_samples,
        s.received_samples, s.downtime_minutes, s.is_breach, s.computed_at
      FROM sla_record s
      JOIN virtual_machine vm USING (vm_id)
      JOIN project p USING (project_id)
      JOIN subscription_plan plan ON plan.plan_id = s.subscription_plan_id
      LEFT JOIN cloud_host h ON h.host_id = vm.host_id
      LEFT JOIN cloud_region r ON r.region_id = h.region_id
      WHERE ($1::boolean OR p.organization_id = $2)
      ORDER BY s.period_end DESC, s.sla_record_id DESC`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

// Read-only storage inventory. Scope volume and snapshot rows through their owning project,
// keeping the database's organization boundary intact for every customer request.
router.get('/volumes', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT v.volume_id,v.project_id,p.name AS project_name,v.region_id,r.code AS region_code,
        v.vm_id,vm.name AS vm_name,v.name,v.size_gb,v.used_gb,v.volume_type,v.is_root,v.state,v.created_at
      FROM storage_volume v JOIN project p USING(project_id)
      JOIN cloud_region r USING(region_id) LEFT JOIN virtual_machine vm USING(vm_id)
      WHERE v.state <> 'DELETED' AND ($1::boolean OR p.organization_id=$2)
      ORDER BY v.created_at DESC,v.volume_id DESC`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/snapshots', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT s.snapshot_id,s.volume_id,v.project_id,p.name AS project_name,
        v.name AS volume_name,vm.name AS vm_name,s.name,s.status,s.size_gb,s.taken_at,s.retention_days,s.expires_at,s.created_at
      FROM backup_snapshot s JOIN storage_volume v USING(volume_id) JOIN project p USING(project_id)
      LEFT JOIN virtual_machine vm USING(vm_id)
      WHERE ($1::boolean OR p.organization_id=$2)
      ORDER BY s.taken_at DESC,s.snapshot_id DESC`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

// Network inventory is read through the owning project so customers only see their organization's
// networks, rules, and load balancers. Network configuration remains managed by the existing schema.
router.get('/networks', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT n.virtual_network_id,n.project_id,p.name AS project_name,n.region_id,r.code AS region_code,
        n.parent_network_id,parent.name AS parent_network_name,n.name,n.cidr_block::text AS cidr_block,n.created_at,
        count(DISTINCT vm.vm_id)::int AS attached_vm_count,
        coalesce(string_agg(DISTINCT vm.name, ', ' ORDER BY vm.name) FILTER (WHERE vm.vm_id IS NOT NULL), '') AS attached_vm_names,
        (SELECT count(*)::int FROM firewall_rule fr WHERE fr.virtual_network_id=n.virtual_network_id) AS firewall_rule_count
      FROM virtual_network n JOIN project p USING(project_id) JOIN cloud_region r USING(region_id)
      LEFT JOIN virtual_network parent ON parent.virtual_network_id=n.parent_network_id
      LEFT JOIN virtual_machine vm ON vm.subnet_id=n.virtual_network_id
      WHERE ($1::boolean OR p.organization_id=$2)
      GROUP BY n.virtual_network_id,p.name,r.code,parent.name
      ORDER BY p.name,n.parent_network_id NULLS FIRST,n.name`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/firewall-rules', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT fr.firewall_rule_id,fr.virtual_network_id,n.name AS network_name,n.cidr_block::text AS network_cidr,
        n.project_id,p.name AS project_name,fr.direction,fr.action,fr.protocol,fr.port_from,fr.port_to,
        fr.remote_cidr::text AS remote_cidr,fr.priority,fr.description,fr.created_at
      FROM firewall_rule fr JOIN virtual_network n USING(virtual_network_id) JOIN project p USING(project_id)
      WHERE ($1::boolean OR p.organization_id=$2)
      ORDER BY p.name,n.name,fr.direction,fr.priority,fr.firewall_rule_id`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/load-balancers', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT lb.load_balancer_id,lb.project_id,p.name AS project_name,lb.virtual_network_id,n.name AS network_name,
        n.cidr_block::text AS network_cidr,lb.name,lb.algorithm,lb.listener_protocol,lb.listener_port,lb.status,lb.created_at,
        count(DISTINCT vm.vm_id)::int AS attached_vm_count,
        coalesce(string_agg(DISTINCT vm.name, ', ' ORDER BY vm.name) FILTER (WHERE vm.vm_id IS NOT NULL), '') AS attached_vm_names
      FROM load_balancer lb JOIN project p USING(project_id) JOIN virtual_network n USING(virtual_network_id)
      LEFT JOIN virtual_machine vm ON vm.load_balancer_id=lb.load_balancer_id
      WHERE ($1::boolean OR p.organization_id=$2)
      GROUP BY lb.load_balancer_id,p.name,n.name,n.cidr_block
      ORDER BY p.name,lb.name`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/billing/invoices', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT i.invoice_id,i.organization_id,i.project_id,p.name AS project_name,i.invoice_type,
        i.period_start,i.period_end,i.subtotal,i.tax_amount,i.total_amount,i.usage_breakdown,i.status,i.issued_at,i.due_date,i.created_at,
        coalesce(jsonb_agg(jsonb_build_object('payment_id',pay.payment_id,'amount',pay.amount,'method',pay.method,
          'status',pay.status,'transaction_ref',pay.transaction_ref,'paid_at',pay.paid_at,'created_at',pay.created_at)
          ORDER BY pay.created_at DESC) FILTER (WHERE pay.payment_id IS NOT NULL), '[]'::jsonb) AS payments
      FROM billing_invoice i LEFT JOIN project p USING(project_id) LEFT JOIN payment pay USING(invoice_id)
      WHERE ($1::boolean OR i.organization_id=$2)
      GROUP BY i.invoice_id,p.name
      ORDER BY i.period_start DESC,i.invoice_id DESC`, [req.user.role === 'admin', req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/dashboard/summary', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const { rows } = await query(`SELECT 'admin'::text AS role,
        (SELECT count(*)::int FROM cloud_host) AS total_hosts,
        (SELECT count(*)::int FROM virtual_machine WHERE state NOT IN ('TERMINATED','PREEMPTED','FAILED')) AS total_vms,
        (SELECT coalesce(sum(total_cpu),0)::int FROM cloud_host) AS total_cpu,
        (SELECT coalesce(sum(allocated_cpu),0)::int FROM cloud_host) AS allocated_cpu,
        (SELECT coalesce(sum(total_ram_gb),0)::int FROM cloud_host) AS total_ram_gb,
        (SELECT coalesce(sum(allocated_ram_gb),0)::int FROM cloud_host) AS allocated_ram_gb,
        (SELECT count(*)::int FROM cloud_host WHERE free_cpu <= total_cpu*0.1 OR free_ram_gb <= total_ram_gb*0.1) AS hosts_near_capacity,
        (SELECT count(*)::int FROM organization WHERE status='ACTIVE') AS active_organizations,
        (SELECT count(*)::int FROM project WHERE status='ACTIVE') AS active_projects,
        (SELECT count(*)::int FROM spot_bid_request WHERE status='OPEN') AS pending_spot_requests`);
      return res.json({ data: rows[0] });
    }
    const { rows } = await query(`WITH mine AS (
      SELECT vm.*,c.vcpu,c.ram_gb FROM virtual_machine vm JOIN project p USING(project_id)
      JOIN vm_configuration c USING(vm_configuration_id) WHERE p.organization_id=$1
    ), q AS (SELECT sum(used_vcpu)::int used_vcpu,sum(max_vcpu)::int max_vcpu,sum(used_ram_gb)::int used_ram_gb,
      sum(max_ram_gb)::int max_ram_gb,sum(used_vms)::int used_vms,sum(max_vms)::int max_vms FROM resource_quota WHERE organization_id=$1 AND project_id IS NOT NULL),
    spend AS (SELECT coalesce(sum(project_projected_monthly_cost(p.project_id)),0)::numeric(12,2) amount FROM project p WHERE p.organization_id=$1)
      SELECT 'customer'::text AS role, count(*)::int AS total_vms,
        count(*) FILTER (WHERE state='RUNNING')::int AS running_vms,count(*) FILTER (WHERE state='STOPPED')::int AS stopped_vms,
        coalesce(sum(vcpu) FILTER (WHERE state IN ('PROVISIONING','RUNNING','STOPPED')),0)::int AS allocated_vcpu,
        coalesce(sum(ram_gb) FILTER (WHERE state IN ('PROVISIONING','RUNNING','STOPPED')),0)::int AS allocated_ram_gb,
        (SELECT to_jsonb(q) FROM q) AS quota, (SELECT amount::text FROM spend) AS estimated_usage_charges,
        (SELECT count(*)::int FROM recommendation_log rl JOIN mine m USING(vm_id) WHERE rl.status='PENDING') AS pending_recommendations,
        (SELECT count(*)::int FROM support_ticket t JOIN project p USING(project_id) WHERE p.organization_id=$1 AND t.status NOT IN ('RESOLVED','CLOSED')) AS open_tickets
      FROM mine WHERE state NOT IN ('TERMINATED','PREEMPTED','FAILED')`, [req.user.organization_id]);
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.get('/vms', async (req, res, next) => {
  try {
    const projectId = req.query.project_id ? idParam(String(req.query.project_id), res) : null;
    if (req.query.project_id && !projectId) return;
    const { rows } = await query(`SELECT vm.vm_id,vm.project_id,p.name AS project_name,vm.name,vm.state,vm.is_spot,vm.host_id,h.hostname,r.code AS region_code,
      vm.vm_configuration_id,c.vcpu,c.ram_gb,c.os_family,c.os_image,vm.requested_at,vm.started_at,vm.stopped_at,vm.created_at
      FROM virtual_machine vm JOIN project p USING(project_id) JOIN vm_configuration c USING(vm_configuration_id)
      LEFT JOIN cloud_host h USING(host_id) LEFT JOIN cloud_region r USING(region_id)
      WHERE ($1::boolean OR p.organization_id=$2) AND ($3::bigint IS NULL OR p.project_id=$3)
      ORDER BY vm.created_at DESC,vm.vm_id DESC`, [req.user.role === 'admin', req.user.organization_id, projectId]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/vms/estimate', async (req, res, next) => {
  const parsed = z.object({ project_id: z.string().regex(/^[1-9]\d*$/), vcpu: z.number().int().min(1).max(256), ram_gb: z.number().int().min(1).max(4096), storage_gb: z.number().int().min(1).max(100000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'VM size and project are invalid.' } });
  try {
    const { project_id, vcpu, ram_gb, storage_gb } = parsed.data;
    const { rows } = await query(`SELECT e.* FROM estimate_vm_cost($1,$2,$3,$4) e
      JOIN project p ON p.project_id=$1 WHERE ($5::boolean OR p.organization_id=$6)`, [project_id, vcpu, ram_gb, storage_gb, req.user.role === 'admin', req.user.organization_id]);
    if (!rows[0]) return fail(res);
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

const createVmSchema = z.object({ project_id: z.string().regex(/^[1-9]\d*$/), name: z.string().trim().min(1).max(100), vcpu: z.number().int().min(1).max(256), ram_gb: z.number().int().min(1).max(4096), storage_gb: z.number().int().min(1).max(100000), os_image: z.string().trim().min(1).max(200), volume_type: z.enum(['SSD','HDD']).default('SSD'), region_id: z.string().regex(/^[1-9]\d*$/).nullable().optional(), max_hourly_budget: z.number().nonnegative().finite().nullable().optional() });
router.post('/vms', async (req, res, next) => {
  const parsed = createVmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'VM request fields are invalid.' } });
  const v = parsed.data;
  try {
    let vmId;
    for (let attempt = 0; ; attempt++) {
      try {
        const { rows } = await query(`CALL allocate_resource($1::bigint,$2::bigint,$3::text,$4::int,$5::int,$6::int,$7::text,$8::text,$9::bigint,$10::numeric,$11::bigint)`,
          [req.user.user_id,v.project_id,v.name,v.vcpu,v.ram_gb,v.storage_gb,v.os_image,v.volume_type,v.region_id ?? null,v.max_hourly_budget ?? null,null]);
        vmId = rows[0].p_vm_id; break;
      } catch (error) {
        if (!['40P01','40001'].includes(error.code) || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    await query('CALL complete_provisioning($1::bigint)', [vmId]);
    const { rows } = await query(`SELECT vm.vm_id,vm.project_id,p.name AS project_name,vm.name,vm.state,vm.is_spot,vm.host_id,h.hostname,r.code AS region_code,
      c.vcpu,c.ram_gb,c.os_family,c.os_image,vm.requested_at,vm.started_at,vm.created_at
      FROM virtual_machine vm JOIN project p USING(project_id) JOIN vm_configuration c USING(vm_configuration_id)
      LEFT JOIN cloud_host h USING(host_id) LEFT JOIN cloud_region r USING(region_id) WHERE vm.vm_id=$1`, [vmId]);
    res.status(201).json({ data: rows[0] });
  } catch (error) { next(error); }
});

const lifecycle = { start: 'start_vm', stop: 'stop_vm', terminate: 'terminate_vm' };
for (const [action, procedure] of Object.entries(lifecycle)) {
  router.post(`/vms/:vmId/${action}`, async (req, res, next) => {
    const vmId = idParam(req.params.vmId, res); if (!vmId) return;
    try {
      await query(`CALL ${procedure}($1::bigint,$2::bigint)`, [req.user.user_id, vmId]);
      const { rows } = await query(`SELECT vm_id,project_id,name,state,host_id,started_at,stopped_at,terminated_at FROM virtual_machine WHERE vm_id=$1`, [vmId]);
      res.json({ data: rows[0] });
    } catch (error) { next(error); }
  });
}

const vmAccess = `($2::boolean OR p.organization_id=$3)`;
router.get('/vms/:vmId', async (req, res, next) => {
  const vmId = idParam(req.params.vmId, res); if (!vmId) return;
  try {
    const { rows } = await query(`SELECT vm.vm_id,vm.project_id,p.name AS project_name,p.organization_id,vm.name,vm.state,vm.is_spot,vm.host_id,h.hostname,r.region_id,r.code AS region_code,r.name AS region_name,
      c.vcpu,c.ram_gb,c.os_family,c.os_image,vm.private_ip::text,vm.requested_at,vm.started_at,vm.stopped_at,vm.terminated_at,vm.created_at
      FROM virtual_machine vm JOIN project p USING(project_id) JOIN vm_configuration c USING(vm_configuration_id)
      LEFT JOIN cloud_host h USING(host_id) LEFT JOIN cloud_region r USING(region_id)
      WHERE vm.vm_id=$1 AND ${vmAccess}`, [vmId,req.user.role==='admin',req.user.organization_id]);
    if (!rows[0]) return fail(res);
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.get('/vms/:vmId/metrics', async (req, res, next) => {
  const vmId = idParam(req.params.vmId, res); if (!vmId) return;
  try {
    const { rows } = await query(`SELECT m.vm_id,m.logged_at,m.cpu_pct,m.ram_pct,m.disk_pct,m.net_in_kbps,m.net_out_kbps
      FROM monitoring_log m JOIN virtual_machine vm USING(vm_id) JOIN project p USING(project_id)
      WHERE m.vm_id=$1 AND ${vmAccess} AND m.logged_at >= now() - interval '24 hours'
      ORDER BY m.logged_at`, [vmId,req.user.role==='admin',req.user.organization_id]);
    if (!rows.length) {
      const exists = await query(`SELECT 1 FROM virtual_machine vm JOIN project p USING(project_id) WHERE vm.vm_id=$1 AND ${vmAccess}`,[vmId,req.user.role==='admin',req.user.organization_id]);
      if (!exists.rowCount) return fail(res);
    }
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/monitoring/summary', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT vm.vm_id,vm.name,vm.state,
        round(avg(m.cpu_pct),2) AS avg_cpu_pct,round(avg(m.ram_pct),2) AS avg_ram_pct,
        round(max(m.cpu_pct),2) AS max_cpu_pct,round(max(m.ram_pct),2) AS max_ram_pct,
        round(avg(m.disk_pct),2) AS avg_disk_pct,count(m.logged_at)::int AS sample_count,max(m.logged_at) AS latest_sample_at
      FROM virtual_machine vm JOIN project p USING(project_id) LEFT JOIN monitoring_log m
        ON m.vm_id=vm.vm_id AND m.logged_at >= now()-interval '24 hours'
      WHERE ($1::boolean OR p.organization_id=$2) GROUP BY vm.vm_id,vm.name,vm.state ORDER BY vm.name`, [req.user.role==='admin',req.user.organization_id]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/notifications/unread-count', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT count(*)::int AS count FROM notification_queue WHERE user_id=$1 AND read_at IS NULL AND status='SENT'`, [req.user.user_id]);
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

export default router;
