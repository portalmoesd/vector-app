-- Vector Portal — Database Schema (idempotent — safe to run multiple times)

BEGIN;

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('ADMIN','PROTOCOL','DEPUTY','SUPERVISOR','SUPER_COLLABORATOR','COLLABORATOR','ANALYST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ANALYST'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ds_role AS ENUM ('DEPUTY','SUPERVISOR','SUPER_COLLABORATOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_language AS ENUM ('EN','FR','AR','ES','RU','ZH','PT','DE','KA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE event_language ADD VALUE IF NOT EXISTS 'KA'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_status AS ENUM ('DRAFT','IN_PROGRESS','COMPLETED','ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE workflow_step_status AS ENUM ('PENDING','IN_PROGRESS','APPROVED','RETURNED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE history_action AS ENUM ('saved','submitted','returned','approved','asked_to_return','pushed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE event_workflow_type AS ENUM ('advanced','simple'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'pushed'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'pulled'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Countries ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS countries (
  id            SERIAL PRIMARY KEY,
  name_en       VARCHAR(120) NOT NULL UNIQUE,
  code          CHAR(2) NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Departments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(500) NOT NULL,
  name_en       VARCHAR(500),
  is_external   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Users ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  full_name             VARCHAR(200) NOT NULL,
  username              VARCHAR(100) NOT NULL UNIQUE,
  email                 VARCHAR(200) NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  user_role NOT NULL,
  department_id         INT REFERENCES departments(id) ON DELETE SET NULL,
  is_external           BOOLEAN NOT NULL DEFAULT false,
  entity_name           VARCHAR(200),
  must_change_password  BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Backfill for databases predating the entity_name column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS entity_name VARCHAR(200);

-- ─── Country Assignments ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS country_assignments (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_id INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, country_id)
);

-- ─── Deputy–Supervisor Links ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deputy_supervisor_links (
  id            SERIAL PRIMARY KEY,
  deputy_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supervisor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (deputy_id, supervisor_id)
);

-- ─── Deputy–Department Links (direct mapping from org chart) ──────────────

CREATE TABLE IF NOT EXISTS deputy_department_links (
  deputy_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (deputy_id, department_id)
);

-- ─── Events ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id                        SERIAL PRIMARY KEY,
  title                     VARCHAR(500) NOT NULL,
  description               TEXT,
  country_id                INT NOT NULL REFERENCES countries(id),
  document_submitter_role   ds_role NOT NULL,
  document_submitter_id     INT NOT NULL REFERENCES users(id),
  deputy_id                 INT REFERENCES users(id),
  supervisor_id             INT REFERENCES users(id),
  curator_required          BOOLEAN NOT NULL DEFAULT false,
  workflow_type             event_workflow_type NOT NULL DEFAULT 'advanced',
  language                  event_language NOT NULL DEFAULT 'EN',
  deadline_date             DATE,
  occasion                  TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  ended_at                  TIMESTAMPTZ,
  status                    event_status NOT NULL DEFAULT 'DRAFT',
  created_by_id             INT REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Backfill for databases predating the workflow_type column. Idempotent:
-- ADD COLUMN IF NOT EXISTS is a no-op once the column has been added.
ALTER TABLE events ADD COLUMN IF NOT EXISTS workflow_type event_workflow_type NOT NULL DEFAULT 'advanced';

CREATE INDEX IF NOT EXISTS idx_events_status_ended ON events (status, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_country ON events (country_id);
CREATE INDEX IF NOT EXISTS idx_events_document_submitter ON events (document_submitter_id);
CREATE INDEX IF NOT EXISTS idx_events_deputy ON events (deputy_id) WHERE deputy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_supervisor ON events (supervisor_id) WHERE supervisor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events (created_by_id) WHERE created_by_id IS NOT NULL;

-- ─── Sections ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sections (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       VARCHAR(500) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sections_event_sort ON sections (event_id, sort_order);

-- ─── Section–Department Assignment ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_departments (
  section_id    INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (section_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_section_departments_department ON section_departments (department_id, section_id);

-- ─── Workflow Steps ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_steps (
  id                SERIAL PRIMARY KEY,
  section_id        INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  department_id     INT REFERENCES departments(id),
  step_order        INT NOT NULL,
  role_label        VARCHAR(50) NOT NULL,
  assigned_user_id  INT REFERENCES users(id),
  status            workflow_step_status NOT NULL DEFAULT 'PENDING',
  reviewed_at       TIMESTAMPTZ,
  comments          TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_section_order ON workflow_steps (section_id, step_order);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_assigned_user ON workflow_steps (assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- ─── Section Content ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_content (
  id                            SERIAL PRIMARY KEY,
  event_id                      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id                    INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  html_content                  TEXT NOT NULL DEFAULT '',
  status                        VARCHAR(60) NOT NULL DEFAULT 'draft',
  status_comment                TEXT,
  original_submitter_role       VARCHAR(50),
  return_target_role            VARCHAR(50),
  last_updated_by_user_id       INT REFERENCES users(id),
  last_updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_content_edited_at        TIMESTAMPTZ,
  last_content_edited_by_user_id INT REFERENCES users(id),
  UNIQUE (event_id, section_id)
);

CREATE INDEX IF NOT EXISTS idx_section_content_status ON section_content (status);
CREATE INDEX IF NOT EXISTS idx_section_content_event_status ON section_content (event_id, status);

-- ─── Section Files ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_files (
  id              SERIAL PRIMARY KEY,
  event_id        INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id      INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  original_name   VARCHAR(500) NOT NULL,
  stored_name     VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(200),
  size            BIGINT NOT NULL DEFAULT 0,
  file_data       BYTEA,
  uploaded_by_id  INT REFERENCES users(id),
  uploaded_by_name VARCHAR(200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_files_lookup ON section_files (event_id, section_id);
CREATE INDEX IF NOT EXISTS idx_section_files_event_created ON section_files (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_section_files_uploader ON section_files (uploaded_by_id) WHERE uploaded_by_id IS NOT NULL;

-- ─── Section History ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_history (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id  INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  action      history_action NOT NULL,
  from_status VARCHAR(60),
  to_status   VARCHAR(60) NOT NULL,
  user_id     INT REFERENCES users(id),
  user_name   VARCHAR(200),
  user_role   VARCHAR(50),
  note        TEXT,
  acted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_history_lookup ON section_history (event_id, section_id, acted_at);
CREATE INDEX IF NOT EXISTS idx_section_history_event_user ON section_history (event_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_section_history_event_role_latest ON section_history (event_id, section_id, user_role, acted_at DESC);
CREATE INDEX IF NOT EXISTS idx_section_history_return_latest ON section_history (event_id, section_id, action, acted_at DESC);

-- ─── Section Comments ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_comments (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id  INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id),
  parent_id   INT REFERENCES section_comments(id) ON DELETE CASCADE,
  anchor_id   VARCHAR(100),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_comments_lookup ON section_comments (event_id, section_id, created_at);
CREATE INDEX IF NOT EXISTS idx_section_comments_user ON section_comments (user_id);

-- ─── Section Return Requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS section_return_requests (
  id                      SERIAL PRIMARY KEY,
  event_id                INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section_id              INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  requested_by_user_id    INT NOT NULL REFERENCES users(id),
  requested_by_name       VARCHAR(200) NOT NULL,
  requested_by_role       VARCHAR(50) NOT NULL,
  broadcast_above_role    VARCHAR(50) NOT NULL,
  note                    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_return_requests_lookup ON section_return_requests (event_id, section_id, created_at DESC);

-- ─── Event Templates ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_templates (
  id                        SERIAL PRIMARY KEY,
  name                      VARCHAR(300) NOT NULL,
  created_by_id             INT REFERENCES users(id),
  document_submitter_role   ds_role NOT NULL DEFAULT 'DEPUTY',
  curator_required          BOOLEAN NOT NULL DEFAULT false,
  is_default                BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_templates_visible ON event_templates (is_default, created_by_id, name);
CREATE INDEX IF NOT EXISTS idx_event_templates_created_by ON event_templates (created_by_id) WHERE created_by_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_template_sections (
  id            SERIAL PRIMARY KEY,
  template_id   INT NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
  title         VARCHAR(500) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_template_sections_template_sort ON event_template_sections (template_id, sort_order);

CREATE TABLE IF NOT EXISTS event_template_section_departments (
  template_section_id INT NOT NULL REFERENCES event_template_sections(id) ON DELETE CASCADE,
  department_id       INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (template_section_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_event_template_section_depts_department ON event_template_section_departments (department_id);

-- Admin-uploaded datasets (companies registry, FDI sectors, etc.).
-- Rows are keyed by a short kind string; parsed_json holds the
-- aggregated result the statistics page reads, raw_bytes keeps the
-- original XLSX so the admin can re-download it after a deploy.
CREATE TABLE IF NOT EXISTS admin_uploads (
  kind         TEXT PRIMARY KEY,
  parsed_json  JSONB NOT NULL,
  raw_bytes    BYTEA,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
