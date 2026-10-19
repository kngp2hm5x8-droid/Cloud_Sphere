-- 0004: quotas, VMs, storage, snapshots, allocation history, spot requests
-- D2 (confirmed): a STOPPED VM RETAINS its host assignment and CPU/RAM/quota reservation.

CREATE TABLE resource_quota (
  quota_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  BIGINT  NOT NULL REFERENCES organization(organization_id),
  project_id       BIGINT  REFERENCES project(project_id),   -- NULL = organization-level limit
  max_vcpu         INTEGER NOT NULL CHECK (max_vcpu >= 0),
  max_ram_gb       INTEGER NOT NULL CHECK (max_ram_gb >= 0),
  max_vms          INTEGER NOT NULL CHECK (max_vms >= 0),
  max_storage_gb   INTEGER CHECK (max_storage_gb IS NULL OR max_storage_gb >= 0), -- NULL = unlimited
  used_vcpu        INTEGER NOT NULL DEFAULT 0 CHECK (used_vcpu >= 0),
  used_ram_gb      INTEGER NOT NULL DEFAULT 0 CHECK (used_ram_gb >= 0),
  used_vms         INTEGER NOT NULL DEFAULT 0 CHECK (used_vms >= 0),
  used_storage_gb  INTEGER NOT NULL DEFAULT 0 CHECK (used_storage_gb >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quota_vcpu_cap    CHECK (used_vcpu <= max_vcpu),
  CONSTRAINT quota_ram_cap     CHECK (used_ram_gb <= max_ram_gb),
  CONSTRAINT quota_vms_cap     CHECK (used_vms <= max_vms),
  CONSTRAINT quota_storage_cap CHECK (max_storage_gb IS NULL OR used_storage_gb <= max_storage_gb)
);
CREATE UNIQUE INDEX resource_quota_project_uq ON resource_quota (project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX resource_quota_org_uq     ON resource_quota (organization_id) WHERE project_id IS NULL;
CREATE TRIGGER trg_resource_quota_updated BEFORE UPDATE ON resource_quota FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every project gets a quota row from its organization's plan defaults (allocation denies projects without one).
CREATE OR REPLACE FUNCTION create_default_project_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO resource_quota (organization_id, project_id, max_vcpu, max_ram_gb, max_vms)
  SELECT NEW.organization_id, NEW.project_id, p.default_max_vcpu, p.default_max_ram_gb, p.default_max_vms
  FROM organization o JOIN subscription_plan p ON p.plan_id = o.subscription_plan_id
  WHERE o.organization_id = NEW.organization_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_project_default_quota AFTER INSERT ON project FOR EACH ROW EXECUTE FUNCTION create_default_project_quota();

CREATE TABLE virtual_machine (
  vm_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id          BIGINT NOT NULL REFERENCES project(project_id),
  vm_configuration_id BIGINT NOT NULL REFERENCES vm_configuration(vm_configuration_id),
  host_id             BIGINT REFERENCES cloud_host(host_id),
  name                TEXT   NOT NULL,
  state               TEXT   NOT NULL CHECK (state IN
                        ('REQUESTED','PROVISIONING','RUNNING','STOPPED','TERMINATED','PREEMPTED','FAILED')),
  is_spot             BOOLEAN NOT NULL DEFAULT false,
  subnet_id           BIGINT REFERENCES virtual_network(virtual_network_id),
  private_ip          INET,
  load_balancer_id    BIGINT REFERENCES load_balancer(load_balancer_id),
  created_by          BIGINT REFERENCES app_user(user_id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  stopped_at          TIMESTAMPTZ,
  terminated_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a VM holds a host (and reservation) in every active state, including STOPPED
  CONSTRAINT vm_active_has_host CHECK (host_id IS NOT NULL OR state NOT IN ('PROVISIONING','RUNNING','STOPPED')),
  CONSTRAINT vm_subnet_ip_pair  CHECK ((subnet_id IS NULL) = (private_ip IS NULL))
);
CREATE UNIQUE INDEX vm_name_active_uq ON virtual_machine (project_id, name)
  WHERE state NOT IN ('TERMINATED','PREEMPTED','FAILED');
CREATE UNIQUE INDEX vm_ip_active_uq ON virtual_machine (subnet_id, private_ip)
  WHERE subnet_id IS NOT NULL AND state NOT IN ('TERMINATED','PREEMPTED','FAILED');
CREATE INDEX vm_project_state_idx ON virtual_machine (project_id, state);
CREATE INDEX vm_host_active_idx   ON virtual_machine (host_id) WHERE state IN ('PROVISIONING','RUNNING','STOPPED');
CREATE INDEX vm_config_idx        ON virtual_machine (vm_configuration_id);
CREATE INDEX vm_lb_idx            ON virtual_machine (load_balancer_id) WHERE load_balancer_id IS NOT NULL;
CREATE TRIGGER trg_vm_updated BEFORE UPDATE ON virtual_machine FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Valid state machine (defence in depth: the lifecycle routines also validate)
CREATE OR REPLACE FUNCTION enforce_vm_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.state = 'REQUESTED'    AND NEW.state IN ('PROVISIONING','TERMINATED'))
    OR (OLD.state = 'PROVISIONING' AND NEW.state IN ('RUNNING','FAILED','TERMINATED'))
    OR (OLD.state = 'RUNNING'      AND (NEW.state IN ('STOPPED','TERMINATED') OR (NEW.state = 'PREEMPTED' AND OLD.is_spot)))
    OR (OLD.state = 'STOPPED'      AND NEW.state IN ('RUNNING','TERMINATED'))
  ) THEN
    RAISE EXCEPTION 'Invalid VM state transition % -> %', OLD.state, NEW.state USING ERRCODE = 'CS004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vm_state_transition BEFORE UPDATE OF state ON virtual_machine
  FOR EACH ROW EXECUTE FUNCTION enforce_vm_state_transition();

CREATE TABLE storage_volume (
  volume_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES project(project_id),
  region_id   BIGINT NOT NULL REFERENCES cloud_region(region_id),
  vm_id       BIGINT REFERENCES virtual_machine(vm_id),
  name        TEXT   NOT NULL,
  size_gb     INTEGER NOT NULL CHECK (size_gb > 0),
  used_gb     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (used_gb >= 0),
  volume_type TEXT   NOT NULL CHECK (volume_type IN ('SSD','HDD')),
  is_root     BOOLEAN NOT NULL DEFAULT false,
  state       TEXT   NOT NULL DEFAULT 'AVAILABLE' CHECK (state IN ('AVAILABLE','ATTACHED','DELETED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used_gb <= size_gb),
  CHECK ((state = 'ATTACHED') = (vm_id IS NOT NULL))
);
CREATE UNIQUE INDEX storage_volume_name_uq ON storage_volume (project_id, name) WHERE state <> 'DELETED';
CREATE UNIQUE INDEX storage_volume_root_uq ON storage_volume (vm_id) WHERE is_root AND vm_id IS NOT NULL;
CREATE INDEX storage_volume_vm_idx ON storage_volume (vm_id);
CREATE INDEX storage_volume_project_idx ON storage_volume (project_id);
CREATE TRIGGER trg_storage_volume_updated BEFORE UPDATE ON storage_volume FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backup_snapshot (
  snapshot_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  volume_id      BIGINT NOT NULL REFERENCES storage_volume(volume_id),
  name           TEXT   NOT NULL,
  status         TEXT   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED','EXPIRED','DELETED')),
  size_gb        NUMERIC(10,2) CHECK (size_gb IS NULL OR size_gb >= 0),
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_by     BIGINT REFERENCES app_user(user_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > taken_at)
);
CREATE INDEX backup_snapshot_volume_idx ON backup_snapshot (volume_id, status);
CREATE INDEX backup_snapshot_expiry_idx ON backup_snapshot (expires_at) WHERE status = 'COMPLETED';

CREATE TABLE resource_allocation_log (
  allocation_log_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vm_id                   BIGINT NOT NULL REFERENCES virtual_machine(vm_id),
  host_id                 BIGINT REFERENCES cloud_host(host_id),
  action                  TEXT   NOT NULL CHECK (action IN ('ALLOCATE','SCALE_UP','SCALE_DOWN','DEALLOCATE','PREEMPT','PROVISION_FAILED')),
  old_vm_configuration_id BIGINT REFERENCES vm_configuration(vm_configuration_id),
  new_vm_configuration_id BIGINT REFERENCES vm_configuration(vm_configuration_id),
  vcpu_delta              INTEGER NOT NULL,
  ram_gb_delta            INTEGER NOT NULL,
  reason                  TEXT,
  performed_by            BIGINT REFERENCES app_user(user_id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX allocation_log_vm_idx   ON resource_allocation_log (vm_id, created_at);
CREATE INDEX allocation_log_host_idx ON resource_allocation_log (host_id);

CREATE TABLE spot_bid_request (
  bid_id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id               BIGINT NOT NULL REFERENCES project(project_id),
  requested_by             BIGINT NOT NULL REFERENCES app_user(user_id),
  vm_configuration_id      BIGINT NOT NULL REFERENCES vm_configuration(vm_configuration_id),
  region_id                BIGINT REFERENCES cloud_region(region_id),
  max_price_per_hour       NUMERIC(12,4) NOT NULL CHECK (max_price_per_hour > 0),
  status                   TEXT NOT NULL DEFAULT 'OPEN'
                           CHECK (status IN ('OPEN','FULFILLED','PREEMPTED','CANCELLED','EXPIRED','REJECTED')),
  fulfilled_vm_id          BIGINT UNIQUE REFERENCES virtual_machine(vm_id),
  fulfilled_price_per_hour NUMERIC(12,4),
  expires_at               TIMESTAMPTZ,
  fulfilled_at             TIMESTAMPTZ,
  preempted_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX spot_bid_project_idx ON spot_bid_request (project_id, status);
CREATE TRIGGER trg_spot_bid_updated BEFORE UPDATE ON spot_bid_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
