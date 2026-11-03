-- AssetIQ · PostgreSQL schema (Data layer)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role       AS ENUM ('admin','manager','employee');
CREATE TYPE asset_status    AS ENUM ('available','assigned','retired');
CREATE TYPE asset_condition AS ENUM ('new','good','fair','poor');
CREATE TYPE request_status  AS ENUM ('open','fulfilled_from_stock','needs_purchase');
CREATE TYPE issue_status    AS ENUM ('open','resolved');

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'employee',
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  avg_cost NUMERIC(12,2) NOT NULL CHECK (avg_cost > 0),
  lifespan_years NUMERIC(3,1) NOT NULL DEFAULT 5 CHECK (lifespan_years > 0),
  co2_kg NUMERIC(8,1) NOT NULL DEFAULT 0          -- embodied CO2e avoided when one is reused instead of bought
);

CREATE SEQUENCE asset_tag_seq START 1;
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE DEFAULT 'AIQ-' || lpad(nextval('asset_tag_seq')::text, 3, '0'),
  name TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES categories(id),
  serial_no TEXT NOT NULL UNIQUE,
  purchase_date DATE NOT NULL CHECK (purchase_date <= CURRENT_DATE + 1),
  purchase_cost NUMERIC(12,2) NOT NULL CHECK (purchase_cost > 0),
  warranty_until DATE,
  condition asset_condition NOT NULL DEFAULT 'good',
  status asset_status NOT NULL DEFAULT 'available',
  assigned_to INT REFERENCES users(id),
  last_returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assigned_iff_owner CHECK ((status = 'assigned') = (assigned_to IS NOT NULL))
);
CREATE INDEX idx_assets_status   ON assets(status);
CREATE INDEX idx_assets_category ON assets(category_id);
CREATE INDEX idx_assets_owner    ON assets(assigned_to);

CREATE TABLE assignments (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  CHECK (returned_at IS NULL OR returned_at >= assigned_at)
);
CREATE UNIQUE INDEX one_open_assignment ON assignments(asset_id) WHERE returned_at IS NULL;
CREATE INDEX idx_assign_asset ON assignments(asset_id);

CREATE TABLE maintenance_records (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  performed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  condition_after asset_condition NOT NULL,
  downtime_days NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (downtime_days >= 0)
);
CREATE INDEX idx_maint_asset ON maintenance_records(asset_id);

-- Tamper-evident lifecycle log: each row stores a SHA-256 hash chained to the previous row of the same asset.
CREATE TABLE lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  actor_id INT REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash TEXT,
  hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_events_asset ON lifecycle_events(asset_id, id);

-- Admin-tunable decision thresholds (used by the engine and the what-if simulator)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  label TEXT NOT NULL
);

-- Employee requests for equipment; the Purchase-Avoidance engine tries to serve them from idle stock first
CREATE TABLE asset_requests (
  id SERIAL PRIMARY KEY,
  requester_id INT NOT NULL REFERENCES users(id),
  category_id INT NOT NULL REFERENCES categories(id),
  justification TEXT,
  status request_status NOT NULL DEFAULT 'open',
  fulfilled_asset_id INT REFERENCES assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE issue_reports (
  id SERIAL PRIMARY KEY,
  asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  reported_by INT NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  status issue_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Realised savings: written only when an administrator accepts a recommendation
CREATE TABLE savings_ledger (
  id SERIAL PRIMARY KEY,
  asset_id INT REFERENCES assets(id),
  kind TEXT NOT NULL CHECK (kind IN ('purchase_avoided','repair_vs_new','upkeep_stopped','idle_cost_recovered')),
  amount NUMERIC(12,2) NOT NULL,
  co2_kg NUMERIC(8,1) NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- functions & triggers
CREATE FUNCTION event_hash(prev TEXT, p_asset INT, p_type TEXT, p_detail TEXT, ts TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT encode(digest(coalesce(prev,'') || '|' || p_asset || '|' || p_type || '|' || p_detail || '|' ||
         extract(epoch FROM ts)::text, 'sha256'), 'hex')
$$;

CREATE FUNCTION chain_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.asset_id);               -- serialise writers per asset
  SELECT hash INTO NEW.prev_hash FROM lifecycle_events WHERE asset_id = NEW.asset_id ORDER BY id DESC LIMIT 1;
  NEW.hash := event_hash(NEW.prev_hash, NEW.asset_id, NEW.event_type, NEW.detail, NEW.occurred_at);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chain BEFORE INSERT ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION chain_event();

CREATE FUNCTION freeze_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'lifecycle_events is append-only'; END $$;
CREATE TRIGGER trg_freeze BEFORE UPDATE OR DELETE ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION freeze_events();

CREATE FUNCTION verify_chain(p_asset INT) RETURNS TABLE(valid BOOLEAN, broken_at BIGINT)
LANGUAGE plpgsql AS $$
DECLARE r RECORD; prev TEXT := '';
BEGIN
  FOR r IN SELECT * FROM lifecycle_events WHERE asset_id = p_asset ORDER BY id LOOP
    IF coalesce(r.prev_hash,'') <> prev
       OR r.hash <> event_hash(prev, r.asset_id, r.event_type, r.detail, r.occurred_at) THEN
      valid := false; broken_at := r.id; RETURN NEXT; RETURN;
    END IF;
    prev := r.hash;
  END LOOP;
  valid := true; broken_at := NULL; RETURN NEXT;
END $$;

-- Keep assets.status / assigned_to consistent with the assignments table
CREATE FUNCTION sync_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.returned_at IS NULL THEN
    UPDATE assets SET status = 'assigned', assigned_to = NEW.user_id WHERE id = NEW.asset_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
    UPDATE assets SET status = 'available', assigned_to = NULL, last_returned_at = NEW.returned_at
    WHERE id = NEW.asset_id AND status = 'assigned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_assignment AFTER INSERT OR UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION sync_assignment();

CREATE FUNCTION apply_condition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE assets SET condition = NEW.condition_after WHERE id = NEW.asset_id; RETURN NEW; END $$;
CREATE TRIGGER trg_condition AFTER INSERT ON maintenance_records FOR EACH ROW EXECUTE FUNCTION apply_condition();

-- ---------------------------------------------------------------- analytics view
-- Raw facts per asset. Scoring and recommendations live in the Node engine so thresholds stay configurable.
CREATE VIEW v_asset_metrics AS
SELECT a.id, a.tag, a.name, a.serial_no, a.purchase_date, a.purchase_cost, a.warranty_until,
       a.condition, a.status, a.assigned_to, u.name AS assignee_name, a.last_returned_at,
       c.id AS category_id, c.name AS category, c.avg_cost AS category_avg_cost,
       c.lifespan_years::float8 AS lifespan_years, c.co2_kg,
       GREATEST(CURRENT_DATE - a.purchase_date, 1) AS age_days,
       coalesce(m.total, 0) AS maint_cost,
       coalesce(m.n, 0)     AS maint_count,
       coalesce(m.down, 0)::float8 AS downtime_days,
       coalesce(s.days90, 0)::float8 AS assigned_days_90,
       CASE WHEN a.status = 'available'
            THEN CURRENT_DATE - coalesce(a.last_returned_at::date, a.purchase_date) ELSE 0 END AS idle_days
FROM assets a
JOIN categories c ON c.id = a.category_id
LEFT JOIN users u ON u.id = a.assigned_to
LEFT JOIN LATERAL (SELECT sum(cost) AS total, count(*) AS n, sum(downtime_days) AS down FROM maintenance_records WHERE asset_id = a.id) m ON true
LEFT JOIN LATERAL (
  SELECT sum(extract(epoch FROM (coalesce(returned_at, now()) - greatest(assigned_at, now() - interval '90 days'))) / 86400) AS days90
  FROM assignments WHERE asset_id = a.id AND coalesce(returned_at, now()) > now() - interval '90 days'
) s ON true;

-- ---------------------------------------------------------------- reference data
INSERT INTO categories(name, avg_cost, lifespan_years, co2_kg) VALUES
 ('Laptop',70000,4,340),('Desktop',55000,5,420),('Monitor',18000,6,240),
 ('Tablet',35000,4,130),('Phone',30000,3,70),('Printer',25000,6,150),
 ('Networking',40000,7,90),('Accessory',5000,4,20),('Other',20000,5,50);

INSERT INTO settings(key, value, label) VALUES
 ('risk_replace', 70, 'Risk score at or above which an asset is replaced'),
 ('idle_days',    30, 'Days idle before an asset is flagged for reuse'),
 ('util_min',     20, 'Utilisation % (last 90 days) below which an asset is reassigned'),
 ('repair_pct',   15, 'Typical repair cost as % of purchase price'),
 ('downtime_cost',1500,'Productivity loss per day of downtime (Rs)');
