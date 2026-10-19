-- 0005: monthly range-partitioned monitoring_log (D10) and partition maintenance
-- Partitioning is created from the start; an existing table cannot be converted in place.

CREATE TABLE monitoring_log (
  vm_id        BIGINT       NOT NULL REFERENCES virtual_machine(vm_id),
  logged_at    TIMESTAMPTZ  NOT NULL,
  cpu_pct      NUMERIC(5,2) NOT NULL CHECK (cpu_pct  BETWEEN 0 AND 100),
  ram_pct      NUMERIC(5,2) NOT NULL CHECK (ram_pct  BETWEEN 0 AND 100),
  disk_pct     NUMERIC(5,2) NOT NULL CHECK (disk_pct BETWEEN 0 AND 100),
  net_in_kbps  BIGINT       NOT NULL CHECK (net_in_kbps  >= 0),
  net_out_kbps BIGINT       NOT NULL CHECK (net_out_kbps >= 0),
  -- The primary key must include the partition key. It also serves per-VM history queries,
  -- and makes batch ingestion idempotent (ON CONFLICT (vm_id, logged_at) DO NOTHING).
  PRIMARY KEY (vm_id, logged_at)
) PARTITION BY RANGE (logged_at);

-- Creates missing monthly partitions from (current month - months_back) to (current month + months_ahead).
-- Idempotent. Bounds are computed in UTC so they do not depend on the session time zone.
CREATE OR REPLACE FUNCTION ensure_monitoring_partitions(p_months_back INT DEFAULT 1, p_months_ahead INT DEFAULT 3)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i INT; m DATE; part TEXT; start_ts TIMESTAMPTZ; end_ts TIMESTAMPTZ; created INT := 0;
BEGIN
  FOR i IN -p_months_back .. p_months_ahead LOOP
    m := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    part := format('monitoring_log_%s', to_char(m, 'YYYY_MM'));
    IF to_regclass(format('public.%I', part)) IS NULL THEN
      start_ts := m::timestamp AT TIME ZONE 'UTC';
      end_ts   := (m + INTERVAL '1 month')::date::timestamp AT TIME ZONE 'UTC';
      EXECUTE format('CREATE TABLE public.%I PARTITION OF public.monitoring_log FOR VALUES FROM (%L) TO (%L)',
                     part, start_ts, end_ts);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Retention: drops WHOLE monthly partitions whose upper bound is older than the cutoff, so data is kept
-- for p_retention_days to roughly p_retention_days + one month (A9). Uses a plain DETACH because
-- DETACH ... CONCURRENTLY cannot run inside a function.
CREATE OR REPLACE FUNCTION drop_expired_monitoring_partitions(p_retention_days INT DEFAULT 90)
RETURNS SETOF TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r RECORD; cutoff TIMESTAMPTZ := now() - make_interval(days => p_retention_days); upper_bound TIMESTAMPTZ;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'monitoring_log' AND c.relname ~ '^monitoring_log_[0-9]{4}_[0-9]{2}$'
    ORDER BY c.relname
  LOOP
    upper_bound := (to_date(substr(r.relname, 16), 'YYYY_MM') + INTERVAL '1 month')::date::timestamp AT TIME ZONE 'UTC';
    IF upper_bound <= cutoff THEN
      EXECUTE format('ALTER TABLE public.monitoring_log DETACH PARTITION public.%I', r.relname);
      EXECUTE format('DROP TABLE public.%I', r.relname);
      RETURN NEXT r.relname;
    END IF;
  END LOOP;
END $$;

SELECT ensure_monitoring_partitions(2, 3);
