-- 0008: privilege hardening for the API role (A7)
--
-- The API connects as cloudsphere_app. Capacity and quota counters, VM rows and their state may only change
-- through the SECURITY DEFINER routines in 0007, which run as the schema owner (cloudsphere_migrator).
-- Column-level REVOKE does not override a table-level grant, so table privileges are revoked first and the
-- permitted columns are granted back afterwards.

-- cloud_host: the app may change status and the low-capacity threshold, and register new hosts with zero allocation.
REVOKE UPDATE, DELETE ON cloud_host FROM cloudsphere_app;
REVOKE INSERT ON cloud_host FROM cloudsphere_app;
GRANT UPDATE (status, low_capacity_threshold_pct) ON cloud_host TO cloudsphere_app;
GRANT INSERT (region_id, hostname, total_cpu, total_ram_gb, status, low_capacity_threshold_pct)
  ON cloud_host TO cloudsphere_app;

-- resource_quota: the app may set limits, never usage counters.
REVOKE UPDATE, DELETE ON resource_quota FROM cloudsphere_app;
REVOKE INSERT ON resource_quota FROM cloudsphere_app;
GRANT UPDATE (max_vcpu, max_ram_gb, max_vms, max_storage_gb) ON resource_quota TO cloudsphere_app;
GRANT INSERT (organization_id, project_id, max_vcpu, max_ram_gb, max_vms, max_storage_gb)
  ON resource_quota TO cloudsphere_app;

-- virtual_machine: created and moved between states only by the routines; the app may rename.
REVOKE INSERT, UPDATE, DELETE ON virtual_machine FROM cloudsphere_app;
GRANT UPDATE (name) ON virtual_machine TO cloudsphere_app;

-- audit_log is append-only for the app.
REVOKE UPDATE, DELETE ON audit_log FROM cloudsphere_app;

-- The migration bookkeeping table is not the API's business.
REVOKE ALL ON schema_migrations FROM cloudsphere_app;

-- Routines: nothing is executable by PUBLIC. Extension functions (pgcrypto's crypt/gen_salt, used for login) keep
-- their grants; only functions and procedures defined by our own migrations are revoked.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                          AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;

-- Future routines created by the migrator are not executable by PUBLIC either.
ALTER DEFAULT PRIVILEGES FOR ROLE cloudsphere_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The API may call the lifecycle procedures and the read-only pricing functions.
-- Not granted: release_active_vm, assert_project_access, check_quota_headroom (internal helpers),
-- drop_expired_monitoring_partitions (destroys data; run by the migrator role only).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('allocate_resource','complete_provisioning','stop_vm','start_vm','terminate_vm',
                         'fail_provisioning','preempt_vm',
                         'estimate_vm_cost','project_projected_monthly_cost','vm_hourly_compute_cost',
                         'storage_monthly_cost','billing_hours_per_month',
                         'ensure_monitoring_partitions')
  LOOP
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO cloudsphere_app', r.sig);
  END LOOP;
END $$;
