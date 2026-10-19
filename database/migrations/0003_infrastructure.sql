-- 0003: carbon profiles, hosts, VM configurations, networks, firewall, load balancers

CREATE TABLE carbon_profile (
  carbon_profile_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region_id                  BIGINT        NOT NULL REFERENCES cloud_region(region_id),
  version                    INTEGER       NOT NULL CHECK (version >= 1),
  carbon_intensity_gco2_kwh  NUMERIC(8,2)  NOT NULL CHECK (carbon_intensity_gco2_kwh >= 0),
  effective_from             TIMESTAMPTZ   NOT NULL,
  effective_to               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (region_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX carbon_profile_current_uq ON carbon_profile (region_id) WHERE effective_to IS NULL;

CREATE TABLE cloud_host (
  host_id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region_id                  BIGINT  NOT NULL REFERENCES cloud_region(region_id),
  hostname                   TEXT    NOT NULL UNIQUE,
  total_cpu                  INTEGER NOT NULL CHECK (total_cpu > 0),
  total_ram_gb               INTEGER NOT NULL CHECK (total_ram_gb > 0),
  allocated_cpu              INTEGER NOT NULL DEFAULT 0,
  allocated_ram_gb           INTEGER NOT NULL DEFAULT 0,
  free_cpu                   INTEGER GENERATED ALWAYS AS (total_cpu - allocated_cpu) STORED,
  free_ram_gb                INTEGER GENERATED ALWAYS AS (total_ram_gb - allocated_ram_gb) STORED,
  status                     TEXT    NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','DRAINING','MAINTENANCE','DECOMMISSIONED')),
  low_capacity_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (low_capacity_threshold_pct BETWEEN 0 AND 100),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- database-enforced oversubscription guards
  CONSTRAINT cloud_host_cpu_cap CHECK (allocated_cpu BETWEEN 0 AND total_cpu),
  CONSTRAINT cloud_host_ram_cap CHECK (allocated_ram_gb BETWEEN 0 AND total_ram_gb)
);
-- Matches the allocation query: ACTIVE hosts in a region with enough free CPU/RAM
CREATE INDEX cloud_host_selection_idx ON cloud_host (region_id, free_cpu, free_ram_gb) WHERE status = 'ACTIVE';

CREATE TABLE vm_configuration (
  vm_configuration_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                TEXT,
  vcpu                INTEGER NOT NULL CHECK (vcpu > 0),
  ram_gb              INTEGER NOT NULL CHECK (ram_gb > 0),
  os_family           TEXT    NOT NULL CHECK (os_family IN ('LINUX','WINDOWS')),
  os_image            TEXT    NOT NULL,
  is_catalog          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vcpu, ram_gb, os_image)
);

CREATE TABLE virtual_network (
  virtual_network_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id         BIGINT NOT NULL REFERENCES project(project_id),
  region_id          BIGINT NOT NULL REFERENCES cloud_region(region_id),
  parent_network_id  BIGINT REFERENCES virtual_network(virtual_network_id),
  name               TEXT   NOT NULL,
  cidr_block         CIDR   NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name),
  CHECK (parent_network_id IS NULL OR parent_network_id <> virtual_network_id)
);
CREATE INDEX virtual_network_parent_idx ON virtual_network (parent_network_id);
CREATE INDEX virtual_network_region_idx ON virtual_network (region_id);

-- A subnet must lie inside its parent network and belong to the same project
CREATE OR REPLACE FUNCTION check_subnet_in_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent virtual_network%ROWTYPE;
BEGIN
  IF NEW.parent_network_id IS NOT NULL THEN
    SELECT * INTO parent FROM virtual_network WHERE virtual_network_id = NEW.parent_network_id;
    IF parent.project_id <> NEW.project_id OR NOT (parent.cidr_block >>= NEW.cidr_block) THEN
      RAISE EXCEPTION 'Subnet % must be inside its parent network % and the same project', NEW.cidr_block, parent.cidr_block
        USING ERRCODE = 'CS003';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_virtual_network_subnet BEFORE INSERT OR UPDATE OF cidr_block, parent_network_id ON virtual_network
  FOR EACH ROW EXECUTE FUNCTION check_subnet_in_parent();
CREATE TRIGGER trg_virtual_network_updated BEFORE UPDATE ON virtual_network FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE firewall_rule (
  firewall_rule_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  virtual_network_id BIGINT NOT NULL REFERENCES virtual_network(virtual_network_id),
  direction          TEXT   NOT NULL CHECK (direction IN ('INGRESS','EGRESS')),
  action             TEXT   NOT NULL CHECK (action IN ('ALLOW','DENY')),
  protocol           TEXT   NOT NULL CHECK (protocol IN ('TCP','UDP','ICMP','ANY')),
  port_from          INTEGER CHECK (port_from BETWEEN 0 AND 65535),
  port_to            INTEGER CHECK (port_to BETWEEN 0 AND 65535),
  remote_cidr        CIDR   NOT NULL,
  priority           INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 65535),
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (virtual_network_id, direction, priority),
  CHECK ((port_from IS NULL) = (port_to IS NULL)),
  CHECK (port_from IS NULL OR port_from <= port_to),
  CHECK (protocol IN ('TCP','UDP') OR port_from IS NULL)
);

CREATE TABLE load_balancer (
  load_balancer_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id         BIGINT NOT NULL REFERENCES project(project_id),
  virtual_network_id BIGINT NOT NULL REFERENCES virtual_network(virtual_network_id),
  name               TEXT   NOT NULL,
  algorithm          TEXT   NOT NULL DEFAULT 'ROUND_ROBIN' CHECK (algorithm IN ('ROUND_ROBIN','LEAST_CONNECTIONS')),
  listener_protocol  TEXT   NOT NULL DEFAULT 'HTTP' CHECK (listener_protocol IN ('HTTP','HTTPS','TCP')),
  listener_port      INTEGER NOT NULL DEFAULT 80 CHECK (listener_port BETWEEN 1 AND 65535),
  status             TEXT   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE INDEX load_balancer_network_idx ON load_balancer (virtual_network_id);

CREATE TRIGGER trg_cloud_host_updated   BEFORE UPDATE ON cloud_host   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_load_balancer_updated BEFORE UPDATE ON load_balancer FOR EACH ROW EXECUTE FUNCTION set_updated_at();
