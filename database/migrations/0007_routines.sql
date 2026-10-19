-- 0007: pricing helpers, allocation and lifecycle routines, audit and low-capacity triggers
--
-- Decisions implemented here: D1, D2 (retain), D8, A1, A2, A5, A6, A10.
--   * allocate_resource is the ONLY place that decides placement and mutates capacity/quota counters.
--   * One CALL is one atomic unit: no COMMIT/ROLLBACK and no exception handler that swallows errors.
--   * Global lock order in every routine: (1) the VM row -> (2) quota rows (organization row, then project row)
--     -> (3) host rows in ascending host_id. allocate_resource creates its VM, so it starts at (2).
--   * "Active" VM = state IN ('PROVISIONING','RUNNING','STOPPED'): it holds a host and a CPU/RAM/quota reservation.
--
-- Error codes: CS001 capacity, CS002 quota, CS003 invalid request, CS004 invalid state transition,
--              CS005 budget exceeded, CS006 not found / not accessible.
--
-- The routines assume READ COMMITTED (the PostgreSQL default). Callers should retry the whole CALL on 40P01/40001.

-- ---------------------------------------------------------------------------------------------------------------
-- Pricing helpers (single source of pricing logic)
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION billing_hours_per_month() RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 730 $$;

-- Hourly compute price for a configuration under a subscription plan.
CREATE OR REPLACE FUNCTION vm_hourly_compute_cost(p_plan_id BIGINT, p_vcpu INTEGER, p_ram_gb INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_cost NUMERIC;
BEGIN
  SELECT p_vcpu * price_per_vcpu_hour + p_ram_gb * price_per_gb_ram_hour
    INTO v_cost FROM subscription_plan WHERE plan_id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription plan not found' USING ERRCODE = 'CS006';
  END IF;
  RETURN v_cost;
END $$;

-- Monthly storage price for p_gb gigabytes under a subscription plan (rounded to cents).
CREATE OR REPLACE FUNCTION storage_monthly_cost(p_plan_id BIGINT, p_gb INTEGER)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_cost NUMERIC;
BEGIN
  SELECT ROUND(p_gb * price_per_gb_storage_month, 2)
    INTO v_cost FROM subscription_plan WHERE plan_id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription plan not found' USING ERRCODE = 'CS006';
  END IF;
  RETURN v_cost;
END $$;

-- Projected monthly cost of everything a project currently holds (A2):
--   730 h x compute rate for PROVISIONING/RUNNING VMs (STOPPED VMs contribute no compute)
--   + storage price x GB for every non-deleted volume (including volumes of STOPPED VMs).
CREATE OR REPLACE FUNCTION project_projected_monthly_cost(p_project_id BIGINT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_plan BIGINT; v_compute NUMERIC; v_gb BIGINT;
BEGIN
  SELECT o.subscription_plan_id INTO v_plan
    FROM project pr JOIN organization o ON o.organization_id = pr.organization_id
   WHERE pr.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'CS006';
  END IF;

  SELECT COALESCE(SUM(vm_hourly_compute_cost(v_plan, c.vcpu, c.ram_gb)), 0) * billing_hours_per_month()
    INTO v_compute
    FROM virtual_machine vm JOIN vm_configuration c ON c.vm_configuration_id = vm.vm_configuration_id
   WHERE vm.project_id = p_project_id AND vm.state IN ('PROVISIONING','RUNNING');

  SELECT COALESCE(SUM(size_gb), 0) INTO v_gb
    FROM storage_volume WHERE project_id = p_project_id AND state <> 'DELETED';

  RETURN ROUND(v_compute, 2) + storage_monthly_cost(v_plan, v_gb::INTEGER);
END $$;

-- Pricing preview for the provisioning wizard. Pure read; allocate_resource applies the same arithmetic.
CREATE OR REPLACE FUNCTION estimate_vm_cost(p_project_id BIGINT, p_vcpu INTEGER, p_ram_gb INTEGER, p_storage_gb INTEGER)
RETURNS TABLE (
  hourly_compute_cost       NUMERIC,
  monthly_compute_cost      NUMERIC,
  monthly_storage_cost      NUMERIC,
  monthly_total_cost        NUMERIC,
  projected_monthly_before  NUMERIC,
  projected_monthly_after   NUMERIC,
  monthly_budget            NUMERIC,
  within_monthly_budget     BOOLEAN
) LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_plan BIGINT; v_budget NUMERIC; v_hourly NUMERIC; v_compute NUMERIC; v_storage NUMERIC; v_before NUMERIC;
BEGIN
  IF p_vcpu IS NULL OR p_vcpu < 1 OR p_ram_gb IS NULL OR p_ram_gb < 1 OR p_storage_gb IS NULL OR p_storage_gb < 1 THEN
    RAISE EXCEPTION 'vCPU, RAM and storage must be positive integers' USING ERRCODE = 'CS003';
  END IF;

  SELECT o.subscription_plan_id, pr.monthly_budget INTO v_plan, v_budget
    FROM project pr JOIN organization o ON o.organization_id = pr.organization_id
   WHERE pr.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'CS006';
  END IF;

  v_hourly  := vm_hourly_compute_cost(v_plan, p_vcpu, p_ram_gb);
  v_compute := ROUND(v_hourly * billing_hours_per_month(), 2);
  v_storage := storage_monthly_cost(v_plan, p_storage_gb);
  v_before  := project_projected_monthly_cost(p_project_id);

  RETURN QUERY SELECT v_hourly, v_compute, v_storage, v_compute + v_storage,
                      v_before, v_before + v_compute + v_storage, v_budget,
                      (v_budget IS NULL OR v_before + v_compute + v_storage <= v_budget);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------------------------

-- Authorises a user against a project and returns the project's organization id.
-- Admins may act on any project; customers only inside their own organization.
-- A project the user may not see is reported as "not found" (CS006) so ids cannot be probed.
CREATE OR REPLACE FUNCTION assert_project_access(p_user_id BIGINT, p_project_id BIGINT)
RETURNS BIGINT LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_role TEXT; v_user_org BIGINT; v_active BOOLEAN; v_project_org BIGINT;
BEGIN
  SELECT role, organization_id, is_active INTO v_role, v_user_org, v_active
    FROM app_user WHERE user_id = p_user_id;
  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'Unknown or inactive user' USING ERRCODE = 'CS003';
  END IF;

  SELECT organization_id INTO v_project_org FROM project WHERE project_id = p_project_id;
  IF NOT FOUND OR (v_role <> 'admin' AND v_user_org IS DISTINCT FROM v_project_org) THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'CS006';
  END IF;
  RETURN v_project_org;
END $$;

-- Raises CS002 if the request does not fit within one quota row. NULL max_storage_gb means unlimited (D5).
CREATE OR REPLACE FUNCTION check_quota_headroom(p_q resource_quota, p_vcpu INTEGER, p_ram_gb INTEGER,
                                                p_storage_gb INTEGER, p_scope TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_q.used_vcpu + p_vcpu > p_q.max_vcpu THEN
    RAISE EXCEPTION 'vCPU quota exceeded for the % (using %, requesting %, limit %)',
      p_scope, p_q.used_vcpu, p_vcpu, p_q.max_vcpu USING ERRCODE = 'CS002';
  END IF;
  IF p_q.used_ram_gb + p_ram_gb > p_q.max_ram_gb THEN
    RAISE EXCEPTION 'RAM quota exceeded for the % (using % GB, requesting % GB, limit % GB)',
      p_scope, p_q.used_ram_gb, p_ram_gb, p_q.max_ram_gb USING ERRCODE = 'CS002';
  END IF;
  IF p_q.used_vms + 1 > p_q.max_vms THEN
    RAISE EXCEPTION 'VM count quota exceeded for the % (using %, limit %)',
      p_scope, p_q.used_vms, p_q.max_vms USING ERRCODE = 'CS002';
  END IF;
  IF p_q.max_storage_gb IS NOT NULL AND p_q.used_storage_gb + p_storage_gb > p_q.max_storage_gb THEN
    RAISE EXCEPTION 'Storage quota exceeded for the % (using % GB, requesting % GB, limit % GB)',
      p_scope, p_q.used_storage_gb, p_storage_gb, p_q.max_storage_gb USING ERRCODE = 'CS002';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- allocate_resource: validate -> quota -> budget -> placement -> reserve -> create VM and root volume
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE allocate_resource(
  p_user_id            BIGINT,
  p_project_id         BIGINT,
  p_name               TEXT,
  p_vcpu               INTEGER,
  p_ram_gb             INTEGER,
  p_storage_gb         INTEGER,
  p_os_image           TEXT,
  p_volume_type        TEXT,
  p_region_id          BIGINT,    -- NULL = any region (lowest carbon wins, A1)
  p_max_hourly_budget  NUMERIC,   -- NULL = no per-request cap
  INOUT p_vm_id        BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org_id       BIGINT;
  v_org_status   TEXT;
  v_plan_id      BIGINT;
  v_proj_status  TEXT;
  v_budget       NUMERIC;
  v_cfg_id       BIGINT;
  v_os_family    TEXT;
  v_hourly       NUMERIC;
  v_new_monthly  NUMERIC;
  v_projected    NUMERIC;
  v_org_q        resource_quota%ROWTYPE;
  v_has_org_q    BOOLEAN;
  v_proj_q       resource_quota%ROWTYPE;
  v_candidates   BIGINT[];
  v_host_id      BIGINT;
  v_host_region  BIGINT;
  v_round        INTEGER;
BEGIN
  PERFORM set_config('cloudsphere.user_id', COALESCE(p_user_id::text, ''), true);
  p_name     := btrim(p_name);
  p_os_image := btrim(p_os_image);

  -- 1. Validate the request ---------------------------------------------------------------------------
  IF p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'VM name must be 1 to 100 characters' USING ERRCODE = 'CS003';
  END IF;
  IF p_os_image IS NULL OR char_length(p_os_image) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'OS image must be 1 to 100 characters' USING ERRCODE = 'CS003';
  END IF;
  IF p_vcpu IS NULL OR p_vcpu NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'vCPU must be between 1 and 512' USING ERRCODE = 'CS003';
  END IF;
  IF p_ram_gb IS NULL OR p_ram_gb NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'RAM must be between 1 and 4096 GB' USING ERRCODE = 'CS003';
  END IF;
  IF p_storage_gb IS NULL OR p_storage_gb NOT BETWEEN 1 AND 65536 THEN
    RAISE EXCEPTION 'Storage must be between 1 and 65536 GB' USING ERRCODE = 'CS003';
  END IF;
  IF p_volume_type IS NULL OR p_volume_type NOT IN ('SSD','HDD') THEN
    RAISE EXCEPTION 'Volume type must be SSD or HDD' USING ERRCODE = 'CS003';
  END IF;
  IF p_max_hourly_budget IS NOT NULL AND p_max_hourly_budget < 0 THEN
    RAISE EXCEPTION 'Hourly budget cannot be negative' USING ERRCODE = 'CS003';
  END IF;

  v_org_id := assert_project_access(p_user_id, p_project_id);   -- CS003 bad user / CS006 project not visible

  SELECT o.status, o.subscription_plan_id, pr.status, pr.monthly_budget
    INTO v_org_status, v_plan_id, v_proj_status, v_budget
    FROM project pr JOIN organization o ON o.organization_id = pr.organization_id
   WHERE pr.project_id = p_project_id;
  IF v_org_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Organization is not active' USING ERRCODE = 'CS003';
  END IF;
  IF v_proj_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Project is not active' USING ERRCODE = 'CS003';
  END IF;

  IF p_region_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cloud_region WHERE region_id = p_region_id AND is_active) THEN
    RAISE EXCEPTION 'Region not found or not active' USING ERRCODE = 'CS003';
  END IF;

  -- 2. Shared configuration row (D3): get or create ---------------------------------------------------
  v_os_family := CASE WHEN lower(p_os_image) LIKE 'windows%' THEN 'WINDOWS' ELSE 'LINUX' END;
  INSERT INTO vm_configuration (vcpu, ram_gb, os_family, os_image)
  VALUES (p_vcpu, p_ram_gb, v_os_family, p_os_image)
  ON CONFLICT (vcpu, ram_gb, os_image) DO NOTHING;
  SELECT vm_configuration_id INTO v_cfg_id
    FROM vm_configuration WHERE vcpu = p_vcpu AND ram_gb = p_ram_gb AND os_image = p_os_image;

  -- 3. Per-request hourly cap (A2) --------------------------------------------------------------------
  v_hourly := vm_hourly_compute_cost(v_plan_id, p_vcpu, p_ram_gb);
  IF p_max_hourly_budget IS NOT NULL AND v_hourly > p_max_hourly_budget THEN
    RAISE EXCEPTION 'Hourly cost % exceeds the requested hourly budget %',
      ROUND(v_hourly, 4), p_max_hourly_budget USING ERRCODE = 'CS005';
  END IF;

  -- 4. Lock quota rows (organization first, then project) and check headroom --------------------------
  SELECT * INTO v_org_q FROM resource_quota
   WHERE organization_id = v_org_id AND project_id IS NULL FOR UPDATE;
  v_has_org_q := FOUND;

  SELECT * INTO v_proj_q FROM resource_quota WHERE project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No quota is defined for this project' USING ERRCODE = 'CS002';
  END IF;

  IF v_has_org_q THEN
    PERFORM check_quota_headroom(v_org_q, p_vcpu, p_ram_gb, p_storage_gb, 'organization');
  END IF;
  PERFORM check_quota_headroom(v_proj_q, p_vcpu, p_ram_gb, p_storage_gb, 'project');

  -- 5. Monthly budget (A2). Serialised per project by the project quota lock taken above. -------------
  IF v_budget IS NOT NULL THEN
    v_new_monthly := ROUND(v_hourly * billing_hours_per_month(), 2) + storage_monthly_cost(v_plan_id, p_storage_gb);
    v_projected   := project_projected_monthly_cost(p_project_id) + v_new_monthly;
    IF v_projected > v_budget THEN
      RAISE EXCEPTION 'Projected monthly cost % would exceed the project budget %', v_projected, v_budget
        USING ERRCODE = 'CS005';
    END IF;
  END IF;

  -- 6. Placement (A1): up to 3 rounds. Pick candidates unlocked, lock them in ascending host_id, re-check.
  --    SKIP LOCKED is deliberately not used: it would report false "no capacity" under contention.
  FOR v_round IN 1..3 LOOP
    SELECT array_agg(c.host_id) INTO v_candidates FROM (
      SELECT h.host_id
        FROM cloud_host h
        JOIN cloud_region r ON r.region_id = h.region_id AND r.is_active
        LEFT JOIN carbon_profile cp ON cp.region_id = h.region_id AND cp.effective_to IS NULL
       WHERE h.status = 'ACTIVE'
         AND (p_region_id IS NULL OR h.region_id = p_region_id)
         AND h.free_cpu >= p_vcpu AND h.free_ram_gb >= p_ram_gb
       ORDER BY cp.carbon_intensity_gco2_kwh NULLS LAST, h.host_id
       LIMIT 5
    ) c;
    EXIT WHEN v_candidates IS NULL;

    PERFORM 1 FROM cloud_host WHERE host_id = ANY (v_candidates) ORDER BY host_id FOR UPDATE;

    -- Re-select among the now-locked candidates; their counters can no longer change under us.
    SELECT h.host_id, h.region_id INTO v_host_id, v_host_region
      FROM cloud_host h
      LEFT JOIN carbon_profile cp ON cp.region_id = h.region_id AND cp.effective_to IS NULL
     WHERE h.host_id = ANY (v_candidates)
       AND h.status = 'ACTIVE'
       AND h.free_cpu >= p_vcpu AND h.free_ram_gb >= p_ram_gb
     ORDER BY cp.carbon_intensity_gco2_kwh NULLS LAST, h.host_id
     LIMIT 1;
    EXIT WHEN FOUND;
  END LOOP;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Insufficient capacity: no active host has % vCPU and % GB RAM free%',
      p_vcpu, p_ram_gb,
      CASE WHEN p_region_id IS NULL THEN '' ELSE ' in the requested region' END
      USING ERRCODE = 'CS001';
  END IF;

  -- 7. Reserve ---------------------------------------------------------------------------------------
  UPDATE cloud_host
     SET allocated_cpu = allocated_cpu + p_vcpu, allocated_ram_gb = allocated_ram_gb + p_ram_gb
   WHERE host_id = v_host_id;

  UPDATE resource_quota
     SET used_vcpu = used_vcpu + p_vcpu, used_ram_gb = used_ram_gb + p_ram_gb,
         used_vms = used_vms + 1, used_storage_gb = used_storage_gb + p_storage_gb
   WHERE quota_id = v_proj_q.quota_id OR (v_has_org_q AND quota_id = v_org_q.quota_id);

  -- 8. Create the VM, its root volume and the allocation log entry (A4: REQUESTED is never written; A10: no IP)
  INSERT INTO virtual_machine (project_id, vm_configuration_id, host_id, name, state, created_by)
  VALUES (p_project_id, v_cfg_id, v_host_id, p_name, 'PROVISIONING', p_user_id)
  RETURNING vm_id INTO p_vm_id;

  INSERT INTO storage_volume (project_id, region_id, vm_id, name, size_gb, volume_type, is_root, state)
  VALUES (p_project_id, v_host_region, p_vm_id, p_name || '-root', p_storage_gb, p_volume_type, true, 'ATTACHED');

  INSERT INTO resource_allocation_log (vm_id, host_id, action, new_vm_configuration_id,
                                       vcpu_delta, ram_gb_delta, reason, performed_by)
  VALUES (p_vm_id, v_host_id, 'ALLOCATE', v_cfg_id, p_vcpu, p_ram_gb, 'VM allocated', p_user_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Releasing a reservation. terminate_vm, fail_provisioning and preempt_vm all go through this one function.
-- The active -> terminal transition can only happen once under the VM row lock, so resources are released exactly once.
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION release_active_vm(p_vm_id BIGINT, p_new_state TEXT, p_user_id BIGINT, p_action TEXT,
                                             p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_vm        virtual_machine%ROWTYPE;
  v_cfg       vm_configuration%ROWTYPE;
  v_org_id    BIGINT;
  v_root_gb   INTEGER;
  v_expected  TEXT;
  v_reason    TEXT;
BEGIN
  v_expected := CASE p_new_state
                  WHEN 'TERMINATED' THEN 'DEALLOCATE'
                  WHEN 'FAILED'     THEN 'PROVISION_FAILED'
                  WHEN 'PREEMPTED'  THEN 'PREEMPT'
                END;
  IF v_expected IS NULL OR p_action IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Invalid release request (% / %)', p_new_state, p_action USING ERRCODE = 'CS003';
  END IF;

  -- (1) the VM row
  SELECT * INTO v_vm FROM virtual_machine WHERE vm_id = p_vm_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VM not found' USING ERRCODE = 'CS006';
  END IF;

  IF v_vm.state NOT IN ('PROVISIONING','RUNNING','STOPPED') THEN
    RAISE EXCEPTION 'VM is % and holds no reservation to release', v_vm.state USING ERRCODE = 'CS004';
  END IF;
  IF p_new_state = 'FAILED' AND v_vm.state <> 'PROVISIONING' THEN
    RAISE EXCEPTION 'Only a PROVISIONING VM can fail provisioning (VM is %)', v_vm.state USING ERRCODE = 'CS004';
  END IF;
  IF p_new_state = 'PREEMPTED' AND (v_vm.state <> 'RUNNING' OR NOT v_vm.is_spot) THEN
    RAISE EXCEPTION 'Only a RUNNING spot VM can be preempted' USING ERRCODE = 'CS004';
  END IF;

  SELECT * INTO v_cfg FROM vm_configuration WHERE vm_configuration_id = v_vm.vm_configuration_id;
  SELECT organization_id INTO v_org_id FROM project WHERE project_id = v_vm.project_id;

  -- (2) quota rows: organization first, then project
  PERFORM 1 FROM resource_quota WHERE organization_id = v_org_id AND project_id IS NULL FOR UPDATE;
  PERFORM 1 FROM resource_quota WHERE project_id = v_vm.project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quota row missing for project %; cannot release reservation', v_vm.project_id;
  END IF;

  -- (3) the host row
  PERFORM 1 FROM cloud_host WHERE host_id = v_vm.host_id FOR UPDATE;

  -- Volumes: the root volume is deleted and its storage released; data volumes are detached and kept.
  UPDATE storage_volume SET state = 'DELETED', vm_id = NULL
   WHERE vm_id = p_vm_id AND is_root AND state <> 'DELETED'
   RETURNING size_gb INTO v_root_gb;
  v_root_gb := COALESCE(v_root_gb, 0);

  UPDATE storage_volume SET state = 'AVAILABLE', vm_id = NULL
   WHERE vm_id = p_vm_id AND NOT is_root;

  -- Counters
  UPDATE cloud_host
     SET allocated_cpu = allocated_cpu - v_cfg.vcpu, allocated_ram_gb = allocated_ram_gb - v_cfg.ram_gb
   WHERE host_id = v_vm.host_id;

  UPDATE resource_quota
     SET used_vcpu = used_vcpu - v_cfg.vcpu, used_ram_gb = used_ram_gb - v_cfg.ram_gb,
         used_vms = used_vms - 1, used_storage_gb = used_storage_gb - v_root_gb
   WHERE (project_id = v_vm.project_id) OR (organization_id = v_org_id AND project_id IS NULL);

  -- The VM keeps its host_id as history; the active-state partial indexes ignore it from here on.
  PERFORM set_config('cloudsphere.user_id', COALESCE(p_user_id::text, ''), true);
  UPDATE virtual_machine
     SET state = p_new_state, terminated_at = now(), load_balancer_id = NULL
   WHERE vm_id = p_vm_id;

  v_reason := COALESCE(p_reason, CASE p_new_state
                                   WHEN 'TERMINATED' THEN 'VM terminated'
                                   WHEN 'FAILED'     THEN 'Provisioning failed'
                                   WHEN 'PREEMPTED'  THEN 'Spot capacity reclaimed'
                                 END);
  INSERT INTO resource_allocation_log (vm_id, host_id, action, old_vm_configuration_id,
                                       vcpu_delta, ram_gb_delta, reason, performed_by)
  VALUES (p_vm_id, v_vm.host_id, p_action, v_vm.vm_configuration_id,
          -v_cfg.vcpu, -v_cfg.ram_gb, v_reason, p_user_id);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Lifecycle procedures (A6)
-- ---------------------------------------------------------------------------------------------------------------

-- Simulated provisioning finishing. System action (no user): the audit actor is NULL.
CREATE OR REPLACE PROCEDURE complete_provisioning(p_vm_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_state TEXT;
BEGIN
  PERFORM set_config('cloudsphere.user_id', '', true);
  SELECT state INTO v_state FROM virtual_machine WHERE vm_id = p_vm_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VM not found' USING ERRCODE = 'CS006';
  END IF;
  IF v_state <> 'PROVISIONING' THEN
    RAISE EXCEPTION 'VM is %; only a PROVISIONING VM can complete provisioning', v_state USING ERRCODE = 'CS004';
  END IF;
  UPDATE virtual_machine SET state = 'RUNNING', started_at = now(), stopped_at = NULL WHERE vm_id = p_vm_id;
END $$;

-- RUNNING -> STOPPED. D2-retain: host and quota counters do not change.
CREATE OR REPLACE PROCEDURE stop_vm(p_user_id BIGINT, p_vm_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_project BIGINT; v_state TEXT;
BEGIN
  PERFORM set_config('cloudsphere.user_id', COALESCE(p_user_id::text, ''), true);
  SELECT project_id INTO v_project FROM virtual_machine WHERE vm_id = p_vm_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VM not found' USING ERRCODE = 'CS006';
  END IF;
  PERFORM assert_project_access(p_user_id, v_project);

  SELECT state INTO v_state FROM virtual_machine WHERE vm_id = p_vm_id FOR UPDATE;
  IF v_state <> 'RUNNING' THEN
    RAISE EXCEPTION 'VM is %; only a RUNNING VM can be stopped', v_state USING ERRCODE = 'CS004';
  END IF;
  UPDATE virtual_machine SET state = 'STOPPED', stopped_at = now() WHERE vm_id = p_vm_id;
END $$;

-- STOPPED -> RUNNING on the retained host. D2-retain: no counter change; fails if that host cannot run VMs.
CREATE OR REPLACE PROCEDURE start_vm(p_user_id BIGINT, p_vm_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_project BIGINT; v_state TEXT; v_host BIGINT; v_host_status TEXT;
BEGIN
  PERFORM set_config('cloudsphere.user_id', COALESCE(p_user_id::text, ''), true);
  SELECT project_id INTO v_project FROM virtual_machine WHERE vm_id = p_vm_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VM not found' USING ERRCODE = 'CS006';
  END IF;
  PERFORM assert_project_access(p_user_id, v_project);

  SELECT state, host_id INTO v_state, v_host FROM virtual_machine WHERE vm_id = p_vm_id FOR UPDATE;
  IF v_state <> 'STOPPED' THEN
    RAISE EXCEPTION 'VM is %; only a STOPPED VM can be started', v_state USING ERRCODE = 'CS004';
  END IF;

  SELECT status INTO v_host_status FROM cloud_host WHERE host_id = v_host FOR SHARE;
  IF v_host_status IN ('MAINTENANCE','DECOMMISSIONED') THEN
    RAISE EXCEPTION 'The VM''s host is %; the VM cannot be started right now', v_host_status USING ERRCODE = 'CS001';
  END IF;

  UPDATE virtual_machine SET state = 'RUNNING', started_at = now(), stopped_at = NULL WHERE vm_id = p_vm_id;
END $$;

-- Any active state -> TERMINATED; releases the reservation exactly once.
CREATE OR REPLACE PROCEDURE terminate_vm(p_user_id BIGINT, p_vm_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_project BIGINT;
BEGIN
  SELECT project_id INTO v_project FROM virtual_machine WHERE vm_id = p_vm_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VM not found' USING ERRCODE = 'CS006';
  END IF;
  PERFORM assert_project_access(p_user_id, v_project);
  PERFORM release_active_vm(p_vm_id, 'TERMINATED', p_user_id, 'DEALLOCATE');
END $$;

-- PROVISIONING -> FAILED (simulated failure); releases the reservation. p_user_id NULL = system.
CREATE OR REPLACE PROCEDURE fail_provisioning(p_vm_id BIGINT, p_user_id BIGINT DEFAULT NULL, p_reason TEXT DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM release_active_vm(p_vm_id, 'FAILED', p_user_id, 'PROVISION_FAILED', p_reason);
END $$;

-- RUNNING spot VM -> PREEMPTED; releases the reservation. p_user_id NULL = system.
CREATE OR REPLACE PROCEDURE preempt_vm(p_vm_id BIGINT, p_user_id BIGINT DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM release_active_vm(p_vm_id, 'PREEMPTED', p_user_id, 'PREEMPT');
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------------------------

-- Audit every VM state change. The actor comes from the transaction-local setting the routines write.
CREATE OR REPLACE FUNCTION audit_vm_state_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (NULLIF(current_setting('cloudsphere.user_id', true), '')::BIGINT,
          'vm.state_change', 'virtual_machine', NEW.vm_id,
          jsonb_build_object('state', OLD.state),
          jsonb_build_object('state', NEW.state, 'host_id', NEW.host_id, 'project_id', NEW.project_id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vm_audit_state AFTER UPDATE OF state ON virtual_machine
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION audit_vm_state_change();

-- Queue a notification for every active admin when an allocation leaves a host below its low-capacity threshold.
-- The dedupe key (host, admin, UTC day) keeps this to one notification per host per admin per day.
CREATE OR REPLACE FUNCTION notify_host_low_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpu_pct NUMERIC; v_ram_pct NUMERIC;
BEGIN
  v_cpu_pct := ROUND((NEW.total_cpu - NEW.allocated_cpu) * 100.0 / NEW.total_cpu, 2);
  v_ram_pct := ROUND((NEW.total_ram_gb - NEW.allocated_ram_gb) * 100.0 / NEW.total_ram_gb, 2);
  IF v_cpu_pct < NEW.low_capacity_threshold_pct OR v_ram_pct < NEW.low_capacity_threshold_pct THEN
    INSERT INTO notification_queue (user_id, notification_type, title, payload, dedupe_key)
    SELECT u.user_id, 'HOST_LOW_CAPACITY', format('Host %s is low on capacity', NEW.hostname),
           jsonb_build_object('host_id', NEW.host_id, 'hostname', NEW.hostname,
                              'free_cpu_pct', v_cpu_pct, 'free_ram_pct', v_ram_pct,
                              'threshold_pct', NEW.low_capacity_threshold_pct),
           format('host-low-capacity:%s:%s:%s', NEW.host_id, u.user_id,
                  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
      FROM app_user u WHERE u.role = 'admin' AND u.is_active
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_host_low_capacity AFTER UPDATE OF allocated_cpu, allocated_ram_gb ON cloud_host
  FOR EACH ROW WHEN (NEW.allocated_cpu > OLD.allocated_cpu OR NEW.allocated_ram_gb > OLD.allocated_ram_gb)
  EXECUTE FUNCTION notify_host_low_capacity();
