# CloudSphere Database Systems Demo

This guide presents the existing PostgreSQL design behind the CloudSphere demo. It uses the current migrations `0001`–`0008` and demo data; it does not require schema changes. Run the SQL snippets in pgAdmin against the **development** `cloudsphere` database using a read-only or application-role connection where possible.

## 1. Normalized relational model

Explain that organizations own projects, projects reference reusable VM configurations, and monitoring samples reference VMs. The API joins these relations when it needs a combined view instead of copying organization, project, configuration, and metric fields into one large table.

Show the foreign-key relationships:

```sql
SELECT conrelid::regclass AS child_table,
       conname AS constraint_name,
       pg_get_constraintdef(oid) AS relationship
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN ('project', 'virtual_machine', 'monitoring_log')
ORDER BY 1, 2;
```

Then show a real join used to assemble a VM view:

```sql
SELECT p.name AS project, vm.name AS virtual_machine, vm.state,
       c.vcpu, c.ram_gb, c.os_image
FROM virtual_machine vm
JOIN project p USING (project_id)
JOIN vm_configuration c USING (vm_configuration_id)
ORDER BY p.name, vm.name;
```

## 2. Integrity constraints

Database constraints protect valid states even if a caller bypasses frontend validation. Inspect examples without attempting to write invalid rows:

```sql
SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN ('virtual_machine', 'cloud_host', 'resource_quota', 'storage_volume')
ORDER BY 1, 2;
```

Examples include host capacity checks, VM state checks, storage bounds, foreign keys, and the rule that active VMs must have a host. Partial unique indexes also prevent duplicate active VM names while allowing a terminated VM name to be reused. The allocator and lifecycle tests exercise rollback and rejection behavior.

## 3. Stored procedures and transaction safety

In the browser, estimate and create a VM through the normal wizard. The backend delegates allocation to `allocate_resource` and completion to `complete_provisioning`; PostgreSQL reserves host and quota capacity, creates related rows, and records the allocation. Use **Estimate cost** for a read-only database function example:

```sql
SELECT * FROM estimate_vm_cost(1, 2, 4, 30);
```

Replace `1` with a project ID in the demo database if needed. VM creation, stop, start, and termination are writes; use the UI and a clearly named demo VM rather than running ad-hoc write SQL.

## 4. Concurrency control

The allocation procedure locks quota and candidate host rows while checking and updating counters. This prevents two concurrent requests from reserving the same remaining capacity. The lifecycle procedures use row locks and perform counter release in the same transaction.

The automated demonstrations use separate database connections and verify exact outcomes, no host oversubscription, no counter drift, and single-release semantics. Run these only with the isolated `cloudsphere_test` database configured in the backend `.env`:

```sh
cd backend
node --test tests/concurrency.test.js
```

The test helpers refuse to reset a database whose name does not end in `_test`.

## 5. Indexes and query plans

Inspect indexes created by the migrations:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('virtual_machine', 'cloud_host', 'monitoring_log', 'resource_quota')
ORDER BY tablename, indexname;
```

Examples include `(project_id, state)` for VM filtering, an active-host selection index, and the monitoring primary key `(vm_id, logged_at)`. Ask PostgreSQL to display its plan for a common VM lookup:

```sql
EXPLAIN (COSTS OFF)
SELECT vm_id, name, state
FROM virtual_machine
WHERE project_id = 1 AND state = 'RUNNING';
```

At demo scale the planner may prefer a sequential scan; explain that PostgreSQL chooses a plan using table statistics and estimated cost. This is a plan inspection, not a performance benchmark.

## 6. Monitoring partitioning

`monitoring_log` is range-partitioned by timestamp into monthly UTC partitions. Show the existing child partitions:

```sql
SELECT child.relname AS partition_name
FROM pg_inherits i
JOIN pg_class parent ON parent.oid = i.inhparent
JOIN pg_class child ON child.oid = i.inhrelid
WHERE parent.oid = 'monitoring_log'::regclass
ORDER BY child.relname;
```

Then inspect the plan for one month of data:

```sql
EXPLAIN (COSTS OFF)
SELECT vm_id, logged_at, cpu_pct
FROM monitoring_log
WHERE logged_at >= date_trunc('month', now())
  AND logged_at < date_trunc('month', now()) + interval '1 month';
```

The partition test verifies that a one-month range plan scans only the matching partition. Retention maintenance removes whole expired partitions and is reserved for the migration role.

## 7. Database privileges

The API role cannot directly change allocator-owned counters or VM lifecycle state. It calls narrowly granted `SECURITY DEFINER` procedures owned by `cloudsphere_migrator`. These read-only checks show the column-level boundary:

```sql
SELECT has_column_privilege('cloudsphere_app', 'cloud_host', 'allocated_cpu', 'UPDATE') AS can_edit_host_counter,
       has_column_privilege('cloudsphere_app', 'resource_quota', 'used_vms', 'UPDATE') AS can_edit_quota_counter,
       has_column_privilege('cloudsphere_app', 'virtual_machine', 'state', 'UPDATE') AS can_edit_vm_state,
       has_column_privilege('cloudsphere_app', 'virtual_machine', 'name', 'UPDATE') AS can_rename_vm;
```

Expected results are `false`, `false`, `false`, and `true`, respectively. The API role can execute the public VM lifecycle/allocation procedures, while internal helpers, migration metadata, and destructive partition-retention routines are restricted. `node --test tests/privileges.test.js` verifies these rights in the isolated test database.

## Supporting test suites

The existing backend tests provide reproducible evidence for allocation invariants, SQL routines, concurrency, partitioning, grants, and seed reconciliation. Run the full suite with `npm test` from `backend/` after configuring both test database URLs. It truncates and rebuilds only the dedicated `_test` database; do not point test variables at the development database.
