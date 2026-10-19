-- 0002: subscription plans, regions, organizations, users, projects

CREATE TABLE subscription_plan (
  plan_id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                       TEXT          NOT NULL UNIQUE,
  monthly_fee                NUMERIC(12,2) NOT NULL CHECK (monthly_fee >= 0),
  price_per_vcpu_hour        NUMERIC(12,4) NOT NULL CHECK (price_per_vcpu_hour >= 0),
  price_per_gb_ram_hour      NUMERIC(12,4) NOT NULL CHECK (price_per_gb_ram_hour >= 0),
  price_per_gb_storage_month NUMERIC(12,4) NOT NULL CHECK (price_per_gb_storage_month >= 0),
  sla_uptime_target_pct      NUMERIC(6,3)  NOT NULL CHECK (sla_uptime_target_pct > 0 AND sla_uptime_target_pct <= 100),
  default_max_vcpu           INTEGER       NOT NULL CHECK (default_max_vcpu > 0),
  default_max_ram_gb         INTEGER       NOT NULL CHECK (default_max_ram_gb > 0),
  default_max_vms            INTEGER       NOT NULL CHECK (default_max_vms > 0),
  is_active                  BOOLEAN       NOT NULL DEFAULT true,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE cloud_region (
  region_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  country    TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization (
  organization_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 TEXT   NOT NULL UNIQUE,
  subscription_plan_id BIGINT NOT NULL REFERENCES subscription_plan(plan_id),
  billing_email        TEXT   NOT NULL,
  status               TEXT   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX organization_plan_idx ON organization (subscription_plan_id);

CREATE TABLE app_user (
  user_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT REFERENCES organization(organization_id),
  email           TEXT    NOT NULL,
  password_hash   TEXT    NOT NULL,
  full_name       TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('customer','admin')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_user_org_required CHECK (role = 'admin' OR organization_id IS NOT NULL)
);
CREATE UNIQUE INDEX app_user_email_lower_uq ON app_user (lower(email));
CREATE INDEX app_user_org_idx ON app_user (organization_id);

CREATE TABLE project (
  project_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organization(organization_id),
  name            TEXT   NOT NULL,
  description     TEXT,
  status          TEXT   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  monthly_budget  NUMERIC(12,2) CHECK (monthly_budget IS NULL OR monthly_budget >= 0),
  created_by      BIGINT REFERENCES app_user(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE INDEX project_created_by_idx ON project (created_by);

CREATE TRIGGER trg_subscription_plan_updated BEFORE UPDATE ON subscription_plan FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cloud_region_updated      BEFORE UPDATE ON cloud_region      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_organization_updated      BEFORE UPDATE ON organization      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_user_updated          BEFORE UPDATE ON app_user          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_project_updated           BEFORE UPDATE ON project           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
