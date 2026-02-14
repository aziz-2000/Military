-- ==========================================
-- Media Center schema update
-- Run this after 01_schema_update.sql and 02_seed_realistic_data.sql
-- ==========================================

CREATE SCHEMA IF NOT EXISTS comms;

CREATE TABLE IF NOT EXISTS comms.media_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name_ar     text NOT NULL,
  name_en     text,
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_categories_active_order
  ON comms.media_categories(is_active, sort_order, name_ar);

CREATE TABLE IF NOT EXISTS comms.media_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      uuid REFERENCES comms.media_categories(id) ON DELETE SET NULL,
  title            text NOT NULL,
  slug             text UNIQUE,
  summary          text,
  body             text NOT NULL,
  cover_image_url  text,
  cover_file_id    uuid REFERENCES files.file_objects(id) ON DELETE SET NULL,
  gallery          jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags             text[] NOT NULL DEFAULT '{}',
  post_type        text NOT NULL DEFAULT 'news',
  audience         text NOT NULL DEFAULT 'public',
  status           text NOT NULL DEFAULT 'draft',
  is_pinned        boolean NOT NULL DEFAULT false,
  is_featured      boolean NOT NULL DEFAULT false,
  event_at         timestamptz,
  location         text,
  views_count      int NOT NULL DEFAULT 0,
  publish_starts_at timestamptz,
  publish_ends_at   timestamptz,
  published_at      timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_decision_at  timestamptz,
  last_decision_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note     text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_posts_type'
  ) THEN
    ALTER TABLE comms.media_posts
      ADD CONSTRAINT chk_media_posts_type
      CHECK (post_type IN ('news', 'announcement', 'event', 'story', 'press'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_posts_audience'
  ) THEN
    ALTER TABLE comms.media_posts
      ADD CONSTRAINT chk_media_posts_audience
      CHECK (audience IN ('public', 'candidate', 'instructor', 'admin', 'leadership'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_media_posts_status'
  ) THEN
    ALTER TABLE comms.media_posts
      ADD CONSTRAINT chk_media_posts_status
      CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'archived', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_posts_status_published
  ON comms.media_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_posts_category
  ON comms.media_posts(category_id);
CREATE INDEX IF NOT EXISTS idx_media_posts_type_audience
  ON comms.media_posts(post_type, audience);
CREATE INDEX IF NOT EXISTS idx_media_posts_flags
  ON comms.media_posts(is_pinned DESC, is_featured DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_posts_cover_file
  ON comms.media_posts(cover_file_id);

ALTER TABLE comms.media_posts
  ADD COLUMN IF NOT EXISTS cover_file_id uuid REFERENCES files.file_objects(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS comms.media_post_actions (
  id          bigserial PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES comms.media_posts(id) ON DELETE CASCADE,
  action      text NOT NULL,
  from_status text,
  to_status   text,
  note        text,
  acted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acted_at    timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_media_post_actions_post_time
  ON comms.media_post_actions(post_id, acted_at DESC);

-- Seed categories
INSERT INTO comms.media_categories (slug, name_ar, name_en, description, sort_order)
VALUES
  ('college-news', 'أخبار الكلية', 'College News', 'الأخبار الرسمية للكلية والأنشطة العامة.', 10),
  ('training-activities', 'الأنشطة والتدريب', 'Training Activities', 'التغطية الإعلامية للتمارين والأنشطة التدريبية.', 20),
  ('official-announcements', 'التوجيهات الرسمية', 'Official Announcements', 'الإعلانات والتوجيهات الرسمية المعتمدة.', 30),
  ('candidate-success', 'قصص نجاح المرشحين', 'Candidate Success Stories', 'قصص تميز وإنجازات الضباط المرشحين.', 40),
  ('press-releases', 'بيانات صحفية', 'Press Releases', 'البيانات الصحفية المعتمدة للنشر الخارجي.', 50)
ON CONFLICT (slug) DO NOTHING;

-- Seed one initial post for immediate testing
INSERT INTO comms.media_posts (
  category_id,
  title,
  slug,
  summary,
  body,
  post_type,
  audience,
  status,
  is_featured,
  is_pinned,
  published_at
)
SELECT
  c.id,
  'تدشين المركز الإعلامي الرقمي',
  'media-center-launch',
  'إطلاق صفحة المركز الإعلامي لتوحيد الأخبار والإعلانات والفعاليات.',
  'تم تدشين المركز الإعلامي الرقمي ليكون المصدر الرسمي لمتابعة أخبار الكلية والفعاليات والتوجيهات المعتمدة.',
  'announcement',
  'public',
  'published',
  true,
  true,
  now()
FROM comms.media_categories c
WHERE c.slug = 'official-announcements'
  AND NOT EXISTS (
    SELECT 1
    FROM comms.media_posts p
    WHERE p.slug = 'media-center-launch'
  );
