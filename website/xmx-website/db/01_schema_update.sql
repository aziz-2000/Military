-- ==========================================
-- Schema update for cohorts / platoons / extra candidate fields
-- Run this BEFORE inserting realistic data.
-- ==========================================

-- Cohorts (الدورات)
CREATE TABLE IF NOT EXISTS core.cohorts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_no  int UNIQUE NOT NULL,
  name       text NOT NULL,
  track      text NOT NULL CHECK (track in ('تأسيسية', 'تقدمية')),
  start_year int
);

-- Platoons (الفصائل)
CREATE TABLE IF NOT EXISTS core.platoons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id  uuid NOT NULL REFERENCES core.cohorts(id) ON DELETE CASCADE,
  platoon_no int NOT NULL,
  name       text NOT NULL,
  UNIQUE (cohort_id, platoon_no)
);

-- Extra fields for people
ALTER TABLE core.people
  ADD COLUMN IF NOT EXISTS height_cm int,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(5,2);

-- Extra fields for candidates
ALTER TABLE core.candidates
  ADD COLUMN IF NOT EXISTS cohort_id uuid REFERENCES core.cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platoon_id uuid REFERENCES core.platoons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS background text,
  ADD COLUMN IF NOT EXISTS military_no text,
  ADD COLUMN IF NOT EXISTS sports_no text;

-- Ranks (الرتب)
CREATE TABLE IF NOT EXISTS core.ranks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,
  order_index int NOT NULL,
  category    text
);

ALTER TABLE core.staff
  ADD COLUMN IF NOT EXISTS rank_id uuid REFERENCES core.ranks(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_candidate_background'
  ) THEN
    ALTER TABLE core.candidates
      ADD CONSTRAINT chk_candidate_background
      CHECK (background IS NULL OR background IN ('جامعي', 'عسكري سابق', 'مدني'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_candidates_cohort ON core.candidates(cohort_id);
CREATE INDEX IF NOT EXISTS idx_candidates_platoon ON core.candidates(platoon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_military_no ON core.candidates(military_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_sports_no ON core.candidates(sports_no);
CREATE INDEX IF NOT EXISTS idx_staff_rank ON core.staff(rank_id);

-- Saved Reports (التقارير المحفوظة)
CREATE TABLE IF NOT EXISTS core.saved_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  report_type text NOT NULL DEFAULT 'executive',
  filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_user ON core.saved_reports(created_by);

-- Rank-based default role policies
CREATE TABLE IF NOT EXISTS core.rank_role_policies (
  rank_id     uuid NOT NULL REFERENCES core.ranks(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rank_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_role_policies_role ON core.rank_role_policies(role_id);

-- Workflow fields for candidate requests
ALTER TABLE core.requests
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_approvals int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS approval_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_decision_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_requests_priority'
  ) THEN
    ALTER TABLE core.requests
      ADD CONSTRAINT chk_requests_priority
      CHECK (priority IN ('low', 'normal', 'high', 'critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_requests_approvals'
  ) THEN
    ALTER TABLE core.requests
      ADD CONSTRAINT chk_requests_approvals
      CHECK (
        required_approvals >= 1
        AND approval_count >= 0
        AND approval_count <= required_approvals
      );
  END IF;
END $$;

ALTER TABLE core.request_actions
  ADD COLUMN IF NOT EXISTS approval_level int,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_requests_assigned_to ON core.requests(assigned_to);
CREATE INDEX IF NOT EXISTS idx_requests_priority ON core.requests(priority);
CREATE INDEX IF NOT EXISTS idx_requests_due_at ON core.requests(due_at);
CREATE INDEX IF NOT EXISTS idx_request_actions_approval_level ON core.request_actions(approval_level);
