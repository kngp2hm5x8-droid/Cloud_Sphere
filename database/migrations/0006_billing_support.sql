-- 0006: billing, payments, support, feedback, audit, notifications, recommendations, SLA

CREATE TABLE billing_invoice (
  invoice_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organization(organization_id),
  project_id      BIGINT REFERENCES project(project_id),   -- NULL for subscription invoices
  invoice_type    TEXT   NOT NULL CHECK (invoice_type IN ('SUBSCRIPTION','USAGE')),
  period_start    DATE   NOT NULL,
  period_end      DATE   NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  usage_breakdown JSONB,
  status          TEXT   NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PAID','OVERDUE','VOID')),
  issued_at       TIMESTAMPTZ,
  due_date        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (total_amount = subtotal + tax_amount),
  CHECK ((invoice_type = 'USAGE') = (project_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (organization_id, project_id, invoice_type, period_start, period_end)
);
CREATE INDEX billing_invoice_project_idx ON billing_invoice (project_id);
CREATE TRIGGER trg_billing_invoice_updated BEFORE UPDATE ON billing_invoice FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment (
  payment_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id      BIGINT NOT NULL REFERENCES billing_invoice(invoice_id),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method          TEXT   NOT NULL CHECK (method IN ('SIMULATED_CARD','SIMULATED_UPI','SIMULATED_BANK')),
  status          TEXT   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  transaction_ref TEXT   NOT NULL UNIQUE,    -- generated token; no card/bank data is ever stored
  paid_at         TIMESTAMPTZ,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_invoice_idx ON payment (invoice_id);

CREATE TABLE support_ticket (
  ticket_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by  BIGINT NOT NULL REFERENCES app_user(user_id),
  assigned_to BIGINT REFERENCES app_user(user_id),
  project_id  BIGINT REFERENCES project(project_id),
  vm_id       BIGINT REFERENCES virtual_machine(vm_id),
  subject     TEXT   NOT NULL,
  description TEXT   NOT NULL,
  priority    TEXT   NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status      TEXT   NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('RESOLVED','CLOSED') OR resolved_at IS NOT NULL)
);
CREATE INDEX support_ticket_creator_idx ON support_ticket (created_by);
CREATE INDEX support_ticket_project_idx ON support_ticket (project_id);
CREATE TRIGGER trg_support_ticket_updated BEFORE UPDATE ON support_ticket FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_feedback (
  feedback_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_user(user_id),
  ticket_id   BIGINT REFERENCES support_ticket(ticket_id),
  project_id  BIGINT REFERENCES project(project_id),
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_feedback_ticket_uq ON customer_feedback (ticket_id, user_id) WHERE ticket_id IS NOT NULL;

CREATE TABLE audit_log (
  audit_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id BIGINT REFERENCES app_user(user_id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     BIGINT,          -- polymorphic reference, deliberately no FK
  old_values    JSONB,
  new_values    JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_user_id, created_at DESC);

CREATE TABLE notification_queue (
  notification_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES app_user(user_id),
  notification_type TEXT   NOT NULL,
  title             TEXT   NOT NULL,
  payload           JSONB,
  dedupe_key        TEXT   UNIQUE,
  status            TEXT   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  read_at           TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_user_idx ON notification_queue (user_id, created_at DESC);
CREATE INDEX notification_unread_idx ON notification_queue (user_id) WHERE read_at IS NULL;
CREATE INDEX notification_pending_idx ON notification_queue (created_at) WHERE status = 'PENDING';

CREATE TABLE recommendation_log (
  recommendation_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vm_id                           BIGINT NOT NULL REFERENCES virtual_machine(vm_id),
  recommendation_type             TEXT   NOT NULL CHECK (recommendation_type IN
                                    ('SCALE_UP','SCALE_DOWN','TERMINATE_IDLE','RIGHTSIZE','COST_SAVING')),
  rule_code                       TEXT   NOT NULL,
  trigger_metrics                 JSONB  NOT NULL,
  window_start                    TIMESTAMPTZ NOT NULL,
  window_end                      TIMESTAMPTZ NOT NULL,
  recommended_vm_configuration_id BIGINT REFERENCES vm_configuration(vm_configuration_id),
  estimated_monthly_saving        NUMERIC(12,2),
  status                          TEXT   NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','EXPIRED')),
  responded_by                    BIGINT REFERENCES app_user(user_id),
  responded_at                    TIMESTAMPTZ,
  outcome                         TEXT   CHECK (outcome IN ('CORRECT','INCORRECT','INCONCLUSIVE')),
  outcome_notes                   TEXT,
  reviewed_at                     TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);
CREATE INDEX recommendation_vm_idx ON recommendation_log (vm_id, created_at DESC);
CREATE INDEX recommendation_pending_idx ON recommendation_log (vm_id) WHERE status = 'PENDING';

CREATE TABLE sla_record (
  sla_record_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vm_id                BIGINT NOT NULL REFERENCES virtual_machine(vm_id),
  subscription_plan_id BIGINT NOT NULL REFERENCES subscription_plan(plan_id),
  period_start         TIMESTAMPTZ NOT NULL,
  period_end           TIMESTAMPTZ NOT NULL,
  target_uptime_pct    NUMERIC(6,3) NOT NULL,      -- snapshot of the plan target at evaluation time
  measured_uptime_pct  NUMERIC(6,3) NOT NULL,
  expected_samples     INTEGER NOT NULL CHECK (expected_samples >= 0),
  received_samples     INTEGER NOT NULL CHECK (received_samples >= 0),
  downtime_minutes     NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_breach            BOOLEAN GENERATED ALWAYS AS (measured_uptime_pct < target_uptime_pct) STORED,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  UNIQUE (vm_id, period_start, period_end)
);
CREATE INDEX sla_record_plan_idx ON sla_record (subscription_plan_id);
