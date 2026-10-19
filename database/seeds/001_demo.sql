-- 001_demo.sql: deterministic DEMO data for CloudSphere (development only; every figure is simulated).
--
-- Run as the schema owner:   cd backend && npm run seed
-- Idempotent: if the organization "Acme Robotics" already exists the whole script does nothing.
-- Everything runs in ONE transaction: either all of it is created or none of it is.
--
-- Capacity, quota and VM state are NOT written by hand. Every sample VM goes through the real routines
-- (allocate_resource, complete_provisioning, stop_vm, terminate_vm), so host and quota counters are consistent.
-- The last step runs the reconciliation check and aborts the seed if any counter differs.
--
-- Demo accounts (password for all of them: Demo@12345):
--   admin@cloudsphere.test (admin) | alice@acme.test, bob@acme.test | carol@globex.test | dave@initech.test
--
-- Requests that demonstrate each rule (call as the user shown; names/ids come from the tables):
--   success           alice, web-prod, 2 vCPU / 4 GB / 20 GB, no region        -> lands on eu-north-1 (lowest carbon)
--   carbon preference same request, region omitted                              -> eun-host-01 (eu-north-1, 30 g/kWh)
--   capacity (CS001)  alice, web-prod, 22 vCPU / 44 GB / 100 GB, region eu-north-1
--                     fits web-prod's quota (32/64) but no eu-north-1 host has 22 vCPU free. Run it BEFORE other
--                     web-prod requests: the seed leaves web-prod exactly 22 vCPU / 44 GB of headroom.
--   quota (CS002)     carol, sandbox, any request (its 2 VM slots are used)
--   budget (CS005)    dave, internal-tools, 2 vCPU / 4 GB / 30 GB (projected 173.04 > budget 150.00)
--   hourly cap (CS005) any project with p_max_hourly_budget below the request's hourly price

DO $seed$
DECLARE
  v_basic BIGINT; v_standard BIGINT; v_premium BIGINT;
  v_ap BIGINT; v_eu BIGINT; v_us BIGINT;
  v_eun1 BIGINT; v_eun2 BIGINT; v_aps1 BIGINT; v_aps2 BIGINT; v_aps3 BIGINT; v_use1 BIGINT; v_use2 BIGINT;
  v_cfg_large BIGINT; v_cfg_small BIGINT;
  v_acme BIGINT; v_globex BIGINT; v_initech BIGINT;
  v_admin BIGINT; v_alice BIGINT; v_bob BIGINT; v_carol BIGINT; v_dave BIGINT;
  v_web_prod BIGINT; v_analytics BIGINT; v_sandbox BIGINT; v_tools BIGINT;
  v_web1 BIGINT; v_web2 BIGINT; v_webwin BIGINT; v_etl BIGINT; v_report BIGINT; v_old BIGINT; v_batch BIGINT;
  v_spot BIGINT; v_sbxapi BIGINT; v_sbxdb BIGINT; v_wiki BIGINT;
  v_base TIMESTAMPTZ; v_prev_start DATE; v_cur_start DATE; v_next_start DATE;
  v_net BIGINT; v_subnet BIGINT; v_lb BIGINT; v_inv BIGINT; v_ticket BIGINT;
  v_metrics JSONB; v_lines JSONB; v_lines2 JSONB; v_sum NUMERIC; v_sum2 NUMERIC; v_received INTEGER;
  v_drift INTEGER;
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM organization WHERE name = 'Acme Robotics') THEN
    RAISE NOTICE 'Demo data already present (Acme Robotics exists); nothing to do.';
    RETURN;
  END IF;

  -- 1. Subscription plans ------------------------------------------------------------------------------------
  INSERT INTO subscription_plan (name, monthly_fee, price_per_vcpu_hour, price_per_gb_ram_hour, price_per_gb_storage_month,
                                 sla_uptime_target_pct, default_max_vcpu, default_max_ram_gb, default_max_vms)
  VALUES ('Basic', 29.00, 0.0500, 0.0070, 0.1200, 99.500, 8, 16, 3) RETURNING plan_id INTO v_basic;
  INSERT INTO subscription_plan (name, monthly_fee, price_per_vcpu_hour, price_per_gb_ram_hour, price_per_gb_storage_month,
                                 sla_uptime_target_pct, default_max_vcpu, default_max_ram_gb, default_max_vms)
  VALUES ('Standard', 99.00, 0.0450, 0.0060, 0.1100, 99.900, 16, 64, 5) RETURNING plan_id INTO v_standard;
  INSERT INTO subscription_plan (name, monthly_fee, price_per_vcpu_hour, price_per_gb_ram_hour, price_per_gb_storage_month,
                                 sla_uptime_target_pct, default_max_vcpu, default_max_ram_gb, default_max_vms)
  VALUES ('Premium', 299.00, 0.0400, 0.0050, 0.1000, 99.990, 32, 128, 10) RETURNING plan_id INTO v_premium;

  -- 2. Regions and SIMULATED carbon intensity (versioned; one current row per region) -------------------------
  INSERT INTO cloud_region (code, name, country) VALUES ('ap-south-1', 'Mumbai',    'IN') RETURNING region_id INTO v_ap;
  INSERT INTO cloud_region (code, name, country) VALUES ('eu-north-1', 'Stockholm', 'SE') RETURNING region_id INTO v_eu;
  INSERT INTO cloud_region (code, name, country) VALUES ('us-east-1',  'Virginia',  'US') RETURNING region_id INTO v_us;

  INSERT INTO carbon_profile (region_id, version, carbon_intensity_gco2_kwh, effective_from, effective_to) VALUES
    (v_ap, 1, 700, now() - interval '120 days', now() - interval '60 days'),
    (v_ap, 2, 650, now() - interval '60 days',  NULL),
    (v_eu, 1,  30, now() - interval '120 days', NULL),
    (v_us, 1, 380, now() - interval '120 days', NULL);

  -- 3. Hosts. Insert order matters only as the deterministic tie-break (lowest host_id wins within a region) ---
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES (v_eu, 'eun-host-01', 32, 128) RETURNING host_id INTO v_eun1;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES (v_eu, 'eun-host-02', 16,  64) RETURNING host_id INTO v_eun2;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES (v_ap, 'aps-host-01', 64, 256) RETURNING host_id INTO v_aps1;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES (v_ap, 'aps-host-02',  4,   8) RETURNING host_id INTO v_aps2;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb, status) VALUES (v_ap, 'aps-host-03', 64, 256, 'MAINTENANCE') RETURNING host_id INTO v_aps3;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb) VALUES (v_us, 'use-host-01', 64, 256) RETURNING host_id INTO v_use1;
  INSERT INTO cloud_host (region_id, hostname, total_cpu, total_ram_gb, low_capacity_threshold_pct)
  VALUES (v_us, 'use-host-02', 8, 16, 20) RETURNING host_id INTO v_use2;

  -- 4. Catalog VM configurations (allocate_resource reuses a row with the same vcpu/ram/os_image) --------------
  INSERT INTO vm_configuration (name, vcpu, ram_gb, os_family, os_image, is_catalog) VALUES
    ('micro',      1,  2, 'LINUX',   'ubuntu-22.04',        true),
    ('small',      2,  4, 'LINUX',   'ubuntu-22.04',        true),
    ('medium',     4,  8, 'LINUX',   'ubuntu-22.04',        true),
    ('large',      8, 16, 'LINUX',   'ubuntu-22.04',        true),
    ('xlarge',    16, 32, 'LINUX',   'ubuntu-22.04',        true),
    ('win-small',  2,  4, 'WINDOWS', 'Windows-Server-2022', true),
    ('win-medium', 4,  8, 'WINDOWS', 'Windows-Server-2022', true);
  SELECT vm_configuration_id INTO v_cfg_large FROM vm_configuration WHERE name = 'large';
  SELECT vm_configuration_id INTO v_cfg_small FROM vm_configuration WHERE name = 'small';

  -- 5. Organizations, users, projects -------------------------------------------------------------------------
  INSERT INTO organization (name, subscription_plan_id, billing_email) VALUES ('Acme Robotics', v_premium,  'billing@acme.test')    RETURNING organization_id INTO v_acme;
  INSERT INTO organization (name, subscription_plan_id, billing_email) VALUES ('Globex Labs',   v_basic,    'billing@globex.test')  RETURNING organization_id INTO v_globex;
  INSERT INTO organization (name, subscription_plan_id, billing_email) VALUES ('Initech',       v_standard, 'billing@initech.test') RETURNING organization_id INTO v_initech;

  INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
  VALUES (NULL, 'admin@cloudsphere.test', crypt('Demo@12345', gen_salt('bf', 10)), 'Platform Admin', 'admin') RETURNING user_id INTO v_admin;
  INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
  VALUES (v_acme, 'alice@acme.test', crypt('Demo@12345', gen_salt('bf', 10)), 'Alice Acme', 'customer') RETURNING user_id INTO v_alice;
  INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
  VALUES (v_acme, 'bob@acme.test', crypt('Demo@12345', gen_salt('bf', 10)), 'Bob Acme', 'customer') RETURNING user_id INTO v_bob;
  INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
  VALUES (v_globex, 'carol@globex.test', crypt('Demo@12345', gen_salt('bf', 10)), 'Carol Globex', 'customer') RETURNING user_id INTO v_carol;
  INSERT INTO app_user (organization_id, email, password_hash, full_name, role)
  VALUES (v_initech, 'dave@initech.test', crypt('Demo@12345', gen_salt('bf', 10)), 'Dave Initech', 'customer') RETURNING user_id INTO v_dave;

  -- The default-quota trigger gives each project a quota row from its plan; the limits are then set explicitly.
  INSERT INTO project (organization_id, name, description, monthly_budget, created_by)
  VALUES (v_acme, 'web-prod', 'Production web tier', 5000.00, v_alice) RETURNING project_id INTO v_web_prod;
  INSERT INTO project (organization_id, name, description, monthly_budget, created_by)
  VALUES (v_acme, 'analytics', 'Batch analytics and reporting', NULL, v_bob) RETURNING project_id INTO v_analytics;
  INSERT INTO project (organization_id, name, description, monthly_budget, created_by)
  VALUES (v_globex, 'sandbox', 'Small experimentation sandbox', 100.00, v_carol) RETURNING project_id INTO v_sandbox;
  INSERT INTO project (organization_id, name, description, monthly_budget, created_by)
  VALUES (v_initech, 'internal-tools', 'Internal tooling', 150.00, v_dave) RETURNING project_id INTO v_tools;

  UPDATE resource_quota SET max_vcpu = 32, max_ram_gb = 64, max_vms = 10, max_storage_gb = 2000 WHERE project_id = v_web_prod;
  UPDATE resource_quota SET max_vcpu = 16, max_ram_gb = 32, max_vms = 5,  max_storage_gb = NULL WHERE project_id = v_analytics;
  UPDATE resource_quota SET max_vcpu = 4,  max_ram_gb = 8,  max_vms = 2,  max_storage_gb = 200  WHERE project_id = v_sandbox;
  -- internal-tools keeps the Standard plan defaults (16 vCPU / 64 GB / 5 VMs).
  -- One organization-level quota to show the two-level check (Acme's projects add up to exactly 48 vCPU).
  INSERT INTO resource_quota (organization_id, max_vcpu, max_ram_gb, max_vms, max_storage_gb) VALUES (v_acme, 48, 96, 15, NULL);

  -- 6. Sample VMs, ALWAYS through the routines ------------------------------------------------------------------
  -- Acme web-prod (alice): three RUNNING VMs, no region -> the lowest-carbon region (eu-north-1)
  CALL allocate_resource(v_alice, v_web_prod, 'web-1',   4, 8, 50, 'ubuntu-22.04',        'SSD', NULL, NULL, v_web1);
  CALL complete_provisioning(v_web1);
  CALL allocate_resource(v_alice, v_web_prod, 'web-2',   4, 8, 50, 'ubuntu-22.04',        'SSD', NULL, NULL, v_web2);
  CALL complete_provisioning(v_web2);
  CALL allocate_resource(v_alice, v_web_prod, 'web-win', 2, 4, 60, 'Windows-Server-2022', 'SSD', NULL, NULL, v_webwin);
  CALL complete_provisioning(v_webwin);

  -- Acme analytics (bob): one STOPPED (keeps its reservation, D2), one left PROVISIONING, one TERMINATED
  CALL allocate_resource(v_bob, v_analytics, 'etl-batch',     4, 8, 100, 'ubuntu-22.04', 'HDD', v_ap, NULL, v_etl);
  CALL complete_provisioning(v_etl);
  CALL stop_vm(v_bob, v_etl);
  CALL allocate_resource(v_bob, v_analytics, 'report-worker', 2, 4, 20,  'ubuntu-22.04', 'SSD', v_ap, NULL, v_report);   -- stays PROVISIONING
  CALL allocate_resource(v_bob, v_analytics, 'old-staging',   2, 4, 20,  'ubuntu-22.04', 'SSD', v_us, NULL, v_old);
  CALL complete_provisioning(v_old);
  CALL terminate_vm(v_bob, v_old);

  -- use-host-02 (8 vCPU / 16 GB) must receive the big VM, but within a region the lowest host_id wins. So use-host-01
  -- is switched to DRAINING for this one allocation (status changes never touch counters) and restored right after.
  UPDATE cloud_host SET status = 'DRAINING' WHERE host_id = v_use1;
  CALL allocate_resource(v_bob, v_analytics, 'batch-render',  7, 14, 40, 'ubuntu-22.04', 'SSD', v_us, NULL, v_batch);   -- 7/8 vCPU: low-capacity alert fires
  CALL complete_provisioning(v_batch);
  UPDATE cloud_host SET status = 'ACTIVE' WHERE host_id = v_use1;

  -- One spot VM. allocate_resource has no spot flag, so the seed marks the RUNNING VM as spot (see the hand-over notes).
  CALL allocate_resource(v_bob, v_analytics, 'spot-render',   1, 2, 10, 'ubuntu-22.04', 'SSD', v_us, NULL, v_spot);
  CALL complete_provisioning(v_spot);
  UPDATE virtual_machine SET is_spot = true WHERE vm_id = v_spot;

  -- Globex sandbox (carol, Basic, budget 100.00): 3 of 4 vCPU and 2 of 2 VM slots used, so any further request is refused (CS002).
  -- sbx-api is stopped before sbx-db is requested: a STOPPED VM contributes storage only to the budget projection (A2).
  CALL allocate_resource(v_carol, v_sandbox, 'sbx-api', 2, 2, 20, 'ubuntu-22.04', 'HDD', v_ap, NULL, v_sbxapi);
  CALL complete_provisioning(v_sbxapi);
  CALL stop_vm(v_carol, v_sbxapi);
  CALL allocate_resource(v_carol, v_sandbox, 'sbx-db',  1, 2, 20, 'ubuntu-22.04', 'SSD', v_ap, NULL, v_sbxdb);
  CALL complete_provisioning(v_sbxdb);

  -- Initech internal-tools (dave, Standard, budget 150.00): one RUNNING, nearly idle VM; a second identical one would be refused (CS005).
  CALL allocate_resource(v_dave, v_tools, 'it-wiki', 2, 4, 30, 'ubuntu-22.04', 'SSD', NULL, NULL, v_wiki);
  CALL complete_provisioning(v_wiki);

  -- 7. Give the VMs a believable history. Every timestamp of a VM (and its log/audit rows) moves back by the same amount.
  FOR r IN SELECT * FROM (VALUES
      (v_web1, 45), (v_web2, 45), (v_webwin, 40), (v_etl, 30), (v_report, 0), (v_old, 20), (v_batch, 14),
      (v_spot, 10), (v_sbxapi, 25), (v_sbxdb, 25), (v_wiki, 35)) AS t(vm, days)
  LOOP
    UPDATE virtual_machine
       SET requested_at  = requested_at  - make_interval(days => r.days),
           created_at    = created_at    - make_interval(days => r.days),
           started_at    = started_at    - make_interval(days => r.days),
           stopped_at    = stopped_at    - make_interval(days => r.days),
           terminated_at = terminated_at - make_interval(days => r.days)
     WHERE vm_id = r.vm;
    UPDATE resource_allocation_log SET created_at = created_at - make_interval(days => r.days) WHERE vm_id = r.vm;
    UPDATE audit_log SET created_at = created_at - make_interval(days => r.days)
     WHERE entity_type = 'virtual_machine' AND entity_id = r.vm;
    UPDATE storage_volume sv SET created_at = sv.created_at - make_interval(days => r.days)
      FROM virtual_machine vm
     WHERE vm.vm_id = r.vm AND sv.project_id = vm.project_id AND sv.name = vm.name || '-root';
  END LOOP;
  UPDATE virtual_machine SET stopped_at = now() - interval '2 days' WHERE vm_id = v_etl;
  UPDATE virtual_machine SET stopped_at = now() - interval '1 day'  WHERE vm_id = v_sbxapi;

  -- 8. Monitoring: formula-driven (no random()). 7 days at 5-minute intervals (2016 samples) for three RUNNING VMs:
  --    web-1 high CPU, web-2 normal, it-wiki idle. web-1 has a 40-minute gap (8 missing samples) on day 4 for the SLA record.
  v_base := date_trunc('hour', now()) - interval '7 days';

  CREATE TEMP TABLE seed_profile (vm_id BIGINT, cpu_base FLOAT8, cpu_amp FLOAT8, cpu_jit FLOAT8,
                                  ram_base FLOAT8, ram_amp FLOAT8, disk_base FLOAT8, net_base FLOAT8) ON COMMIT DROP;
  INSERT INTO seed_profile VALUES
    (v_web1, 80.0, 12.0, 6.0, 70.0, 6.0, 36.0, 8000.0),
    (v_web2, 38.0, 15.0, 5.0, 52.0, 8.0, 24.0, 3500.0),
    (v_wiki,  1.5,  0.8, 0.4, 18.0, 1.0, 12.0,   40.0);

  INSERT INTO monitoring_log (vm_id, logged_at, cpu_pct, ram_pct, disk_pct, net_in_kbps, net_out_kbps)
  SELECT p.vm_id,
         v_base + g.i * interval '5 minutes',
         round(least(100, greatest(0, p.cpu_base + p.cpu_amp * sin(2 * pi() * (g.i % 288) / 288.0) + p.cpu_jit * sin(g.i * 0.37::float8)))::numeric, 2),
         round(least(100, greatest(0, p.ram_base + p.ram_amp * sin(2 * pi() * (g.i % 288) / 288.0) + 2.0 * sin(g.i * 0.11::float8)))::numeric, 2),
         round(least(100, p.disk_base + 0.8 * g.i / 2015.0)::numeric, 2),
         greatest(0, round(p.net_base * (1.0 + 0.6 * sin(2 * pi() * (g.i % 288) / 288.0) + 0.1 * sin(g.i * 0.21::float8)))::bigint),
         greatest(0, round(p.net_base * (0.5 + 0.3 * sin(2 * pi() * (g.i % 288) / 288.0) + 0.05 * cos(g.i * 0.17::float8)))::bigint)
    FROM seed_profile p CROSS JOIN generate_series(0, 2015) AS g(i)
   WHERE NOT (p.vm_id = v_web1 AND g.i BETWEEN 1000 AND 1007);

  -- Explicit rows in the PREVIOUS month (24 hourly samples on the 15th) so that partition is not empty. Only for VMs that
  -- already existed then. A "next month" row is deliberately not seeded: it would be a future timestamp in the charts.
  INSERT INTO monitoring_log (vm_id, logged_at, cpu_pct, ram_pct, disk_pct, net_in_kbps, net_out_kbps)
  SELECT p.vm_id, ts.t,
         round(least(100, greatest(0, p.cpu_base + p.cpu_amp * sin(2 * pi() * (g.n % 24) / 24.0) + p.cpu_jit * sin(g.n * 0.37::float8)))::numeric, 2),
         round(least(100, greatest(0, p.ram_base + p.ram_amp * sin(2 * pi() * (g.n % 24) / 24.0)))::numeric, 2),
         round(least(100, greatest(0, p.disk_base - 3.0))::numeric, 2),
         greatest(0, round(p.net_base * (1.0 + 0.6 * sin(2 * pi() * (g.n % 24) / 24.0)))::bigint),
         greatest(0, round(p.net_base * (0.5 + 0.3 * sin(2 * pi() * (g.n % 24) / 24.0)))::bigint)
    FROM seed_profile p
    JOIN virtual_machine vm ON vm.vm_id = p.vm_id
    CROSS JOIN generate_series(0, 23) AS g(n)
    CROSS JOIN LATERAL (SELECT ((date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month') AT TIME ZONE 'UTC')
                               + interval '14 days' + g.n * interval '1 hour' AS t) ts
   WHERE p.vm_id IN (v_web1, v_web2) AND ts.t >= vm.started_at;

  -- Root-volume usage follows the latest disk_pct sample.
  UPDATE storage_volume sv
     SET used_gb = round(sv.size_gb * m.disk_pct / 100.0, 2)
    FROM (SELECT DISTINCT ON (vm_id) vm_id, disk_pct FROM monitoring_log ORDER BY vm_id, logged_at DESC) m
   WHERE sv.vm_id = m.vm_id AND sv.is_root;

  -- 9. Network, load balancer, snapshot for web-prod ---------------------------------------------------------------
  INSERT INTO virtual_network (project_id, region_id, name, cidr_block) VALUES (v_web_prod, v_eu, 'web-vpc', '10.10.0.0/16') RETURNING virtual_network_id INTO v_net;
  INSERT INTO virtual_network (project_id, region_id, parent_network_id, name, cidr_block)
  VALUES (v_web_prod, v_eu, v_net, 'web-subnet', '10.10.1.0/24') RETURNING virtual_network_id INTO v_subnet;
  INSERT INTO firewall_rule (virtual_network_id, direction, action, protocol, port_from, port_to, remote_cidr, priority, description) VALUES
    (v_net, 'INGRESS', 'ALLOW', 'TCP', 443, 443, '0.0.0.0/0',  100, 'HTTPS from anywhere'),
    (v_net, 'INGRESS', 'ALLOW', 'TCP',  22,  22, '10.0.0.0/8', 110, 'SSH from private ranges'),
    (v_net, 'INGRESS', 'DENY',  'ANY', NULL, NULL, '0.0.0.0/0', 1000, 'Default deny'),
    (v_net, 'EGRESS',  'ALLOW', 'ANY', NULL, NULL, '0.0.0.0/0', 100, 'Allow all outbound');
  INSERT INTO load_balancer (project_id, virtual_network_id, name, listener_protocol, listener_port)
  VALUES (v_web_prod, v_net, 'web-lb', 'HTTPS', 443) RETURNING load_balancer_id INTO v_lb;
  UPDATE virtual_machine SET subnet_id = v_subnet, private_ip = '10.10.1.11', load_balancer_id = v_lb WHERE vm_id = v_web1;
  UPDATE virtual_machine SET subnet_id = v_subnet, private_ip = '10.10.1.12', load_balancer_id = v_lb WHERE vm_id = v_web2;
  UPDATE virtual_machine SET subnet_id = v_subnet, private_ip = '10.10.1.13' WHERE vm_id = v_webwin;

  INSERT INTO backup_snapshot (volume_id, name, status, size_gb, taken_at, retention_days, expires_at, created_by)
  SELECT sv.volume_id, 'web-1-root-daily', 'COMPLETED', sv.used_gb, now() - interval '1 day', 30, now() - interval '1 day' + interval '30 days', v_alice
    FROM storage_volume sv WHERE sv.vm_id = v_web1 AND sv.is_root;

  -- 10. Recommendations, computed from the monitoring rows above --------------------------------------------------
  SELECT jsonb_build_object('avg_cpu_pct', round(avg(cpu_pct), 2), 'p95_cpu_pct', round((percentile_cont(0.95) WITHIN GROUP (ORDER BY cpu_pct))::numeric, 2),
                            'max_cpu_pct', max(cpu_pct), 'samples', count(*))
    INTO v_metrics FROM monitoring_log WHERE vm_id = v_web1 AND logged_at >= v_base;
  INSERT INTO recommendation_log (vm_id, recommendation_type, rule_code, trigger_metrics, window_start, window_end, recommended_vm_configuration_id)
  VALUES (v_web1, 'SCALE_UP', 'CPU_HIGH_7D', v_metrics, v_base, v_base + interval '7 days', v_cfg_large);

  SELECT jsonb_build_object('avg_cpu_pct', round(avg(cpu_pct), 2), 'max_cpu_pct', max(cpu_pct), 'samples', count(*))
    INTO v_metrics FROM monitoring_log WHERE vm_id = v_wiki AND logged_at >= v_base;
  INSERT INTO recommendation_log (vm_id, recommendation_type, rule_code, trigger_metrics, window_start, window_end, estimated_monthly_saving)
  VALUES (v_wiki, 'TERMINATE_IDLE', 'CPU_IDLE_7D', v_metrics, v_base, v_base + interval '7 days',
          round(vm_hourly_compute_cost(v_standard, 2, 4) * billing_hours_per_month(), 2) + storage_monthly_cost(v_standard, 30));

  -- 11. SLA record for web-1: expected vs received samples (D13); the 8 missing samples make it a real breach ----------
  SELECT count(*) INTO v_received FROM monitoring_log WHERE vm_id = v_web1 AND logged_at >= v_base AND logged_at < v_base + interval '7 days';
  INSERT INTO sla_record (vm_id, subscription_plan_id, period_start, period_end, target_uptime_pct, measured_uptime_pct,
                          expected_samples, received_samples, downtime_minutes)
  VALUES (v_web1, v_premium, v_base, v_base + interval '7 days', 99.990, round(v_received * 100.0 / 2016, 3),
          2016, v_received, (2016 - v_received) * 5);

  -- 12. Billing (simulated): a PAID subscription invoice for last month, an ISSUED usage invoice for this month so far ---
  v_prev_start := (date_trunc('month', now()) - interval '1 month')::date;
  v_cur_start  := date_trunc('month', now())::date;
  v_next_start := (date_trunc('month', now()) + interval '1 month')::date;

  INSERT INTO billing_invoice (organization_id, invoice_type, period_start, period_end, subtotal, tax_amount, total_amount,
                               usage_breakdown, status, issued_at, due_date)
  VALUES (v_acme, 'SUBSCRIPTION', v_prev_start, v_cur_start, 299.00, 0, 299.00,
          jsonb_build_object('plan', 'Premium', 'monthly_fee', 299.00, 'simulated', true),
          'PAID', v_cur_start::timestamptz, v_cur_start + 14) RETURNING invoice_id INTO v_inv;
  INSERT INTO payment (invoice_id, amount, method, status, transaction_ref, paid_at)
  VALUES (v_inv, 299.00, 'SIMULATED_CARD', 'SUCCEEDED', 'SIM-SEED-0001', v_cur_start::timestamptz + interval '3 days');

  -- Usage so far this month for web-prod: RUNNING VMs x hours since max(start, month start) x plan rate, plus root volumes
  -- prorated by elapsed hours / 730. Pure arithmetic on the seeded rows; a simulation, not metered usage.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('vm_id', s.vm_id::text, 'vm_name', s.name, 'vcpu', s.vcpu, 'ram_gb', s.ram_gb,
                                               'hours', s.hours, 'hourly_rate', s.rate, 'amount', s.amount) ORDER BY s.vm_id), '[]'::jsonb),
         COALESCE(sum(s.amount), 0)
    INTO v_lines, v_sum
    FROM (SELECT vm.vm_id, vm.name, c.vcpu, c.ram_gb, h.hours, rt.rate, round(h.hours * rt.rate, 2) AS amount
            FROM virtual_machine vm
            JOIN vm_configuration c ON c.vm_configuration_id = vm.vm_configuration_id
            CROSS JOIN LATERAL (SELECT round(extract(epoch FROM (now() - greatest(vm.started_at, v_cur_start::timestamptz))) / 3600.0, 2) AS hours) h
            CROSS JOIN LATERAL (SELECT round(vm_hourly_compute_cost(v_premium, c.vcpu, c.ram_gb), 4) AS rate) rt
           WHERE vm.project_id = v_web_prod AND vm.state = 'RUNNING') s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('volume', s.name, 'size_gb', s.size_gb, 'hours', s.hours, 'amount', s.amount) ORDER BY s.volume_id), '[]'::jsonb),
         COALESCE(sum(s.amount), 0)
    INTO v_lines2, v_sum2
    FROM (SELECT sv.volume_id, sv.name, sv.size_gb, h.hours,
                 round(sv.size_gb * 0.10 * h.hours / 730.0, 2) AS amount
            FROM storage_volume sv
            CROSS JOIN LATERAL (SELECT round(extract(epoch FROM (now() - greatest(sv.created_at, v_cur_start::timestamptz))) / 3600.0, 2) AS hours) h
           WHERE sv.project_id = v_web_prod AND sv.state <> 'DELETED') s;

  INSERT INTO billing_invoice (organization_id, project_id, invoice_type, period_start, period_end, subtotal, tax_amount, total_amount,
                               usage_breakdown, status, issued_at, due_date)
  VALUES (v_acme, v_web_prod, 'USAGE', v_cur_start, v_next_start, v_sum + v_sum2, 0, v_sum + v_sum2,
          jsonb_build_object('simulated', true, 'accrued_to', now(), 'compute', v_lines, 'storage', v_lines2,
                             'compute_subtotal', v_sum, 'storage_subtotal', v_sum2),
          'ISSUED', now(), v_next_start + 14);

  -- 13. Support ticket + feedback, notifications -------------------------------------------------------------------
  INSERT INTO support_ticket (created_by, assigned_to, project_id, vm_id, subject, description, priority, status, resolved_at, created_at)
  VALUES (v_alice, v_admin, v_web_prod, v_web1, 'High CPU on web-1 during business hours',
          'CPU stays above 80% most of the day. Can you check whether web-1 is the right size?', 'HIGH', 'RESOLVED',
          now() - interval '1 day', now() - interval '3 days') RETURNING ticket_id INTO v_ticket;
  INSERT INTO customer_feedback (user_id, ticket_id, project_id, rating, comment)
  VALUES (v_alice, v_ticket, v_web_prod, 4, 'Quick reply and a clear recommendation.');

  INSERT INTO notification_queue (user_id, notification_type, title, payload, dedupe_key, status, read_at, sent_at) VALUES
    (v_alice, 'RECOMMENDATION_PENDING', 'Scale-up recommended for web-1',
       jsonb_build_object('vm_id', v_web1, 'recommendation_type', 'SCALE_UP'), 'seed:rec:scale-up:web-1', 'SENT', NULL, now()),
    (v_dave,  'RECOMMENDATION_PENDING', 'it-wiki looks idle',
       jsonb_build_object('vm_id', v_wiki, 'recommendation_type', 'TERMINATE_IDLE'), 'seed:rec:idle:it-wiki', 'SENT', NULL, now()),
    (v_alice, 'INVOICE_ISSUED', 'Usage invoice issued for web-prod',
       jsonb_build_object('project_id', v_web_prod), 'seed:invoice:web-prod', 'SENT', now() - interval '1 hour', now() - interval '2 hours');

  -- 14. Spot bids: one FULFILLED (linked to the spot VM, priced at 60% of on-demand), one OPEN ---------------------------
  INSERT INTO spot_bid_request (project_id, requested_by, vm_configuration_id, region_id, max_price_per_hour, status,
                                fulfilled_vm_id, fulfilled_price_per_hour, fulfilled_at)
  SELECT v_analytics, v_bob, vm.vm_configuration_id, v_us, 0.0400, 'FULFILLED', v_spot,
         round(vm_hourly_compute_cost(v_premium, c.vcpu, c.ram_gb) * 0.6, 4), vm.started_at
    FROM virtual_machine vm JOIN vm_configuration c ON c.vm_configuration_id = vm.vm_configuration_id WHERE vm.vm_id = v_spot;
  INSERT INTO spot_bid_request (project_id, requested_by, vm_configuration_id, region_id, max_price_per_hour, status, expires_at)
  VALUES (v_analytics, v_bob, v_cfg_small, NULL, 0.0200, 'OPEN', now() + interval '1 day');

  -- 15. Reconciliation: abort the whole seed if any counter differs from what the active VMs and root volumes imply ----------
  SELECT count(*) INTO v_drift
    FROM cloud_host h
    LEFT JOIN (SELECT vm.host_id, SUM(c.vcpu) cpu, SUM(c.ram_gb) ram
                 FROM virtual_machine vm JOIN vm_configuration c USING (vm_configuration_id)
                WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED') GROUP BY vm.host_id) s USING (host_id)
   WHERE h.allocated_cpu <> COALESCE(s.cpu, 0) OR h.allocated_ram_gb <> COALESCE(s.ram, 0);
  IF v_drift > 0 THEN RAISE EXCEPTION 'Seed reconciliation failed: % host(s) differ', v_drift; END IF;

  WITH usage AS (
    SELECT p.project_id, p.organization_id,
           COALESCE(SUM(c.vcpu)   FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')), 0) AS cpu,
           COALESCE(SUM(c.ram_gb) FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')), 0) AS ram,
           COUNT(vm.vm_id)        FILTER (WHERE vm.state IN ('PROVISIONING','RUNNING','STOPPED')) AS vms,
           COALESCE((SELECT SUM(v.size_gb) FROM storage_volume v
                      WHERE v.project_id = p.project_id AND v.is_root AND v.state <> 'DELETED'), 0) AS storage
      FROM project p
      LEFT JOIN virtual_machine vm ON vm.project_id = p.project_id
      LEFT JOIN vm_configuration c ON c.vm_configuration_id = vm.vm_configuration_id
     GROUP BY p.project_id, p.organization_id)
  SELECT (SELECT count(*) FROM resource_quota q JOIN usage u ON u.project_id = q.project_id
           WHERE q.used_vcpu <> u.cpu OR q.used_ram_gb <> u.ram OR q.used_vms <> u.vms OR q.used_storage_gb <> u.storage)
       + (SELECT count(*) FROM (SELECT q.quota_id FROM resource_quota q JOIN usage u ON u.organization_id = q.organization_id
                                 WHERE q.project_id IS NULL
                                 GROUP BY q.quota_id, q.used_vcpu, q.used_ram_gb, q.used_vms, q.used_storage_gb
                                HAVING q.used_vcpu <> SUM(u.cpu) OR q.used_ram_gb <> SUM(u.ram) OR q.used_vms <> SUM(u.vms)
                                    OR q.used_storage_gb <> SUM(u.storage)) o)
    INTO v_drift;
  IF v_drift > 0 THEN RAISE EXCEPTION 'Seed reconciliation failed: % quota row(s) differ', v_drift; END IF;

  RAISE NOTICE 'Demo data created; reconciliation shows no differences.';
END
$seed$;
