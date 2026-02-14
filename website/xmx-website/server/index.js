import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 4000);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(serverDir, "uploads");

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("Missing JWT_SECRET in environment.");
  process.exit(1);
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
      : true,
  })
);
app.use(express.json({ limit: "25mb" }));

const pool = new Pool(getPoolConfig());

function getPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: false }
          : undefined,
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
  };
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length);
}

function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: "غير مصرح. يرجى تسجيل الدخول." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    return next();
  } catch (_error) {
    return res
      .status(401)
      .json({ message: "انتهت الجلسة. يرجى تسجيل الدخول مجدداً." });
  }
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasRole = allowedRoles.some((role) => roles.includes(role));
    if (!hasRole) {
      return res.status(403).json({ message: "غير مصرح للوصول إلى هذه البوابة." });
    }
    return next();
  };
}

async function getUserRoles(userId) {
  const rolesResult = await pool.query(
    `
      select r.name
      from auth.user_roles ur
      join auth.roles r on r.id = ur.role_id
      where ur.user_id = $1
    `,
    [userId]
  );

  return rolesResult.rows.map((row) => row.name);
}

async function getUserPermissions(userId) {
  const permissionsResult = await pool.query(
    `
    select distinct p.code
    from auth.user_roles ur
    join auth.role_permissions rp on rp.role_id = ur.role_id
    join auth.permissions p on p.id = rp.permission_id
    where ur.user_id = $1
    order by p.code
    `,
    [userId]
  );

  return permissionsResult.rows.map((row) => row.code);
}

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function parseInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function parseDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizePriority(value) {
  const priority = normalizeString(value)?.toLowerCase();
  if (!priority) return "normal";
  if (["low", "normal", "high", "critical"].includes(priority)) return priority;
  return null;
}

function normalizeWorkflowDecision(value) {
  const decision = normalizeString(value)?.toLowerCase();
  if (!decision) return null;
  if (["in_review", "approve", "reject", "escalate"].includes(decision)) {
    return decision;
  }
  return null;
}

async function candidateInInstructorScope(client, staffId, candidateId) {
  const result = await client.query(
    `
    select 1
    from academics.enrollments e
    join academics.course_sections cs on cs.id = e.section_id
    where cs.instructor_staff_id = $1 and e.candidate_id = $2
    limit 1
    `,
    [staffId, candidateId]
  );
  return result.rowCount > 0;
}

function sanitizeFilename(filename) {
  const base = normalizeString(filename) || "file";
  return base.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function ensureUploadsDir() {
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function ensureSavedReportsTable() {
  await pool.query(`
    create table if not exists core.saved_reports (
      id          uuid primary key default gen_random_uuid(),
      name        text not null,
      description text,
      report_type text not null default 'executive',
      filters     jsonb not null default '{}'::jsonb,
      created_by  uuid not null references auth.users(id) on delete cascade,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      unique (created_by, name)
    )
  `);
  await pool.query(
    `create index if not exists idx_saved_reports_user on core.saved_reports(created_by)`
  );
}

async function ensureRankRolePoliciesTable() {
  await pool.query(`
    create table if not exists core.rank_role_policies (
      rank_id     uuid not null references core.ranks(id) on delete cascade,
      role_id     uuid not null references auth.roles(id) on delete cascade,
      created_at  timestamptz not null default now(),
      primary key (rank_id, role_id)
    )
  `);
  await pool.query(
    `create index if not exists idx_rank_role_policies_role on core.rank_role_policies(role_id)`
  );
}

async function ensureWorkflowSchema() {
  await pool.query(`
    alter table core.requests
      add column if not exists priority text not null default 'normal',
      add column if not exists assigned_to uuid references auth.users(id) on delete set null,
      add column if not exists due_at timestamptz,
      add column if not exists required_approvals int not null default 2,
      add column if not exists approval_count int not null default 0,
      add column if not exists closed_at timestamptz,
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists last_decision_at timestamptz,
      add column if not exists last_decision_by uuid references auth.users(id) on delete set null
  `);

  await pool.query(`
    do $$
    begin
      if not exists (
        select 1
        from pg_constraint
        where conname = 'chk_requests_priority'
      ) then
        alter table core.requests
          add constraint chk_requests_priority
          check (priority in ('low', 'normal', 'high', 'critical'));
      end if;

      if not exists (
        select 1
        from pg_constraint
        where conname = 'chk_requests_approvals'
      ) then
        alter table core.requests
          add constraint chk_requests_approvals
          check (
            required_approvals >= 1
            and approval_count >= 0
            and approval_count <= required_approvals
          );
      end if;
    end $$;
  `);

  await pool.query(`
    alter table core.request_actions
      add column if not exists approval_level int,
      add column if not exists metadata jsonb not null default '{}'::jsonb
  `);

  await pool.query(
    `create index if not exists idx_requests_assigned_to on core.requests(assigned_to)`
  );
  await pool.query(
    `create index if not exists idx_requests_priority on core.requests(priority)`
  );
  await pool.query(
    `create index if not exists idx_requests_due_at on core.requests(due_at)`
  );
  await pool.query(
    `create index if not exists idx_request_actions_approval_level on core.request_actions(approval_level)`
  );
}

function slugify(value, fallbackPrefix = "post") {
  const normalized = normalizeString(value);
  if (!normalized) {
    return `${fallbackPrefix}-${Date.now().toString(36)}-${crypto
      .randomBytes(3)
      .toString("hex")}`;
  }

  const slug = normalized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!slug.length) {
    return `${fallbackPrefix}-${Date.now().toString(36)}-${crypto
      .randomBytes(3)
      .toString("hex")}`;
  }

  return slug;
}

function normalizeMediaStatus(value, { allowApproved = true } = {}) {
  const status = normalizeString(value)?.toLowerCase();
  if (!status) return "draft";
  const allowed = allowApproved
    ? ["draft", "in_review", "approved", "published", "archived", "rejected"]
    : ["draft", "in_review", "published", "archived", "rejected"];
  return allowed.includes(status) ? status : null;
}

function normalizeMediaType(value) {
  const postType = normalizeString(value)?.toLowerCase();
  if (!postType) return "news";
  if (["news", "announcement", "event", "story", "press"].includes(postType)) {
    return postType;
  }
  return null;
}

function normalizeMediaAudience(value) {
  const audience = normalizeString(value)?.toLowerCase();
  if (!audience) return "public";
  if (["public", "candidate", "instructor", "admin", "leadership"].includes(audience)) {
    return audience;
  }
  return null;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter((item) => item !== null)
      .slice(0, 30);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizeString(item))
      .filter((item) => item !== null)
      .slice(0, 30);
  }

  return [];
}

function isValidUuid(value) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value)
  );
}

function normalizeUuidArray(value, maxItems = 60) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const result = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeString(item);
    if (!normalized || !isValidUuid(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function buildMediaFilePublicUrl(fileId) {
  const normalized = normalizeString(fileId);
  if (!normalized) return null;
  return `/api/media/files/${normalized}`;
}

function isLikelyImageFile(fileRow) {
  const mimeType = normalizeString(fileRow?.mime_type)?.toLowerCase();
  if (mimeType && mimeType.startsWith("image/")) return true;
  const fileName = normalizeString(fileRow?.original_name)?.toLowerCase() || "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fileName);
}

function normalizeGallery(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const url = normalizeString(item);
        if (!url) return null;
        return { url };
      }
      if (typeof item === "object" && item !== null) {
        const fileId = normalizeString(item.fileId ?? item.file_id);
        const url = normalizeString(item.url) || buildMediaFilePublicUrl(fileId);
        if (fileId && !isValidUuid(fileId)) return null;
        if (!url && !fileId) return null;
        return {
          fileId,
          url,
          caption: normalizeString(item.caption),
        };
      }
      return null;
    })
    .filter((item) => item !== null)
    .slice(0, 20);
}

function mapMediaPostRow(row) {
  const coverFileId = normalizeString(row.cover_file_id);
  const rawGallery = Array.isArray(row.gallery) ? row.gallery : [];
  const gallery = rawGallery
    .map((item) => {
      if (typeof item === "string") {
        const url = normalizeString(item);
        return url ? { url } : null;
      }
      if (typeof item !== "object" || item === null) return null;
      const fileId = normalizeString(item.fileId ?? item.file_id);
      const url = normalizeString(item.url) || buildMediaFilePublicUrl(fileId);
      if (!fileId && !url) return null;
      return {
        fileId,
        url,
        caption: normalizeString(item.caption),
      };
    })
    .filter((item) => item !== null);

  const galleryFileIds = Array.from(
    new Set(gallery.map((item) => normalizeString(item.fileId)).filter((item) => item !== null))
  );

  return {
    id: row.id,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    coverFileId,
    coverImageUrl: normalizeString(row.cover_image_url) || buildMediaFilePublicUrl(coverFileId),
    gallery,
    galleryFileIds,
    tags: Array.isArray(row.tags) ? row.tags : [],
    postType: row.post_type,
    audience: row.audience,
    status: row.status,
    isPinned: Boolean(row.is_pinned),
    isFeatured: Boolean(row.is_featured),
    eventAt: row.event_at,
    location: row.location,
    viewsCount: Number(row.views_count || 0),
    publishStartsAt: row.publish_starts_at,
    publishEndsAt: row.publish_ends_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    decisionNote: row.decision_note,
  };
}

const MEDIA_ROLES = ["admin", "media_writer", "media_reviewer", "media_publisher"];
const MEDIA_EDITOR_ROLES = ["admin", "media_writer", "media_publisher"];
const MEDIA_REVIEWER_ROLES = ["admin", "media_reviewer"];
const MEDIA_PUBLISHER_ROLES = ["admin", "media_publisher"];
const MEDIA_FILE_ACCESS_ROLES = [
  "admin",
  "uploader",
  "media_writer",
  "media_reviewer",
  "media_publisher",
];

function hasAnyRole(userRoles = [], allowedRoles = []) {
  return allowedRoles.some((role) => userRoles.includes(role));
}

async function ensureMediaCenterSchema() {
  await ensureMediaRolePermissions();

  await pool.query(`
    create table if not exists comms.media_categories (
      id          uuid primary key default gen_random_uuid(),
      slug        text unique not null,
      name_ar     text not null,
      name_en     text,
      description text,
      sort_order  int not null default 0,
      is_active   boolean not null default true,
      created_by  uuid references auth.users(id) on delete set null,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now()
    )
  `);

  await pool.query(`
    create table if not exists comms.media_posts (
      id                uuid primary key default gen_random_uuid(),
      category_id       uuid references comms.media_categories(id) on delete set null,
      title             text not null,
      slug              text unique,
      summary           text,
      body              text not null,
      cover_image_url   text,
      cover_file_id     uuid references files.file_objects(id) on delete set null,
      gallery           jsonb not null default '[]'::jsonb,
      tags              text[] not null default '{}',
      post_type         text not null default 'news',
      audience          text not null default 'public',
      status            text not null default 'draft',
      is_pinned         boolean not null default false,
      is_featured       boolean not null default false,
      event_at          timestamptz,
      location          text,
      views_count       int not null default 0,
      publish_starts_at timestamptz,
      publish_ends_at   timestamptz,
      published_at      timestamptz,
      created_by        uuid references auth.users(id) on delete set null,
      approved_by       uuid references auth.users(id) on delete set null,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now(),
      last_decision_at  timestamptz,
      last_decision_by  uuid references auth.users(id) on delete set null,
      decision_note     text
    )
  `);

  await pool.query(`
    alter table comms.media_posts
      add column if not exists cover_file_id uuid references files.file_objects(id) on delete set null
  `);

  await pool.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint where conname = 'chk_media_posts_type'
      ) then
        alter table comms.media_posts
          add constraint chk_media_posts_type
          check (post_type in ('news', 'announcement', 'event', 'story', 'press'));
      end if;

      if not exists (
        select 1 from pg_constraint where conname = 'chk_media_posts_audience'
      ) then
        alter table comms.media_posts
          add constraint chk_media_posts_audience
          check (audience in ('public', 'candidate', 'instructor', 'admin', 'leadership'));
      end if;

      if not exists (
        select 1 from pg_constraint where conname = 'chk_media_posts_status'
      ) then
        alter table comms.media_posts
          add constraint chk_media_posts_status
          check (status in ('draft', 'in_review', 'approved', 'published', 'archived', 'rejected'));
      end if;
    end $$;
  `);

  await pool.query(`
    create table if not exists comms.media_post_actions (
      id          bigserial primary key,
      post_id     uuid not null references comms.media_posts(id) on delete cascade,
      action      text not null,
      from_status text,
      to_status   text,
      note        text,
      acted_by    uuid references auth.users(id) on delete set null,
      acted_at    timestamptz not null default now(),
      metadata    jsonb not null default '{}'::jsonb
    )
  `);

  await pool.query(
    `create index if not exists idx_media_categories_active_order on comms.media_categories(is_active, sort_order, name_ar)`
  );
  await pool.query(
    `create index if not exists idx_media_posts_status_published on comms.media_posts(status, published_at desc)`
  );
  await pool.query(
    `create index if not exists idx_media_posts_category on comms.media_posts(category_id)`
  );
  await pool.query(
    `create index if not exists idx_media_posts_type_audience on comms.media_posts(post_type, audience)`
  );
  await pool.query(
    `create index if not exists idx_media_posts_flags on comms.media_posts(is_pinned desc, is_featured desc, created_at desc)`
  );
  await pool.query(
    `create index if not exists idx_media_posts_cover_file on comms.media_posts(cover_file_id)`
  );
  await pool.query(
    `create index if not exists idx_media_post_actions_post_time on comms.media_post_actions(post_id, acted_at desc)`
  );
  await pool.query(
    `create index if not exists idx_file_links_media_post on files.file_links(entity_type, entity_id)`
  );

  await pool.query(`
    insert into comms.media_categories (slug, name_ar, name_en, description, sort_order)
    values
      ('college-news', 'أخبار الكلية', 'College News', 'الأخبار الرسمية للكلية والأنشطة العامة.', 10),
      ('training-activities', 'الأنشطة والتدريب', 'Training Activities', 'التغطية الإعلامية للتمارين والأنشطة التدريبية.', 20),
      ('official-announcements', 'التوجيهات الرسمية', 'Official Announcements', 'الإعلانات والتوجيهات الرسمية المعتمدة.', 30),
      ('candidate-success', 'قصص نجاح المرشحين', 'Candidate Success Stories', 'قصص تميز وإنجازات الضباط المرشحين.', 40),
      ('press-releases', 'بيانات صحفية', 'Press Releases', 'البيانات الصحفية المعتمدة للنشر الخارجي.', 50)
    on conflict (slug) do nothing
  `);
}

async function ensureMediaRolePermissions() {
  await pool.query(`
    insert into auth.roles (name, description)
    values
      ('media_writer', 'Media content writer'),
      ('media_reviewer', 'Media reviewer'),
      ('media_publisher', 'Media publisher')
    on conflict (name) do nothing
  `);

  await pool.query(`
    insert into auth.permissions (code, description)
    values
      ('media.categories.read', 'Read media categories'),
      ('media.categories.write', 'Manage media categories'),
      ('media.posts.read', 'Read media posts'),
      ('media.posts.write', 'Create and update media posts'),
      ('media.posts.review', 'Review and approve/reject media posts'),
      ('media.posts.publish', 'Publish/archive/pin media posts'),
      ('media.files.read', 'Read uploaded media files'),
      ('media.dashboard.read', 'Read media dashboard')
    on conflict (code) do nothing
  `);

  await pool.query(`
    with mapping(role_name, permission_code) as (
      values
        ('admin', 'media.categories.read'),
        ('admin', 'media.categories.write'),
        ('admin', 'media.posts.read'),
        ('admin', 'media.posts.write'),
        ('admin', 'media.posts.review'),
        ('admin', 'media.posts.publish'),
        ('admin', 'media.files.read'),
        ('admin', 'media.dashboard.read'),
        ('media_writer', 'media.categories.read'),
        ('media_writer', 'media.posts.read'),
        ('media_writer', 'media.posts.write'),
        ('media_writer', 'media.files.read'),
        ('media_writer', 'media.dashboard.read'),
        ('media_reviewer', 'media.categories.read'),
        ('media_reviewer', 'media.posts.read'),
        ('media_reviewer', 'media.posts.review'),
        ('media_reviewer', 'media.files.read'),
        ('media_reviewer', 'media.dashboard.read'),
        ('media_publisher', 'media.categories.read'),
        ('media_publisher', 'media.categories.write'),
        ('media_publisher', 'media.posts.read'),
        ('media_publisher', 'media.posts.publish'),
        ('media_publisher', 'media.files.read'),
        ('media_publisher', 'media.dashboard.read')
    )
    insert into auth.role_permissions (role_id, permission_id)
    select r.id, p.id
    from mapping m
    join auth.roles r on r.name = m.role_name
    join auth.permissions p on p.code = m.permission_code
    on conflict do nothing
  `);
}

async function logMediaAction(client, { postId, action, fromStatus, toStatus, note, actedBy, metadata }) {
  await client.query(
    `
    insert into comms.media_post_actions
      (post_id, action, from_status, to_status, note, acted_by, metadata)
    values
      ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      postId,
      action,
      fromStatus || null,
      toStatus || null,
      note || null,
      actedBy || null,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function ensureUniqueMediaSlug(client, requestedSlug, fallbackTitle, excludePostId = null) {
  const base = slugify(requestedSlug || fallbackTitle, "media-post");
  let slug = base;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const checkResult = await client.query(
      `
      select 1
      from comms.media_posts
      where slug = $1
        and ($2::uuid is null or id <> $2::uuid)
      limit 1
      `,
      [slug, excludePostId]
    );
    if (checkResult.rowCount === 0) return slug;
    slug = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  }

  return `${base}-${Date.now().toString(36)}`;
}

async function getMediaImageFilesByIds(client, fileIds = []) {
  const normalizedIds = normalizeUuidArray(fileIds);
  if (normalizedIds.length === 0) {
    return new Map();
  }

  const result = await client.query(
    `
    select id, mime_type, original_name
    from files.file_objects
    where id = any($1::uuid[])
    `,
    [normalizedIds]
  );
  const fileMap = new Map(result.rows.map((row) => [row.id, row]));

  if (fileMap.size !== normalizedIds.length) {
    const error = new Error("Some selected files are missing.");
    error.status = 400;
    throw error;
  }

  for (const fileId of normalizedIds) {
    const fileRow = fileMap.get(fileId);
    if (!isLikelyImageFile(fileRow)) {
      const error = new Error("Only image files are allowed for media posts.");
      error.status = 400;
      throw error;
    }
  }

  return fileMap;
}

async function syncMediaPostFileLinks(client, { postId, coverFileId, galleryFileIds }) {
  const normalizedCoverId = normalizeString(coverFileId);
  const normalizedGalleryIds = normalizeUuidArray(galleryFileIds);

  await client.query(
    `
    delete from files.file_links
    where entity_type = 'media_post'
      and entity_id = $1
    `,
    [postId]
  );

  const linkRows = [];
  const seen = new Set();
  if (normalizedCoverId && isValidUuid(normalizedCoverId) && !seen.has(normalizedCoverId)) {
    seen.add(normalizedCoverId);
    linkRows.push({ fileId: normalizedCoverId, note: "cover_image" });
  }
  for (const fileId of normalizedGalleryIds) {
    if (seen.has(fileId)) continue;
    seen.add(fileId);
    linkRows.push({ fileId, note: "gallery_image" });
  }

  for (const link of linkRows) {
    await client.query(
      `
      insert into files.file_links (file_id, entity_type, entity_id, note)
      values ($1, 'media_post', $2, $3)
      `,
      [link.fileId, postId, link.note]
    );
  }
}

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("select 1 as ok");
    return res.json({ ok: true, db: result.rows[0]?.ok === 1 });
  } catch (_error) {
    return res.status(500).json({ ok: false });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res.status(400).json({
        message: "يرجى إدخال البريد الإلكتروني/اسم المستخدم وكلمة المرور.",
      });
    }

    const userResult = await pool.query(
      `
      select id, username, email, status
      from auth.users
      where (username = $1 or email = $1)
        and password_hash = crypt($2, password_hash)
        and status = 'active'
      `,
      [identifier, password]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة." });
    }

    const user = userResult.rows[0];

    const roles = await getUserRoles(user.id);

    const token = jwt.sign({ userId: user.id, roles }, jwtSecret, {
      expiresIn: "8h",
    });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "حدث خطأ في تسجيل الدخول." });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userResult = await pool.query(
      `
        select id, username, email, status
        from auth.users
        where id = $1
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "المستخدم غير موجود." });
    }

    const user = userResult.rows[0];
    const roles = await getUserRoles(userId);

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles,
      },
    });
  } catch (error) {
    console.error("Auth me error:", error);
    return res.status(500).json({ message: "تعذر تحميل بيانات المستخدم." });
  }
});

app.get("/api/admin/overview", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const userId = req.user.userId;

    const staffResult = await pool.query(
      `
      select
        p.first_name,
        p.last_name,
        d.name as department,
        s.position_title,
        s.rank_title,
        r.name as rank_name
      from core.staff s
      join core.people p on p.id = s.person_id
      left join core.departments d on d.id = s.department_id
      left join core.ranks r on r.id = s.rank_id
      where s.user_id = $1
      `,
      [userId]
    );

    const permissionsPromise = getUserPermissions(userId);

    const totalCandidatesPromise = pool.query(
      `select count(*)::int as total from core.candidates`
    );
    const enrolledCandidatesPromise = pool.query(
      `select count(*)::int as total from core.candidates where status = 'enrolled'`
    );
    const totalStaffPromise = pool.query(
      `select count(*)::int as total from core.staff`
    );

    const candidatesByStatusPromise = pool.query(
      `
      select status, count(*)::int as count
      from core.candidates
      group by status
      order by count desc
      `
    );

    const requestsByStatusPromise = pool.query(
      `
      select status, count(*)::int as count
      from core.requests
      group by status
      order by count desc
      `
    );

    const pendingRequestsPromise = pool.query(
      `
      select count(*)::int as total
      from core.requests
      where status in ('submitted', 'in_review')
      `
    );

    const attendanceSummaryPromise = pool.query(
      `
      select
        count(*)::int as total_sessions,
        sum(case when present then 1 else 0 end)::int as present_sessions
      from academics.attendance
      `
    );

    const attendanceDailyPromise = pool.query(
      `
      select
        date(s.session_at) as day,
        sum(case when a.present then 1 else 0 end)::int as present_count,
        sum(case when a.present = false then 1 else 0 end)::int as absent_count
      from academics.attendance a
      join academics.attendance_sessions s on s.id = a.attendance_session_id
      where s.session_at >= now() - interval '7 days'
      group by date(s.session_at)
      order by day
      `
    );

    const medicalByStatusPromise = pool.query(
      `
      select status, count(*)::int as count
      from medical.exams
      group by status
      order by count desc
      `
    );

    const medicalFitPromise = pool.query(
      `
      select fit_status, count(*)::int as count
      from medical.exam_results
      group by fit_status
      order by count desc
      `
    );

    const topCoursesPromise = pool.query(
      `
      select c.code, c.title, count(*)::int as enrollment_count
      from academics.enrollments e
      join academics.course_sections cs on cs.id = e.section_id
      join academics.courses c on c.id = cs.course_id
      group by c.id
      order by enrollment_count desc
      limit 5
      `
    );

    const averageGradePromise = pool.query(
      `
      select avg(score)::numeric(10,2) as average_score, count(*)::int as total_grades
      from academics.grades
      `
    );

    const auditPromise = pool.query(
      `
      select
        a.id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.created_at,
        u.username as actor_username
      from audit.audit_log a
      left join auth.users u on u.id = a.actor_user_id
      order by a.created_at desc
      limit 10
      `
    );

    const announcementsPromise = pool.query(
      `
      select id, title, published_at
      from comms.announcements
      where status = 'published'
      order by published_at desc nulls last, created_at desc
      limit 5
      `
    );

    const [
      permissions,
      totalCandidatesResult,
      enrolledCandidatesResult,
      totalStaffResult,
      candidatesByStatusResult,
      requestsByStatusResult,
      pendingRequestsResult,
      attendanceSummaryResult,
      attendanceDailyResult,
      medicalByStatusResult,
      medicalFitResult,
      topCoursesResult,
      averageGradeResult,
      auditResult,
      announcementsResult,
    ] = await Promise.all([
      permissionsPromise,
      totalCandidatesPromise,
      enrolledCandidatesPromise,
      totalStaffPromise,
      candidatesByStatusPromise,
      requestsByStatusPromise,
      pendingRequestsPromise,
      attendanceSummaryPromise,
      attendanceDailyPromise,
      medicalByStatusPromise,
      medicalFitPromise,
      topCoursesPromise,
      averageGradePromise,
      auditPromise,
      announcementsPromise,
    ]);

    const attendanceSummaryRow = attendanceSummaryResult.rows[0] || {
      total_sessions: 0,
      present_sessions: 0,
    };
    const totalSessions = Number(attendanceSummaryRow.total_sessions || 0);
    const presentSessions = Number(attendanceSummaryRow.present_sessions || 0);
    const attendanceRate =
      totalSessions > 0 ? Math.round((presentSessions / totalSessions) * 100) : 0;

    const averageGradeRow = averageGradeResult.rows[0] || {
      average_score: null,
      total_grades: 0,
    };

    const profileRow = staffResult.rows[0];

    return res.json({
      profile: profileRow
        ? {
            fullName: `${profileRow.first_name} ${profileRow.last_name}`.trim(),
            department: profileRow.department,
            positionTitle: profileRow.position_title,
          rankTitle: profileRow.rank_name || profileRow.rank_title,
          }
        : null,
      roles: req.user.roles || [],
      permissions,
      metrics: {
        totalCandidates: totalCandidatesResult.rows[0]?.total || 0,
        enrolledCandidates: enrolledCandidatesResult.rows[0]?.total || 0,
        totalStaff: totalStaffResult.rows[0]?.total || 0,
        pendingRequests: pendingRequestsResult.rows[0]?.total || 0,
        attendanceRate,
        averageGrade: averageGradeRow.average_score,
        totalGrades: averageGradeRow.total_grades || 0,
      },
      candidatesByStatus: candidatesByStatusResult.rows,
      requestsByStatus: requestsByStatusResult.rows,
      attendanceDaily: attendanceDailyResult.rows,
      medicalByStatus: medicalByStatusResult.rows,
      medicalByFit: medicalFitResult.rows,
      topCourses: topCoursesResult.rows,
      recentActivity: auditResult.rows,
      announcements: announcementsResult.rows,
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ message: "تعذر تحميل لوحة الإدارة." });
  }
});

app.get("/api/admin/filters", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const cohortsPromise = pool.query(
      `
      select id, cohort_no, name, track
      from core.cohorts
      order by cohort_no desc
      `
    );

    const platoonsPromise = pool.query(
      `
      select id, cohort_id, platoon_no, name
      from core.platoons
      order by platoon_no
      `
    );

    const statusesPromise = pool.query(
      `
      select unnest(enum_range(NULL::core.candidate_status))::text as status
      `
    );

    const [cohortsResult, platoonsResult, statusesResult] = await Promise.all([
      cohortsPromise,
      platoonsPromise,
      statusesPromise,
    ]);

    return res.json({
      cohorts: cohortsResult.rows,
      platoons: platoonsResult.rows,
      statuses: statusesResult.rows.map((row) => row.status),
    });
  } catch (error) {
    console.error("Admin filters error:", error);
    return res.status(500).json({ message: "تعذر تحميل فلاتر الإدارة." });
  }
});

app.get("/api/admin/candidates", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : "";
    const status = req.query.status ? String(req.query.status).trim() : "";
    const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
    const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
    const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
    const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const conditions = [];
    const values = [];
    let index = 1;

    if (status) {
      conditions.push(`c.status = $${index}`);
      values.push(status);
      index += 1;
    }

    if (cohortId) {
      conditions.push(`coh.id = $${index}`);
      values.push(cohortId);
      index += 1;
    } else if (cohortNo) {
      conditions.push(`coh.cohort_no = $${index}`);
      values.push(cohortNo);
      index += 1;
    }

    if (platoonId) {
      conditions.push(`pl.id = $${index}`);
      values.push(platoonId);
      index += 1;
    } else if (platoonNo) {
      conditions.push(`pl.platoon_no = $${index}`);
      values.push(platoonNo);
      index += 1;
    }

    if (search) {
      conditions.push(
        `(lower(p.first_name || ' ' || p.last_name) like $${index}
          or lower(c.candidate_no) like $${index}
          or lower(c.military_no) like $${index}
          or lower(c.sports_no) like $${index})`
      );
      values.push(`%${search.toLowerCase()}%`);
      index += 1;
    }

    const whereClause = conditions.length
      ? `where ${conditions.join(" and ")}`
      : "";

    const baseQuery = `
      from core.candidates c
      join core.people p on p.id = c.person_id
      join auth.users u on u.id = c.user_id
      left join core.cohorts coh on coh.id = c.cohort_id
      left join core.platoons pl on pl.id = c.platoon_id
    `;

    const countQuery = `
      select count(*)::int as total
      ${baseQuery}
      ${whereClause}
    `;

    const dataQuery = `
      select
        c.id,
        c.candidate_no,
        c.status,
        c.intake_year,
        c.cohort_id,
        c.platoon_id,
        c.background,
        c.military_no,
        c.sports_no,
        p.gender,
        p.birth_date,
        p.address,
        p.height_cm,
        p.weight_kg,
        p.first_name,
        p.last_name,
        p.national_id,
        u.username,
        u.email,
        u.phone,
        coh.cohort_no,
        coh.name as cohort_name,
        coh.track as cohort_track,
        pl.platoon_no,
        pl.name as platoon_name
      ${baseQuery}
      ${whereClause}
      order by coh.cohort_no desc nulls last, pl.platoon_no asc nulls last, c.candidate_no asc
      limit $${index} offset $${index + 1}
    `;

    const countResult = await pool.query(countQuery, values);
    const dataResult = await pool.query(dataQuery, [...values, limit, offset]);

    return res.json({
      total: countResult.rows[0]?.total || 0,
      rows: dataResult.rows,
    });
  } catch (error) {
    console.error("Admin candidates error:", error);
    return res.status(500).json({ message: "تعذر تحميل بيانات المرشحين." });
  }
});

app.post("/api/admin/candidates", requireAuth, requireRole(["admin"]), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      username,
      email,
      phone,
      password,
      firstName,
      lastName,
      gender,
      birthDate,
      address,
      nationalId,
      heightCm,
      weightKg,
      candidateNo,
      status,
      intakeYear,
      cohortId,
      platoonId,
      background,
      militaryNo,
      sportsNo,
    } = req.body || {};

    if (!firstName || !lastName || !candidateNo) {
      return res.status(400).json({
        message: "يرجى إدخال الاسم الأول واسم العائلة ورقم المرشح.",
      });
    }

    const normalizedUsername =
      normalizeString(username) ||
      normalizeString(candidateNo)?.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const normalizedPassword = normalizeString(password) || "candidate123";

    await client.query("begin");

    const userResult = await client.query(
      `
      insert into auth.users (username, email, phone, password_hash, status)
      values ($1, $2, $3, crypt($4, gen_salt('bf')), 'active')
      returning id, username, email, phone
      `,
      [normalizedUsername, normalizeString(email), normalizeString(phone), normalizedPassword]
    );

    const userId = userResult.rows[0].id;

    await client.query(
      `
      insert into auth.user_roles (user_id, role_id)
      select $1, id
      from auth.roles
      where name = 'candidate'
      on conflict do nothing
      `,
      [userId]
    );

    const peopleResult = await client.query(
      `
      insert into core.people (
        national_id,
        first_name,
        last_name,
        gender,
        birth_date,
        address,
        height_cm,
        weight_kg
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id
      `,
      [
        normalizeString(nationalId),
        normalizeString(firstName),
        normalizeString(lastName),
        normalizeString(gender),
        normalizeString(birthDate),
        normalizeString(address),
        parseInteger(heightCm),
        parseNumeric(weightKg),
      ]
    );

    const personId = peopleResult.rows[0].id;

    const candidateResult = await client.query(
      `
      insert into core.candidates (
        user_id,
        person_id,
        candidate_no,
        status,
        intake_year,
        cohort_id,
        platoon_id,
        background,
        military_no,
        sports_no
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id
      `,
      [
        userId,
        personId,
        normalizeString(candidateNo),
        normalizeString(status) || "applicant",
        parseInteger(intakeYear),
        normalizeString(cohortId),
        normalizeString(platoonId),
        normalizeString(background),
        normalizeString(militaryNo),
        normalizeString(sportsNo),
      ]
    );

    await client.query("commit");

    return res.status(201).json({
      candidateId: candidateResult.rows[0].id,
      user: userResult.rows[0],
      defaultPassword: normalizedPassword,
    });
  } catch (error) {
    await client.query("rollback");
    if (error?.code === "23505") {
      return res.status(409).json({ message: "يوجد تعارض في بيانات فريدة (مثل البريد أو الرقم)." });
    }
    console.error("Create candidate error:", error);
    return res.status(500).json({ message: "تعذر إنشاء المرشح." });
  } finally {
    client.release();
  }
});

app.put("/api/admin/candidates/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  const client = await pool.connect();
  try {
    const candidateId = req.params.id;
    const {
      username,
      email,
      phone,
      password,
      firstName,
      lastName,
      gender,
      birthDate,
      address,
      nationalId,
      heightCm,
      weightKg,
      candidateNo,
      status,
      intakeYear,
      cohortId,
      platoonId,
      background,
      militaryNo,
      sportsNo,
    } = req.body || {};

    const existingResult = await client.query(
      `
      select id, user_id, person_id
      from core.candidates
      where id = $1
      `,
      [candidateId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ message: "المرشح غير موجود." });
    }

    const existing = existingResult.rows[0];

    await client.query("begin");

    await client.query(
      `
      update auth.users
      set
        username = $1,
        email = $2,
        phone = $3,
        updated_at = now()
      where id = $4
      `,
      [
        normalizeString(username),
        normalizeString(email),
        normalizeString(phone),
        existing.user_id,
      ]
    );

    if (normalizeString(password)) {
      await client.query(
        `
        update auth.users
        set password_hash = crypt($1, gen_salt('bf')), updated_at = now()
        where id = $2
        `,
        [normalizeString(password), existing.user_id]
      );
    }

    await client.query(
      `
      update core.people
      set
        national_id = $1,
        first_name = $2,
        last_name = $3,
        gender = $4,
        birth_date = $5,
        address = $6,
        height_cm = $7,
        weight_kg = $8,
        updated_at = now()
      where id = $9
      `,
      [
        normalizeString(nationalId),
        normalizeString(firstName),
        normalizeString(lastName),
        normalizeString(gender),
        normalizeString(birthDate),
        normalizeString(address),
        parseInteger(heightCm),
        parseNumeric(weightKg),
        existing.person_id,
      ]
    );

    await client.query(
      `
      update core.candidates
      set
        candidate_no = $1,
        status = $2,
        intake_year = $3,
        cohort_id = $4,
        platoon_id = $5,
        background = $6,
        military_no = $7,
        sports_no = $8,
        updated_at = now()
      where id = $9
      `,
      [
        normalizeString(candidateNo),
        normalizeString(status),
        parseInteger(intakeYear),
        normalizeString(cohortId),
        normalizeString(platoonId),
        normalizeString(background),
        normalizeString(militaryNo),
        normalizeString(sportsNo),
        candidateId,
      ]
    );

    await client.query("commit");
    return res.json({ updated: true });
  } catch (error) {
    await client.query("rollback");
    if (error?.code === "23505") {
      return res.status(409).json({ message: "يوجد تعارض في بيانات فريدة." });
    }
    console.error("Update candidate error:", error);
    return res.status(500).json({ message: "تعذر تحديث المرشح." });
  } finally {
    client.release();
  }
});

app.patch(
  "/api/admin/candidates/:id/status",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const candidateId = req.params.id;
      const status = normalizeString(req.body?.status);
      if (!status) {
        return res.status(400).json({ message: "يرجى تحديد الحالة." });
      }

      const result = await pool.query(
        `
        update core.candidates
        set status = $1, updated_at = now()
        where id = $2
        returning id
        `,
        [status, candidateId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "المرشح غير موجود." });
      }

      return res.json({ updated: true });
    } catch (error) {
      console.error("Update candidate status error:", error);
      return res.status(500).json({ message: "تعذر تحديث حالة المرشح." });
    }
  }
);

app.get("/api/admin/cohorts", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(
      `
      select
        coh.id,
        coh.cohort_no,
        coh.name,
        coh.track,
        coh.start_year,
        count(distinct pl.id)::int as platoon_count,
        count(distinct cand.id)::int as candidate_count
      from core.cohorts coh
      left join core.platoons pl on pl.cohort_id = coh.id
      left join core.candidates cand on cand.cohort_id = coh.id
      group by coh.id
      order by coh.cohort_no desc
      `
    );

    return res.json({ rows: result.rows });
  } catch (error) {
    console.error("Admin cohorts error:", error);
    return res.status(500).json({ message: "تعذر تحميل بيانات الدورات." });
  }
});

app.get("/api/admin/platoons", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
    const values = [];
    let whereClause = "";
    if (cohortId) {
      values.push(cohortId);
      whereClause = `where pl.cohort_id = $1`;
    }

    const result = await pool.query(
      `
      select
        pl.id,
        pl.cohort_id,
        pl.platoon_no,
        pl.name,
        coh.cohort_no,
        coh.track,
        count(cand.id)::int as candidate_count
      from core.platoons pl
      join core.cohorts coh on coh.id = pl.cohort_id
      left join core.candidates cand on cand.platoon_id = pl.id
      ${whereClause}
      group by pl.id, coh.cohort_no, coh.track
      order by coh.cohort_no desc, pl.platoon_no asc
      `,
      values
    );

    return res.json({ rows: result.rows });
  } catch (error) {
    console.error("Admin platoons error:", error);
    return res.status(500).json({ message: "تعذر تحميل بيانات الفصائل." });
  }
});

app.post("/api/admin/cohorts", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const { cohortNo, name, track, startYear } = req.body || {};

    if (!cohortNo || !name || !track) {
      return res.status(400).json({ message: "يرجى إدخال رقم الدورة والاسم والنوع." });
    }

    const normalizedTrack = String(track).trim();
    if (!["تأسيسية", "تقدمية"].includes(normalizedTrack)) {
      return res.status(400).json({ message: "نوع الدورة غير صالح." });
    }

    const result = await pool.query(
      `
      insert into core.cohorts (cohort_no, name, track, start_year)
      values ($1, $2, $3, $4)
      returning id, cohort_no, name, track, start_year
      `,
      [Number(cohortNo), String(name).trim(), normalizedTrack, startYear ? Number(startYear) : null]
    );

    return res.status(201).json({ cohort: result.rows[0] });
  } catch (error) {
    console.error("Create cohort error:", error);
    return res.status(500).json({ message: "تعذر إنشاء الدورة." });
  }
});

app.post("/api/admin/platoons", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const { cohortId, platoonNo, name } = req.body || {};

    if (!cohortId || !platoonNo || !name) {
      return res.status(400).json({ message: "يرجى إدخال الدورة ورقم الفصيل والاسم." });
    }

    const result = await pool.query(
      `
      insert into core.platoons (cohort_id, platoon_no, name)
      values ($1, $2, $3)
      returning id, cohort_id, platoon_no, name
      `,
      [cohortId, Number(platoonNo), String(name).trim()]
    );

    return res.status(201).json({ platoon: result.rows[0] });
  } catch (error) {
    console.error("Create platoon error:", error);
    return res.status(500).json({ message: "تعذر إنشاء الفصيل." });
  }
});

app.get(
  "/api/admin/academics/terms",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        select id, name, start_date, end_date
        from academics.terms
        order by start_date desc
        `
      );
      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Admin terms error:", error);
      return res.status(500).json({ message: "تعذر تحميل الفصول الدراسية." });
    }
  }
);

app.get(
  "/api/admin/academics/courses",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const termId = req.query.term_id ? String(req.query.term_id) : null;
      const values = [];
      let whereClause = "";

      if (termId) {
        values.push(termId);
        whereClause = "where cs.term_id = $1";
      }

      const result = await pool.query(
        `
        select distinct
          c.id,
          c.code,
          c.title,
          c.credit_hours
        from academics.courses c
        join academics.course_sections cs on cs.course_id = c.id
        ${whereClause}
        order by c.code
        `,
        values
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Admin courses error:", error);
      return res.status(500).json({ message: "تعذر تحميل المواد." });
    }
  }
);

app.get(
  "/api/admin/academics/sections",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const termId = req.query.term_id ? String(req.query.term_id) : null;
      const courseId = req.query.course_id ? String(req.query.course_id) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (termId) {
        conditions.push(`cs.term_id = $${index}`);
        values.push(termId);
        index += 1;
      }

      if (courseId) {
        conditions.push(`cs.course_id = $${index}`);
        values.push(courseId);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select
          cs.id,
          cs.section_code,
          cs.capacity,
          c.code as course_code,
          c.title as course_title,
          t.name as term_name
        from academics.course_sections cs
        join academics.courses c on c.id = cs.course_id
        join academics.terms t on t.id = cs.term_id
        ${whereClause}
        order by t.start_date desc, c.code, cs.section_code
        `,
        values
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Admin sections error:", error);
      return res.status(500).json({ message: "تعذر تحميل الشعب الدراسية." });
    }
  }
);

app.get(
  "/api/admin/academics/assessments",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const sectionId = req.query.section_id ? String(req.query.section_id) : null;
      if (!sectionId) {
        return res.json({ rows: [] });
      }

      const result = await pool.query(
        `
        select id, name, weight, max_score, due_date
        from academics.assessments
        where section_id = $1
        order by name
        `,
        [sectionId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Admin assessments error:", error);
      return res.status(500).json({ message: "تعذر تحميل التقييمات." });
    }
  }
);

app.get(
  "/api/admin/academics/grades",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const sectionId = req.query.section_id ? String(req.query.section_id) : null;
      const assessmentId = req.query.assessment_id ? String(req.query.assessment_id) : null;

      if (!sectionId || !assessmentId) {
        return res.json({ rows: [] });
      }

      const result = await pool.query(
        `
        select
          cand.id as candidate_id,
          cand.candidate_no,
          p.first_name,
          p.last_name,
          g.score,
          a.max_score
        from academics.enrollments e
        join core.candidates cand on cand.id = e.candidate_id
        join core.people p on p.id = cand.person_id
        join academics.assessments a on a.id = $2
        left join academics.grades g
          on g.candidate_id = cand.id and g.assessment_id = a.id
        where e.section_id = $1
        order by cand.candidate_no
        `,
        [sectionId, assessmentId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Admin grades error:", error);
      return res.status(500).json({ message: "تعذر تحميل الدرجات." });
    }
  }
);

app.post(
  "/api/admin/academics/grades",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { assessmentId, grades } = req.body || {};
      if (!assessmentId || !Array.isArray(grades)) {
        return res.status(400).json({ message: "البيانات غير مكتملة." });
      }

      const payload = grades.filter(
        (item) => item.candidateId && item.score !== null && item.score !== undefined
      );

      if (payload.length === 0) {
        return res.json({ updated: 0 });
      }

      const updates = payload.map((item) => ({
        assessmentId,
        candidateId: item.candidateId,
        score: Number(item.score),
      }));

      const client = await pool.connect();
      try {
        await client.query("begin");

        for (const item of updates) {
          await client.query(
            `
            insert into academics.grades (assessment_id, candidate_id, score)
            values ($1, $2, $3)
            on conflict (assessment_id, candidate_id)
            do update set score = excluded.score, graded_at = now()
            `,
            [item.assessmentId, item.candidateId, item.score]
          );
        }

        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      return res.json({ updated: updates.length });
    } catch (error) {
      console.error("Admin grades upsert error:", error);
      return res.status(500).json({ message: "تعذر حفظ الدرجات." });
    }
  }
);

app.get(
  "/api/admin/attendance/summary",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      if (fromDate) {
        conditions.push(`s.session_at::date >= $${index}`);
        values.push(fromDate);
        index += 1;
      }

      if (toDate) {
        conditions.push(`s.session_at::date <= $${index}`);
        values.push(toDate);
        index += 1;
      }

      const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";

      const summaryQuery = `
        select
          count(*)::int as total_sessions,
          sum(case when a.present then 1 else 0 end)::int as present_sessions,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
      `;

      const dailyQuery = `
        select
          date(s.session_at) as day,
          sum(case when a.present then 1 else 0 end)::int as present_count,
          sum(case when a.present = false then 1 else 0 end)::int as absent_count
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        group by date(s.session_at)
        order by day
      `;

      const [summaryResult, dailyResult] = await Promise.all([
        pool.query(summaryQuery, values),
        pool.query(dailyQuery, values),
      ]);

      const summaryRow = summaryResult.rows[0] || {
        total_sessions: 0,
        present_sessions: 0,
        absent_sessions: 0,
      };

      return res.json({
        summary: {
          total: Number(summaryRow.total_sessions || 0),
          present: Number(summaryRow.present_sessions || 0),
          absent: Number(summaryRow.absent_sessions || 0),
        },
        daily: dailyResult.rows,
      });
    } catch (error) {
      console.error("Attendance summary error:", error);
      return res.status(500).json({ message: "تعذر تحميل ملخص الحضور." });
    }
  }
);

app.get(
  "/api/admin/attendance/roster",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      if (fromDate) {
        conditions.push(`s.session_at::date >= $${index}`);
        values.push(fromDate);
        index += 1;
      }

      if (toDate) {
        conditions.push(`s.session_at::date <= $${index}`);
        values.push(toDate);
        index += 1;
      }

      const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";

      const rosterQuery = `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          count(*)::int as total_sessions,
          sum(case when a.present then 1 else 0 end)::int as present_sessions,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        group by c.id, p.first_name, p.last_name, coh.cohort_no, pl.platoon_no
        order by coh.cohort_no desc nulls last, pl.platoon_no asc nulls last, c.candidate_no
      `;

      const rosterResult = await pool.query(rosterQuery, values);

      const rows = rosterResult.rows.map((row) => ({
        ...row,
        attendance_rate:
          row.total_sessions > 0
            ? Math.round((row.present_sessions / row.total_sessions) * 100)
            : 0,
      }));

      return res.json({ rows });
    } catch (error) {
      console.error("Attendance roster error:", error);
      return res.status(500).json({ message: "تعذر تحميل سجلات الحضور." });
    }
  }
);

app.get(
  "/api/admin/attendance/sections",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const values = [];
      const conditions = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select distinct
          cs.id,
          c.code as course_code,
          c.title as course_title,
          cs.section_code,
          t.name as term_name,
          t.start_date as term_start_date
        from academics.course_sections cs
        join academics.courses c on c.id = cs.course_id
        join academics.terms t on t.id = cs.term_id
        join academics.enrollments e on e.section_id = cs.id
        join core.candidates cand on cand.id = e.candidate_id
        left join core.cohorts coh on coh.id = cand.cohort_id
        left join core.platoons pl on pl.id = cand.platoon_id
        ${whereClause}
        order by term_start_date desc, c.code, cs.section_code
        `,
        values
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Attendance sections error:", error);
      return res.status(500).json({ message: "تعذر تحميل الشعب الخاصة بالحضور." });
    }
  }
);

app.post(
  "/api/admin/attendance/records",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { sectionId, sessionAt, topic, records } = req.body || {};
      if (!sectionId || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "بيانات الجلسة غير مكتملة." });
      }

      await client.query("begin");

      const sessionResult = await client.query(
        `
        insert into academics.attendance_sessions (section_id, session_at, topic)
        values ($1, $2, $3)
        returning id
        `,
        [sectionId, normalizeString(sessionAt) || new Date().toISOString(), normalizeString(topic)]
      );

      const attendanceSessionId = sessionResult.rows[0].id;
      let updated = 0;

      for (const row of records) {
        if (!row?.candidateId) continue;
        const presentValue = parseBoolean(row.present);
        if (presentValue === null) continue;
        await client.query(
          `
          insert into academics.attendance (
            attendance_session_id,
            candidate_id,
            present,
            note
          )
          values ($1, $2, $3, $4)
          on conflict (attendance_session_id, candidate_id)
          do update set
            present = excluded.present,
            note = excluded.note
          `,
          [
            attendanceSessionId,
            String(row.candidateId),
            presentValue,
            normalizeString(row.note),
          ]
        );
        updated += 1;
      }

      await client.query("commit");
      return res.status(201).json({
        attendanceSessionId,
        updated,
      });
    } catch (error) {
      await client.query("rollback");
      console.error("Attendance records create error:", error);
      return res.status(500).json({ message: "تعذر حفظ سجلات الحضور." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/admin/medical/filters",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const [typesResult, statusResult, fitResult] = await Promise.all([
        pool.query(
          `
          select id, code, name
          from medical.exam_types
          order by name
          `
        ),
        pool.query(
          `
          select distinct status
          from medical.exams
          order by status
          `
        ),
        pool.query(
          `
          select distinct fit_status
          from medical.exam_results
          where fit_status is not null
          order by fit_status
          `
        ),
      ]);

      return res.json({
        examTypes: typesResult.rows,
        statuses: statusResult.rows.map((row) => row.status),
        fitStatuses: fitResult.rows.map((row) => row.fit_status),
      });
    } catch (error) {
      console.error("Medical filters error:", error);
      return res.status(500).json({ message: "تعذر تحميل فلاتر الملف الطبي." });
    }
  }
);

function buildMedicalWhereClause(query) {
  const search = query.search ? String(query.search).trim() : "";
  const cohortId = query.cohort_id ? String(query.cohort_id) : null;
  const cohortNo = query.cohort_no ? Number(query.cohort_no) : null;
  const platoonId = query.platoon_id ? String(query.platoon_id) : null;
  const platoonNo = query.platoon_no ? Number(query.platoon_no) : null;
  const examTypeId = query.exam_type_id ? String(query.exam_type_id) : null;
  const status = query.status ? String(query.status).trim() : "";
  const fitStatus = query.fit_status ? String(query.fit_status).trim() : "";
  const fromDate = query.from ? String(query.from) : null;
  const toDate = query.to ? String(query.to) : null;

  const conditions = [];
  const values = [];
  let index = 1;

  if (cohortId) {
    conditions.push(`coh.id = $${index}`);
    values.push(cohortId);
    index += 1;
  } else if (cohortNo) {
    conditions.push(`coh.cohort_no = $${index}`);
    values.push(cohortNo);
    index += 1;
  }

  if (platoonId) {
    conditions.push(`pl.id = $${index}`);
    values.push(platoonId);
    index += 1;
  } else if (platoonNo) {
    conditions.push(`pl.platoon_no = $${index}`);
    values.push(platoonNo);
    index += 1;
  }

  if (examTypeId) {
    conditions.push(`e.exam_type_id = $${index}`);
    values.push(examTypeId);
    index += 1;
  }

  if (status) {
    conditions.push(`e.status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (fitStatus) {
    conditions.push(`r.fit_status = $${index}`);
    values.push(fitStatus);
    index += 1;
  }

  if (fromDate) {
    conditions.push(`coalesce(e.performed_at, e.scheduled_at)::date >= $${index}`);
    values.push(fromDate);
    index += 1;
  }

  if (toDate) {
    conditions.push(`coalesce(e.performed_at, e.scheduled_at)::date <= $${index}`);
    values.push(toDate);
    index += 1;
  }

  if (search) {
    conditions.push(
      `(lower(p.first_name || ' ' || p.last_name) like $${index}
        or lower(c.candidate_no) like $${index}
        or lower(c.military_no) like $${index})`
    );
    values.push(`%${search.toLowerCase()}%`);
    index += 1;
  }

  const whereClause = conditions.length
    ? `where ${conditions.join(" and ")}`
    : "";

  return { whereClause, values };
}

app.get(
  "/api/admin/medical/summary",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { whereClause, values } = buildMedicalWhereClause(req.query);

      const baseQuery = `
        from medical.exams e
        join medical.exam_types et on et.id = e.exam_type_id
        join core.candidates c on c.id = e.candidate_id
        join core.people p on p.id = c.person_id
        left join medical.exam_results r on r.exam_id = e.id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
      `;

      const summaryQuery = `
        select
          count(*)::int as total,
          sum(case when e.status = 'scheduled' then 1 else 0 end)::int as scheduled,
          sum(case when e.status = 'completed' then 1 else 0 end)::int as completed,
          sum(case when r.fit_status = 'fit' then 1 else 0 end)::int as fit,
          sum(case when r.fit_status = 'unfit' then 1 else 0 end)::int as unfit
        ${baseQuery}
        ${whereClause}
      `;

      const statusQuery = `
        select e.status, count(*)::int as count
        ${baseQuery}
        ${whereClause}
        group by e.status
        order by count desc
      `;

      const fitWhereClause = whereClause
        ? `${whereClause} and r.fit_status is not null`
        : "where r.fit_status is not null";

      const fitQuery = `
        select r.fit_status, count(*)::int as count
        ${baseQuery}
        ${fitWhereClause}
        group by r.fit_status
        order by count desc
      `;

      const [summaryResult, statusResult, fitResult] = await Promise.all([
        pool.query(summaryQuery, values),
        pool.query(statusQuery, values),
        pool.query(fitQuery, values),
      ]);

      const summaryRow = summaryResult.rows[0] || {
        total: 0,
        scheduled: 0,
        completed: 0,
        fit: 0,
        unfit: 0,
      };

      return res.json({
        summary: {
          total: Number(summaryRow.total || 0),
          scheduled: Number(summaryRow.scheduled || 0),
          completed: Number(summaryRow.completed || 0),
          fit: Number(summaryRow.fit || 0),
          unfit: Number(summaryRow.unfit || 0),
        },
        statusBreakdown: statusResult.rows,
        fitBreakdown: fitResult.rows,
      });
    } catch (error) {
      console.error("Medical summary error:", error);
      return res.status(500).json({ message: "تعذر تحميل ملخص الملف الطبي." });
    }
  }
);

app.get(
  "/api/admin/medical/exams",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { whereClause, values } = buildMedicalWhereClause(req.query);
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const offset = Number(req.query.offset) || 0;

      const baseQuery = `
        from medical.exams e
        join medical.exam_types et on et.id = e.exam_type_id
        join core.candidates c on c.id = e.candidate_id
        join core.people p on p.id = c.person_id
        left join medical.exam_results r on r.exam_id = e.id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
      `;

      const countQuery = `
        select count(*)::int as total
        ${baseQuery}
        ${whereClause}
      `;

      const dataQuery = `
        select
          e.id,
          e.status,
          e.scheduled_at,
          e.performed_at,
          et.name as exam_name,
          et.code as exam_code,
          r.fit_status,
          r.summary,
          c.candidate_no,
          c.military_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no
        ${baseQuery}
        ${whereClause}
        order by coalesce(e.performed_at, e.scheduled_at) desc nulls last
        limit $${values.length + 1} offset $${values.length + 2}
      `;

      const [countResult, dataResult] = await Promise.all([
        pool.query(countQuery, values),
        pool.query(dataQuery, [...values, limit, offset]),
      ]);

      return res.json({
        total: countResult.rows[0]?.total || 0,
        rows: dataResult.rows,
      });
    } catch (error) {
      console.error("Medical exams error:", error);
      return res.status(500).json({ message: "تعذر تحميل السجلات الطبية." });
    }
  }
);

app.post(
  "/api/admin/medical/exams",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { candidateId, examTypeId, scheduledAt, status } = req.body || {};
      if (!candidateId || !examTypeId) {
        return res.status(400).json({ message: "يرجى اختيار المرشح ونوع الفحص." });
      }

      const result = await pool.query(
        `
        insert into medical.exams (
          candidate_id,
          exam_type_id,
          scheduled_at,
          status
        )
        values ($1, $2, $3, $4)
        returning id
        `,
        [
          String(candidateId),
          String(examTypeId),
          normalizeString(scheduledAt) || new Date().toISOString(),
          normalizeString(status) || "scheduled",
        ]
      );

      return res.status(201).json({ examId: result.rows[0].id });
    } catch (error) {
      console.error("Create medical exam error:", error);
      return res.status(500).json({ message: "تعذر إنشاء الفحص الطبي." });
    }
  }
);

app.put(
  "/api/admin/medical/exams/:id/result",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const examId = req.params.id;
      const { status, performedAt, fitStatus, summary } = req.body || {};
      const normalizedStatus = normalizeString(status) || "completed";

      await client.query("begin");
      const examUpdateResult = await client.query(
        `
        update medical.exams
        set status = $1, performed_at = $2
        where id = $3
        returning id
        `,
        [normalizedStatus, normalizeString(performedAt) || new Date().toISOString(), examId]
      );

      if (examUpdateResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ message: "الفحص الطبي غير موجود." });
      }

      if (normalizeString(fitStatus) || normalizeString(summary)) {
        await client.query(
          `
          insert into medical.exam_results (exam_id, summary, fit_status, recorded_by)
          values ($1, $2, $3, $4)
          on conflict (exam_id)
          do update set
            summary = excluded.summary,
            fit_status = excluded.fit_status,
            recorded_by = excluded.recorded_by,
            recorded_at = now()
          `,
          [
            examId,
            normalizeString(summary),
            normalizeString(fitStatus) || "fit",
            req.user.userId,
          ]
        );
      }

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Update medical result error:", error);
      return res.status(500).json({ message: "تعذر تحديث نتيجة الفحص." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/admin/medical/notes",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const { candidateId, note } = req.body || {};
      if (!candidateId || !normalizeString(note)) {
        return res.status(400).json({ message: "يرجى إدخال المرشح والملاحظة." });
      }

      await pool.query(
        `
        insert into medical.medical_notes (candidate_id, note, created_by)
        values ($1, $2, $3)
        `,
        [String(candidateId), normalizeString(note), req.user.userId]
      );

      return res.status(201).json({ created: true });
    } catch (error) {
      console.error("Create medical note error:", error);
      return res.status(500).json({ message: "تعذر حفظ الملاحظة الطبية." });
    }
  }
);

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map((header) => header.label).join(","));
  rows.forEach((row) => {
    lines.push(
      headers.map((header) => escapeCsv(row[header.key])).join(",")
    );
  });
  return `\uFEFF${lines.join("\n")}`;
}

function sanitizePdfText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdf({ title, subtitle, headers, rows }) {
  const safeTitle = sanitizePdfText(title);
  const safeSubtitle = sanitizePdfText(subtitle);
  const headerLine = sanitizePdfText(headers.join(" | "));
  const lines = [headerLine, "-".repeat(Math.min(headerLine.length, 120))];

  rows.slice(0, 70).forEach((row) => {
    const line = headers
      .map((header, index) => `${header}:${sanitizePdfText(row[index])}`)
      .join(" | ");
    lines.push(line.slice(0, 180));
  });

  const startY = 760;
  const lineHeight = 12;
  const contentLines = [
    "BT",
    "/F1 14 Tf",
    `50 ${startY} Td`,
    `(${safeTitle}) Tj`,
    "0 -18 Td",
    "/F1 10 Tf",
    `(${safeSubtitle}) Tj`,
    "0 -18 Td",
  ];

  lines.forEach((line) => {
    contentLines.push(`(${sanitizePdfText(line)}) Tj`);
    contentLines.push(`0 -${lineHeight} Td`);
  });
  contentLines.push("ET");

  const contentStream = contentLines.join("\n");
  const contentLength = Buffer.byteLength(contentStream, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const xrefOffsets = [0];
  objects.forEach((object) => {
    xrefOffsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  });

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${xrefOffsets.length}\n`;
  pdf += "0000000000 65535 f \n";
  xrefOffsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${xrefOffsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

app.get(
  "/api/admin/reports/summary",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const candidatesByCohortPromise = pool.query(
        `
        select coh.cohort_no, coh.track, count(c.id)::int as count
        from core.cohorts coh
        left join core.candidates c on c.cohort_id = coh.id
        group by coh.cohort_no, coh.track
        order by coh.cohort_no desc
        `
      );

      const gradesByCoursePromise = pool.query(
        `
        select
          c.code,
          c.title,
          round(avg(g.score)::numeric, 2) as average_score,
          count(*)::int as total_grades
        from academics.grades g
        join academics.assessments a on a.id = g.assessment_id
        join academics.course_sections cs on cs.id = a.section_id
        join academics.courses c on c.id = cs.course_id
        group by c.code, c.title
        order by average_score desc nulls last
        limit 8
        `
      );

      const attendanceByCohortPromise = pool.query(
        `
        select
          coh.cohort_no,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(a.id), 0)) * 100,
            2
          ) as attendance_rate
        from core.cohorts coh
        left join core.candidates c on c.cohort_id = coh.id
        left join academics.attendance a on a.candidate_id = c.id
        group by coh.cohort_no
        order by coh.cohort_no desc
        `
      );

      const requestsByStatusPromise = pool.query(
        `
        select status, count(*)::int as count
        from core.requests
        group by status
        order by count desc
        `
      );

      const medicalByStatusPromise = pool.query(
        `
        select status, count(*)::int as count
        from medical.exams
        group by status
        order by count desc
        `
      );

      const [
        candidatesByCohortResult,
        gradesByCourseResult,
        attendanceByCohortResult,
        requestsByStatusResult,
        medicalByStatusResult,
      ] = await Promise.all([
        candidatesByCohortPromise,
        gradesByCoursePromise,
        attendanceByCohortPromise,
        requestsByStatusPromise,
        medicalByStatusPromise,
      ]);

      return res.json({
        candidatesByCohort: candidatesByCohortResult.rows,
        gradesByCourse: gradesByCourseResult.rows,
        attendanceByCohort: attendanceByCohortResult.rows,
        requestsByStatus: requestsByStatusResult.rows,
        medicalByStatus: medicalByStatusResult.rows,
      });
    } catch (error) {
      console.error("Reports summary error:", error);
      return res.status(500).json({ message: "تعذر تحميل التقارير." });
    }
  }
);

app.get(
  "/api/admin/reports/advanced",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;
      const termId = req.query.term_id ? String(req.query.term_id) : null;
      const courseId = req.query.course_id ? String(req.query.course_id) : null;

      const candidateConditions = [];
      const candidateValues = [];
      let index = 1;

      if (cohortId) {
        candidateConditions.push(`coh.id = $${index}`);
        candidateValues.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        candidateConditions.push(`coh.cohort_no = $${index}`);
        candidateValues.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        candidateConditions.push(`pl.id = $${index}`);
        candidateValues.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        candidateConditions.push(`pl.platoon_no = $${index}`);
        candidateValues.push(platoonNo);
        index += 1;
      }

      const candidateWhere = candidateConditions.length
        ? `where ${candidateConditions.join(" and ")}`
        : "";

      const candidatesByCohortPromise = pool.query(
        `
        select coh.cohort_no, coh.track, count(c.id)::int as count
        from core.cohorts coh
        left join core.candidates c on c.cohort_id = coh.id
        left join core.platoons pl on pl.id = c.platoon_id
        ${candidateWhere}
        group by coh.cohort_no, coh.track
        order by coh.cohort_no desc
        `,
        candidateValues
      );

      const attendanceConditions = [...candidateConditions];
      const attendanceValues = [...candidateValues];

      if (fromDate) {
        attendanceConditions.push(
          `s.session_at::date >= $${attendanceValues.length + 1}`
        );
        attendanceValues.push(fromDate);
      }
      if (toDate) {
        attendanceConditions.push(
          `s.session_at::date <= $${attendanceValues.length + 1}`
        );
        attendanceValues.push(toDate);
      }
      if (!fromDate && !toDate) {
        attendanceConditions.push(`s.session_at >= now() - interval '14 days'`);
      }

      const attendanceWhere = attendanceConditions.length
        ? `where ${attendanceConditions.join(" and ")}`
        : "";

      const attendanceDailyPromise = pool.query(
        `
        select
          date(s.session_at) as day,
          sum(case when a.present then 1 else 0 end)::int as present_count,
          sum(case when a.present = false then 1 else 0 end)::int as absent_count
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${attendanceWhere}
        group by date(s.session_at)
        order by day
        `,
        attendanceValues
      );

      const gradesConditions = [...candidateConditions];
      const gradesValues = [...candidateValues];

      if (termId) {
        gradesConditions.push(`cs.term_id = $${gradesValues.length + 1}`);
        gradesValues.push(termId);
      }
      if (courseId) {
        gradesConditions.push(`cs.course_id = $${gradesValues.length + 1}`);
        gradesValues.push(courseId);
      }

      const gradesWhere = gradesConditions.length
        ? `where ${gradesConditions.join(" and ")}`
        : "";

      const gradesByCoursePromise = pool.query(
        `
        select
          c.code,
          c.title,
          round(avg(g.score)::numeric, 2) as average_score,
          count(*)::int as total_grades
        from academics.grades g
        join academics.assessments a on a.id = g.assessment_id
        join academics.course_sections cs on cs.id = a.section_id
        join academics.courses c on c.id = cs.course_id
        join core.candidates cand on cand.id = g.candidate_id
        left join core.cohorts coh on coh.id = cand.cohort_id
        left join core.platoons pl on pl.id = cand.platoon_id
        ${gradesWhere}
        group by c.code, c.title
        order by average_score desc nulls last
        limit 8
        `,
        gradesValues
      );

      const requestsConditions = [...candidateConditions];
      const requestsValues = [...candidateValues];
      if (fromDate) {
        requestsConditions.push(
          `r.submitted_at::date >= $${requestsValues.length + 1}`
        );
        requestsValues.push(fromDate);
      }
      if (toDate) {
        requestsConditions.push(
          `r.submitted_at::date <= $${requestsValues.length + 1}`
        );
        requestsValues.push(toDate);
      }
      if (!fromDate && !toDate) {
        requestsConditions.push(`r.submitted_at >= now() - interval '14 days'`);
      }

      const requestsWhere = requestsConditions.length
        ? `where ${requestsConditions.join(" and ")}`
        : "";

      const requestsDailyPromise = pool.query(
        `
        select date(r.submitted_at) as day, count(*)::int as count
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${requestsWhere}
        group by date(r.submitted_at)
        order by day
        `,
        requestsValues
      );

      const medicalByFitPromise = pool.query(
        `
        select r.fit_status, count(*)::int as count
        from medical.exam_results r
        join medical.exams e on e.id = r.exam_id
        join core.candidates c on c.id = e.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${candidateWhere}
        group by r.fit_status
        order by count desc
        `,
        candidateValues
      );

      const topAbsenceConditions = [...candidateConditions];
      const topAbsenceValues = [...candidateValues];
      if (fromDate) {
        topAbsenceConditions.push(
          `s.session_at::date >= $${topAbsenceValues.length + 1}`
        );
        topAbsenceValues.push(fromDate);
      }
      if (toDate) {
        topAbsenceConditions.push(
          `s.session_at::date <= $${topAbsenceValues.length + 1}`
        );
        topAbsenceValues.push(toDate);
      }
      if (!fromDate && !toDate) {
        topAbsenceConditions.push(`s.session_at >= now() - interval '30 days'`);
      }

      const topAbsenceWhere = topAbsenceConditions.length
        ? `where ${topAbsenceConditions.join(" and ")}`
        : "";

      const topAbsencesPromise = pool.query(
        `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${topAbsenceWhere}
        group by c.id, p.first_name, p.last_name, coh.cohort_no, pl.platoon_no
        order by absent_sessions desc
        limit 8
        `,
        topAbsenceValues
      );

      const totalCandidatesPromise = pool.query(
        `
        select count(*)::int as total
        from core.candidates c
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${candidateWhere}
        `,
        candidateValues
      );

      const pendingConditions = [
        ...candidateConditions,
        "r.status in ('submitted', 'in_review')",
      ];
      const pendingWhere = pendingConditions.length
        ? `where ${pendingConditions.join(" and ")}`
        : "";

      const pendingRequestsPromise = pool.query(
        `
        select count(*)::int as total
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${pendingWhere}
        `,
        candidateValues
      );

      const attendanceRatePromise = pool.query(
        `
        select
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(a.id), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${attendanceWhere}
        `,
        attendanceValues
      );

      const averageGradePromise = pool.query(
        `
        select round(avg(g.score)::numeric, 2) as average_score
        from academics.grades g
        join academics.assessments a on a.id = g.assessment_id
        join academics.course_sections cs on cs.id = a.section_id
        join core.candidates c on c.id = g.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${gradesWhere}
        `,
        gradesValues
      );

      const [
        candidatesByCohortResult,
        attendanceDailyResult,
        gradesByCourseResult,
        requestsDailyResult,
        medicalByFitResult,
        topAbsencesResult,
        totalCandidatesResult,
        pendingRequestsResult,
        attendanceRateResult,
        averageGradeResult,
      ] = await Promise.all([
        candidatesByCohortPromise,
        attendanceDailyPromise,
        gradesByCoursePromise,
        requestsDailyPromise,
        medicalByFitPromise,
        topAbsencesPromise,
        totalCandidatesPromise,
        pendingRequestsPromise,
        attendanceRatePromise,
        averageGradePromise,
      ]);

      return res.json({
        summary: {
          totalCandidates: totalCandidatesResult.rows[0]?.total || 0,
          pendingRequests: pendingRequestsResult.rows[0]?.total || 0,
          attendanceRate: attendanceRateResult.rows[0]?.attendance_rate || 0,
          averageGrade: averageGradeResult.rows[0]?.average_score || null,
        },
        candidatesByCohort: candidatesByCohortResult.rows,
        attendanceDaily: attendanceDailyResult.rows,
        gradesByCourse: gradesByCourseResult.rows,
        requestsDaily: requestsDailyResult.rows,
        medicalByFit: medicalByFitResult.rows,
        topAbsences: topAbsencesResult.rows,
      });
    } catch (error) {
      console.error("Advanced reports error:", error);
      return res.status(500).json({ message: "تعذر تحميل التقرير المتقدم." });
    }
  }
);

app.get(
  "/api/admin/reports/saved",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureSavedReportsTable();
      const userId = req.user.userId;
      const result = await pool.query(
        `
        select id, name, description, report_type, filters, created_at, updated_at
        from core.saved_reports
        where created_by = $1
        order by created_at desc
        `,
        [userId]
      );
      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Saved reports list error:", error);
      return res
        .status(500)
        .json({ message: "تعذر تحميل التقارير المحفوظة." });
    }
  }
);

app.post(
  "/api/admin/reports/saved",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureSavedReportsTable();
      const userId = req.user.userId;
      const { name, description, reportType, filters } = req.body || {};

      if (!name) {
        return res.status(400).json({ message: "يرجى إدخال اسم التقرير." });
      }

      const result = await pool.query(
        `
        insert into core.saved_reports (name, description, report_type, filters, created_by)
        values ($1, $2, $3, $4, $5)
        on conflict (created_by, name)
        do update set
          description = excluded.description,
          report_type = excluded.report_type,
          filters = excluded.filters,
          updated_at = now()
        returning id, name, description, report_type, filters, created_at, updated_at
        `,
        [
          String(name).trim(),
          description ? String(description).trim() : null,
          reportType ? String(reportType).trim() : "executive",
          filters || {},
          userId,
        ]
      );

      return res.status(201).json({ report: result.rows[0] });
    } catch (error) {
      console.error("Saved report create error:", error);
      return res.status(500).json({ message: "تعذر حفظ التقرير." });
    }
  }
);

app.delete(
  "/api/admin/reports/saved/:id",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureSavedReportsTable();
      const userId = req.user.userId;
      const reportId = req.params.id;
      const result = await pool.query(
        `
        delete from core.saved_reports
        where id = $1 and created_by = $2
        returning id
        `,
        [reportId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "التقرير غير موجود." });
      }

      return res.json({ deleted: true });
    } catch (error) {
      console.error("Saved report delete error:", error);
      return res.status(500).json({ message: "تعذر حذف التقرير." });
    }
  }
);

app.get(
  "/api/admin/leadership/overview",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;

      const defaultFromDate = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);
      const defaultToDate = new Date().toISOString().slice(0, 10);
      const fromValue = fromDate || defaultFromDate;
      const toValue = toDate || defaultToDate;

      const cohortConditions = [];
      const cohortValues = [];
      let index = 1;

      if (cohortId) {
        cohortConditions.push(`coh.id = $${index}`);
        cohortValues.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        cohortConditions.push(`coh.cohort_no = $${index}`);
        cohortValues.push(cohortNo);
        index += 1;
      }

      const cohortWhere = cohortConditions.length
        ? `where ${cohortConditions.join(" and ")}`
        : "";

      const dateRangeStartIndex = cohortValues.length + 1;
      const dateRangeEndIndex = cohortValues.length + 2;
      const dateRangeValues = [...cohortValues, fromValue, toValue];

      const buildDateWhere = (column) =>
        cohortWhere
          ? `${cohortWhere} and ${column} between $${dateRangeStartIndex} and $${dateRangeEndIndex}`
          : `where ${column} between $${dateRangeStartIndex} and $${dateRangeEndIndex}`;

      const enrolledWhere = cohortWhere
        ? `${cohortWhere} and c.status = 'enrolled'`
        : "where c.status = 'enrolled'";

      const pendingWhere = cohortWhere
        ? `${cohortWhere} and r.status in ('submitted', 'in_review')`
        : "where r.status in ('submitted', 'in_review')";

      const medicalWhere = cohortWhere
        ? `${cohortWhere} and e.status = 'scheduled'`
        : "where e.status = 'scheduled'";

      const totalCandidatesPromise = pool.query(
        `
        select count(*)::int as total
        from core.candidates c
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere}
        `,
        cohortValues
      );

      const enrolledCandidatesPromise = pool.query(
        `
        select count(*)::int as total
        from core.candidates c
        left join core.cohorts coh on coh.id = c.cohort_id
        ${enrolledWhere}
        `,
        cohortValues
      );

      const attendanceRatePromise = pool.query(
        `
        select round(
          (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(a.id), 0)) * 100,
          2
        ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("s.session_at::date")}
        `,
        dateRangeValues
      );

      const highAbsenceAlertsPromise = pool.query(
        `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("s.session_at::date")}
        group by c.id, c.candidate_no, p.first_name, p.last_name
        having round(
          (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
          2
        ) < 75
        order by attendance_rate asc
        limit 10
        `,
        dateRangeValues
      );

      const lowGradesAlertsPromise = pool.query(
        `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          round(avg(g.score)::numeric, 2) as average_score
        from academics.grades g
        join core.candidates c on c.id = g.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("g.graded_at::date")}
        group by c.id, c.candidate_no, p.first_name, p.last_name
        having round(avg(g.score)::numeric, 2) < 60
        order by average_score asc
        limit 10
        `,
        dateRangeValues
      );

      const criticalMedicalAlertsPromise = pool.query(
        `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          er.fit_status,
          coalesce(e.performed_at, e.scheduled_at, er.recorded_at) as event_at
        from medical.exam_results er
        join medical.exams e on e.id = er.exam_id
        join core.candidates c on c.id = e.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("coalesce(e.performed_at, e.scheduled_at, er.recorded_at)::date")}
          and er.fit_status in ('unfit', 'fit_with_limits')
        order by event_at desc
        limit 10
        `,
        dateRangeValues
      );

      const agingRequestsAlertsPromise = pool.query(
        `
        select count(*)::int as count
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and r.status in ('submitted', 'in_review') and r.submitted_at < now() - interval '7 days'` : "where r.status in ('submitted', 'in_review') and r.submitted_at < now() - interval '7 days'"}
        `,
        cohortValues
      );

      const weeklyAttendancePromise = pool.query(
        `
        select round(
          (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(a.id), 0)) * 100,
          2
        ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and s.session_at >= now() - interval '7 days'` : "where s.session_at >= now() - interval '7 days'"}
        `,
        cohortValues
      );

      const weeklyGradesPromise = pool.query(
        `
        select round(avg(g.score)::numeric, 2) as average_score
        from academics.grades g
        join core.candidates c on c.id = g.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and g.graded_at >= now() - interval '7 days'` : "where g.graded_at >= now() - interval '7 days'"}
        `,
        cohortValues
      );

      const weeklyRequestsPromise = pool.query(
        `
        select count(*)::int as count
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and r.submitted_at >= now() - interval '7 days'` : "where r.submitted_at >= now() - interval '7 days'"}
        `,
        cohortValues
      );

      const weeklyCriticalMedicalPromise = pool.query(
        `
        select count(*)::int as count
        from medical.exam_results er
        join medical.exams e on e.id = er.exam_id
        join core.candidates c on c.id = e.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and coalesce(e.performed_at, e.scheduled_at, er.recorded_at) >= now() - interval '7 days'` : "where coalesce(e.performed_at, e.scheduled_at, er.recorded_at) >= now() - interval '7 days'"}
          and er.fit_status in ('unfit', 'fit_with_limits')
        `,
        cohortValues
      );

      const averageGradePromise = pool.query(
        `
        select round(avg(g.score)::numeric, 2) as average_score
        from academics.grades g
        join core.candidates c on c.id = g.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("g.graded_at::date")}
        `,
        dateRangeValues
      );

      const pendingRequestsPromise = pool.query(
        `
        select count(*)::int as total
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${pendingWhere}
        `,
        cohortValues
      );

      const medicalPendingPromise = pool.query(
        `
        select count(*)::int as total
        from medical.exams e
        join core.candidates c on c.id = e.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${medicalWhere}
        `,
        cohortValues
      );

      const attendanceDailyPromise = pool.query(
        `
        with days as (
          select generate_series(
            date_trunc('day', $${dateRangeStartIndex}::date),
            date_trunc('day', $${dateRangeEndIndex}::date),
            interval '1 day'
          )::date as day
        )
        select
          d.day,
          coalesce(sum(case when a.present then 1 else 0 end), 0)::int as present_count,
          coalesce(sum(case when a.present = false then 1 else 0 end), 0)::int as absent_count
        from days d
        left join academics.attendance_sessions s on date(s.session_at) = d.day
        left join academics.attendance a on a.attendance_session_id = s.id
        left join core.candidates c on c.id = a.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere}
        group by d.day
        order by d.day
        `,
        dateRangeValues
      );

      const requestsDailyPromise = pool.query(
        `
        with days as (
          select generate_series(
            date_trunc('day', $${dateRangeStartIndex}::date),
            date_trunc('day', $${dateRangeEndIndex}::date),
            interval '1 day'
          )::date as day
        )
        select d.day, count(r.id)::int as count
        from days d
        left join core.requests r on date(r.submitted_at) = d.day
        left join core.candidates c on c.id = r.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere}
        group by d.day
        order by d.day
        `,
        dateRangeValues
      );

      const gradesMonthlyPromise = pool.query(
        `
        select
          to_char(date_trunc('month', g.graded_at), 'YYYY-MM') as month,
          round(avg(g.score)::numeric, 2) as average_score
        from academics.grades g
        join core.candidates c on c.id = g.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere ? `${cohortWhere} and g.graded_at >= date_trunc('month', now()) - interval '5 months'` : "where g.graded_at >= date_trunc('month', now()) - interval '5 months'"}
        group by date_trunc('month', g.graded_at)
        order by date_trunc('month', g.graded_at)
        `,
        cohortValues
      );

      const medicalStatusPromise = pool.query(
        `
        select e.status, count(*)::int as count
        from medical.exams e
        join core.candidates c on c.id = e.candidate_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${cohortWhere}
        group by e.status
        order by count desc
        `,
        cohortValues
      );

      const topAbsencesPromise = pool.query(
        `
        select
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        ${buildDateWhere("s.session_at::date")}
        group by c.id, p.first_name, p.last_name, coh.cohort_no
        order by absent_sessions desc
        limit 6
        `,
        dateRangeValues
      );

      const [
        totalCandidatesResult,
        enrolledCandidatesResult,
        attendanceRateResult,
        averageGradeResult,
        pendingRequestsResult,
        medicalPendingResult,
        attendanceDailyResult,
        requestsDailyResult,
        gradesMonthlyResult,
        medicalStatusResult,
        topAbsencesResult,
        highAbsenceAlertsResult,
        lowGradesAlertsResult,
        criticalMedicalAlertsResult,
        agingRequestsAlertsResult,
        weeklyAttendanceResult,
        weeklyGradesResult,
        weeklyRequestsResult,
        weeklyCriticalMedicalResult,
      ] = await Promise.all([
        totalCandidatesPromise,
        enrolledCandidatesPromise,
        attendanceRatePromise,
        averageGradePromise,
        pendingRequestsPromise,
        medicalPendingPromise,
        attendanceDailyPromise,
        requestsDailyPromise,
        gradesMonthlyPromise,
        medicalStatusPromise,
        topAbsencesPromise,
        highAbsenceAlertsPromise,
        lowGradesAlertsPromise,
        criticalMedicalAlertsPromise,
        agingRequestsAlertsPromise,
        weeklyAttendancePromise,
        weeklyGradesPromise,
        weeklyRequestsPromise,
        weeklyCriticalMedicalPromise,
      ]);

      const alerts = [];
      if ((highAbsenceAlertsResult.rows || []).length > 0) {
        alerts.push({
          type: "attendance",
          severity: "high",
          title: "ارتفاع الغياب",
          description: `عدد المرشحين دون 75% حضور: ${highAbsenceAlertsResult.rows.length}`,
          rows: highAbsenceAlertsResult.rows,
        });
      }
      if ((lowGradesAlertsResult.rows || []).length > 0) {
        alerts.push({
          type: "grades",
          severity: "high",
          title: "انخفاض الدرجات",
          description: `عدد المرشحين دون 60 درجة: ${lowGradesAlertsResult.rows.length}`,
          rows: lowGradesAlertsResult.rows,
        });
      }
      if ((criticalMedicalAlertsResult.rows || []).length > 0) {
        alerts.push({
          type: "medical",
          severity: "critical",
          title: "حالات طبية حرجة",
          description: `عدد الحالات الحرجة: ${criticalMedicalAlertsResult.rows.length}`,
          rows: criticalMedicalAlertsResult.rows,
        });
      }
      if (Number(agingRequestsAlertsResult.rows[0]?.count || 0) > 0) {
        alerts.push({
          type: "requests",
          severity: "medium",
          title: "طلبات متأخرة",
          description: `طلبات تتجاوز 7 أيام دون إغلاق: ${agingRequestsAlertsResult.rows[0]?.count || 0}`,
        });
      }

      return res.json({
        summary: {
          totalCandidates: totalCandidatesResult.rows[0]?.total || 0,
          enrolledCandidates: enrolledCandidatesResult.rows[0]?.total || 0,
          attendanceRate: attendanceRateResult.rows[0]?.attendance_rate || 0,
          averageGrade: averageGradeResult.rows[0]?.average_score || null,
          pendingRequests: pendingRequestsResult.rows[0]?.total || 0,
          medicalPending: medicalPendingResult.rows[0]?.total || 0,
        },
        attendanceDaily: attendanceDailyResult.rows,
        requestsDaily: requestsDailyResult.rows,
        gradesMonthly: gradesMonthlyResult.rows,
        medicalStatus: medicalStatusResult.rows,
        topAbsences: topAbsencesResult.rows,
        alerts,
        weekly: {
          attendanceRate: Number(weeklyAttendanceResult.rows[0]?.attendance_rate || 0),
          averageGrade: Number(weeklyGradesResult.rows[0]?.average_score || 0),
          newRequests: Number(weeklyRequestsResult.rows[0]?.count || 0),
          criticalMedical: Number(weeklyCriticalMedicalResult.rows[0]?.count || 0),
        },
      });
    } catch (error) {
      console.error("Leadership overview error:", error);
      return res.status(500).json({ message: "تعذر تحميل لوحة القيادة." });
    }
  }
);

function parseScopeReportFilters(query) {
  return {
    cohortId: query.cohort_id ? String(query.cohort_id) : null,
    cohortNo: query.cohort_no ? Number(query.cohort_no) : null,
    platoonId: query.platoon_id ? String(query.platoon_id) : null,
    platoonNo: query.platoon_no ? Number(query.platoon_no) : null,
  };
}

function buildScopeWhereClause({ cohortId, cohortNo, platoonId, platoonNo }) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (cohortId) {
    conditions.push(`coh.id = $${index}`);
    values.push(cohortId);
    index += 1;
  } else if (cohortNo) {
    conditions.push(`coh.cohort_no = $${index}`);
    values.push(cohortNo);
    index += 1;
  }

  if (platoonId) {
    conditions.push(`pl.id = $${index}`);
    values.push(platoonId);
    index += 1;
  } else if (platoonNo) {
    conditions.push(`pl.platoon_no = $${index}`);
    values.push(platoonNo);
    index += 1;
  }

  return {
    whereClause: conditions.length ? `where ${conditions.join(" and ")}` : "",
    values,
    nextIndex: index,
  };
}

app.get(
  "/api/admin/reports/candidates.csv",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const conditions = [];
      const values = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          c.background,
          c.military_no,
          c.sports_no,
          c.status
        from core.candidates c
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        order by coh.cohort_no desc nulls last, pl.platoon_no asc nulls last, c.candidate_no
        `,
        values
      );

      const csv = buildCsv(
        [
          { key: "candidate_no", label: "رقم المرشح" },
          { key: "first_name", label: "الاسم الأول" },
          { key: "last_name", label: "اسم العائلة" },
          { key: "cohort_no", label: "رقم الدورة" },
          { key: "platoon_no", label: "رقم الفصيل" },
          { key: "background", label: "الخلفية" },
          { key: "military_no", label: "الرقم العسكري" },
          { key: "sports_no", label: "الرقم الرياضي" },
          { key: "status", label: "الحالة" },
        ],
        result.rows
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"candidates_report.csv\""
      );
      return res.send(csv);
    } catch (error) {
      console.error("Candidates report error:", error);
      return res.status(500).json({ message: "تعذر تصدير تقرير المرشحين." });
    }
  }
);

app.get(
  "/api/admin/reports/attendance.csv",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      if (fromDate) {
        conditions.push(`s.session_at::date >= $${index}`);
        values.push(fromDate);
        index += 1;
      }

      if (toDate) {
        conditions.push(`s.session_at::date <= $${index}`);
        values.push(toDate);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          count(*)::int as total_sessions,
          sum(case when a.present then 1 else 0 end)::int as present_sessions,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        group by c.candidate_no, p.first_name, p.last_name, coh.cohort_no, pl.platoon_no
        order by coh.cohort_no desc nulls last, pl.platoon_no asc nulls last, c.candidate_no
        `,
        values
      );

      const csv = buildCsv(
        [
          { key: "candidate_no", label: "رقم المرشح" },
          { key: "first_name", label: "الاسم الأول" },
          { key: "last_name", label: "اسم العائلة" },
          { key: "cohort_no", label: "رقم الدورة" },
          { key: "platoon_no", label: "رقم الفصيل" },
          { key: "total_sessions", label: "إجمالي الجلسات" },
          { key: "present_sessions", label: "الحضور" },
          { key: "absent_sessions", label: "الغياب" },
          { key: "attendance_rate", label: "نسبة الحضور" },
        ],
        result.rows
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"attendance_report.csv\""
      );
      return res.send(csv);
    } catch (error) {
      console.error("Attendance report error:", error);
      return res.status(500).json({ message: "تعذر تصدير تقرير الحضور." });
    }
  }
);

app.get(
  "/api/admin/reports/grades.csv",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const cohortId = req.query.cohort_id ? String(req.query.cohort_id) : null;
      const cohortNo = req.query.cohort_no ? Number(req.query.cohort_no) : null;
      const platoonId = req.query.platoon_id ? String(req.query.platoon_id) : null;
      const platoonNo = req.query.platoon_no ? Number(req.query.platoon_no) : null;
      const termId = req.query.term_id ? String(req.query.term_id) : null;
      const courseId = req.query.course_id ? String(req.query.course_id) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      if (termId) {
        conditions.push(`cs.term_id = $${index}`);
        values.push(termId);
        index += 1;
      }

      if (courseId) {
        conditions.push(`cs.course_id = $${index}`);
        values.push(courseId);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          course.code as course_code,
          course.title as course_title,
          a.name as assessment_name,
          g.score,
          a.max_score
        from academics.grades g
        join academics.assessments a on a.id = g.assessment_id
        join academics.course_sections cs on cs.id = a.section_id
        join academics.courses course on course.id = cs.course_id
        join core.candidates c on c.id = g.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        order by coh.cohort_no desc nulls last, c.candidate_no, course.code
        `,
        values
      );

      const csv = buildCsv(
        [
          { key: "candidate_no", label: "رقم المرشح" },
          { key: "first_name", label: "الاسم الأول" },
          { key: "last_name", label: "اسم العائلة" },
          { key: "cohort_no", label: "رقم الدورة" },
          { key: "platoon_no", label: "رقم الفصيل" },
          { key: "course_code", label: "رمز المادة" },
          { key: "course_title", label: "المادة" },
          { key: "assessment_name", label: "التقييم" },
          { key: "score", label: "الدرجة" },
          { key: "max_score", label: "الحد الأعلى" },
        ],
        result.rows
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"grades_report.csv\""
      );
      return res.send(csv);
    } catch (error) {
      console.error("Grades report error:", error);
      return res.status(500).json({ message: "تعذر تصدير تقرير الدرجات." });
    }
  }
);

app.get(
  "/api/admin/reports/candidates.pdf",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const scope = parseScopeReportFilters(req.query);
      const { whereClause, values } = buildScopeWhereClause(scope);
      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          c.background,
          c.military_no,
          c.status
        from core.candidates c
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        order by coh.cohort_no desc nulls last, pl.platoon_no asc nulls last, c.candidate_no
        limit 80
        `,
        values
      );

      const pdf = buildSimplePdf({
        title: "Official Candidates Report",
        subtitle: `Generated: ${new Date().toISOString()}`,
        headers: ["CandidateNo", "Name", "Cohort", "Platoon", "Background", "MilitaryNo", "Status"],
        rows: result.rows.map((row) => [
          row.candidate_no || "",
          `${row.first_name || ""} ${row.last_name || ""}`.trim(),
          row.cohort_no || "",
          row.platoon_no || "",
          row.background || "",
          row.military_no || "",
          row.status || "",
        ]),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"candidates_report.pdf\""
      );
      return res.send(pdf);
    } catch (error) {
      console.error("Candidates PDF report error:", error);
      return res.status(500).json({ message: "تعذر تصدير PDF المرشحين." });
    }
  }
);

app.get(
  "/api/admin/reports/attendance.pdf",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const scope = parseScopeReportFilters(req.query);
      const fromDate = req.query.from ? String(req.query.from) : null;
      const toDate = req.query.to ? String(req.query.to) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (scope.cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(scope.cohortId);
        index += 1;
      } else if (scope.cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(scope.cohortNo);
        index += 1;
      }
      if (scope.platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(scope.platoonId);
        index += 1;
      } else if (scope.platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(scope.platoonNo);
        index += 1;
      }
      if (fromDate) {
        conditions.push(`s.session_at::date >= $${index}`);
        values.push(fromDate);
        index += 1;
      }
      if (toDate) {
        conditions.push(`s.session_at::date <= $${index}`);
        values.push(toDate);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";
      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          count(*)::int as total_sessions,
          sum(case when a.present then 1 else 0 end)::int as present_sessions,
          sum(case when a.present = false then 1 else 0 end)::int as absent_sessions,
          round(
            (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(*), 0)) * 100,
            2
          ) as attendance_rate
        from academics.attendance a
        join academics.attendance_sessions s on s.id = a.attendance_session_id
        join core.candidates c on c.id = a.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        group by c.candidate_no, p.first_name, p.last_name, coh.cohort_no, pl.platoon_no
        order by attendance_rate asc nulls last, c.candidate_no
        limit 80
        `,
        values
      );

      const pdf = buildSimplePdf({
        title: "Official Attendance Report",
        subtitle: `Generated: ${new Date().toISOString()}`,
        headers: ["CandidateNo", "Name", "Cohort", "Platoon", "Present", "Absent", "Rate%"],
        rows: result.rows.map((row) => [
          row.candidate_no || "",
          `${row.first_name || ""} ${row.last_name || ""}`.trim(),
          row.cohort_no || "",
          row.platoon_no || "",
          row.present_sessions || 0,
          row.absent_sessions || 0,
          row.attendance_rate || 0,
        ]),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"attendance_report.pdf\""
      );
      return res.send(pdf);
    } catch (error) {
      console.error("Attendance PDF report error:", error);
      return res.status(500).json({ message: "تعذر تصدير PDF الحضور." });
    }
  }
);

app.get(
  "/api/admin/reports/grades.pdf",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const scope = parseScopeReportFilters(req.query);
      const termId = req.query.term_id ? String(req.query.term_id) : null;
      const courseId = req.query.course_id ? String(req.query.course_id) : null;

      const conditions = [];
      const values = [];
      let index = 1;

      if (scope.cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(scope.cohortId);
        index += 1;
      } else if (scope.cohortNo) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(scope.cohortNo);
        index += 1;
      }
      if (scope.platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(scope.platoonId);
        index += 1;
      } else if (scope.platoonNo) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(scope.platoonNo);
        index += 1;
      }
      if (termId) {
        conditions.push(`cs.term_id = $${index}`);
        values.push(termId);
        index += 1;
      }
      if (courseId) {
        conditions.push(`cs.course_id = $${index}`);
        values.push(courseId);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";
      const result = await pool.query(
        `
        select
          c.candidate_no,
          p.first_name,
          p.last_name,
          coh.cohort_no,
          pl.platoon_no,
          course.code as course_code,
          a.name as assessment_name,
          g.score,
          a.max_score
        from academics.grades g
        join academics.assessments a on a.id = g.assessment_id
        join academics.course_sections cs on cs.id = a.section_id
        join academics.courses course on course.id = cs.course_id
        join core.candidates c on c.id = g.candidate_id
        join core.people p on p.id = c.person_id
        left join core.cohorts coh on coh.id = c.cohort_id
        left join core.platoons pl on pl.id = c.platoon_id
        ${whereClause}
        order by coh.cohort_no desc nulls last, c.candidate_no, course.code
        limit 80
        `,
        values
      );

      const pdf = buildSimplePdf({
        title: "Official Grades Report",
        subtitle: `Generated: ${new Date().toISOString()}`,
        headers: ["CandidateNo", "Name", "Cohort", "Course", "Assessment", "Score", "Max"],
        rows: result.rows.map((row) => [
          row.candidate_no || "",
          `${row.first_name || ""} ${row.last_name || ""}`.trim(),
          row.cohort_no || "",
          row.course_code || "",
          row.assessment_name || "",
          row.score || 0,
          row.max_score || 0,
        ]),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=\"grades_report.pdf\""
      );
      return res.send(pdf);
    } catch (error) {
      console.error("Grades PDF report error:", error);
      return res.status(500).json({ message: "تعذر تصدير PDF الدرجات." });
    }
  }
);

app.get(
  "/api/admin/security/overview",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureRankRolePoliciesTable();
      const [rolesResult, permissionsResult, rolePermissionResult, usersResult, ranksResult, policiesResult] =
        await Promise.all([
          pool.query(
            `
            select id, name, description
            from auth.roles
            order by name
            `
          ),
          pool.query(
            `
            select id, code, description
            from auth.permissions
            order by code
            `
          ),
          pool.query(
            `
            select rp.role_id, p.id as permission_id, p.code
            from auth.role_permissions rp
            join auth.permissions p on p.id = rp.permission_id
            order by rp.role_id, p.code
            `
          ),
          pool.query(
            `
            select
              u.id as user_id,
              u.username,
              u.email,
              p.first_name,
              p.last_name,
              rnk.id as rank_id,
              rnk.name as rank_name,
              coalesce(
                array_agg(distinct ur.role_id) filter (where ur.role_id is not null),
                '{}'::uuid[]
              ) as role_ids,
              coalesce(
                array_agg(distinct rl.name) filter (where rl.name is not null),
                '{}'::text[]
              ) as role_names
            from auth.users u
            left join core.staff s on s.user_id = u.id
            left join core.people p on p.id = s.person_id
            left join core.ranks rnk on rnk.id = s.rank_id
            left join auth.user_roles ur on ur.user_id = u.id
            left join auth.roles rl on rl.id = ur.role_id
            group by u.id, p.id, rnk.id
            order by u.username
            `
          ),
          pool.query(
            `
            select id, name, order_index, category
            from core.ranks
            order by order_index
            `
          ),
          pool.query(
            `
            select rank_id, role_id
            from core.rank_role_policies
            order by rank_id
            `
          ),
        ]);

      return res.json({
        roles: rolesResult.rows,
        permissions: permissionsResult.rows,
        rolePermissions: rolePermissionResult.rows,
        users: usersResult.rows,
        ranks: ranksResult.rows,
        rankPolicies: policiesResult.rows,
      });
    } catch (error) {
      console.error("Security overview error:", error);
      return res.status(500).json({ message: "تعذر تحميل إعدادات الصلاحيات." });
    }
  }
);

app.put(
  "/api/admin/security/role-permissions/:roleId",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const roleId = req.params.roleId;
      const permissionIds = Array.isArray(req.body?.permissionIds)
        ? req.body.permissionIds.map((value) => String(value))
        : [];

      await client.query("begin");
      await client.query(`delete from auth.role_permissions where role_id = $1`, [roleId]);

      for (const permissionId of permissionIds) {
        await client.query(
          `
          insert into auth.role_permissions (role_id, permission_id)
          values ($1, $2)
          on conflict do nothing
          `,
          [roleId, permissionId]
        );
      }

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Role permissions update error:", error);
      return res.status(500).json({ message: "تعذر تحديث صلاحيات الدور." });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/admin/security/user-roles/:userId",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const userId = req.params.userId;
      const roleIds = Array.isArray(req.body?.roleIds)
        ? req.body.roleIds.map((value) => String(value))
        : [];

      await client.query("begin");
      await client.query(`delete from auth.user_roles where user_id = $1`, [userId]);

      for (const roleId of roleIds) {
        await client.query(
          `
          insert into auth.user_roles (user_id, role_id)
          values ($1, $2)
          on conflict do nothing
          `,
          [userId, roleId]
        );
      }

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("User roles update error:", error);
      return res.status(500).json({ message: "تعذر تحديث أدوار المستخدم." });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/admin/security/rank-policies/:rankId",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureRankRolePoliciesTable();
      const rankId = req.params.rankId;
      const roleIds = Array.isArray(req.body?.roleIds)
        ? req.body.roleIds.map((value) => String(value))
        : [];

      await client.query("begin");
      await client.query(`delete from core.rank_role_policies where rank_id = $1`, [rankId]);

      for (const roleId of roleIds) {
        await client.query(
          `
          insert into core.rank_role_policies (rank_id, role_id)
          values ($1, $2)
          on conflict do nothing
          `,
          [rankId, roleId]
        );
      }

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Rank policies update error:", error);
      return res.status(500).json({ message: "تعذر تحديث سياسات الرتب." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/admin/security/apply-rank-policies",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureRankRolePoliciesTable();
      const result = await pool.query(
        `
        insert into auth.user_roles (user_id, role_id)
        select s.user_id, rrp.role_id
        from core.staff s
        join core.rank_role_policies rrp on rrp.rank_id = s.rank_id
        on conflict do nothing
        `
      );
      return res.json({ assigned: result.rowCount || 0 });
    } catch (error) {
      console.error("Apply rank policies error:", error);
      return res.status(500).json({ message: "تعذر تطبيق سياسات الرتب على المستخدمين." });
    }
  }
);

app.get(
  "/api/admin/workflow/filters",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureWorkflowSchema();
      const [typesResult, assigneesResult] = await Promise.all([
        pool.query(
          `
          select distinct request_type
          from core.requests
          where request_type is not null and request_type <> ''
          order by request_type
          `
        ),
        pool.query(
          `
          select
            u.id,
            u.username,
            p.first_name,
            p.last_name
          from auth.users u
          left join core.staff s on s.user_id = u.id
          left join core.people p on p.id = s.person_id
          where u.status = 'active'
          order by u.username
          `
        ),
      ]);

      return res.json({
        statuses: ["submitted", "in_review", "approved", "rejected", "cancelled"],
        priorities: ["low", "normal", "high", "critical"],
        requestTypes: typesResult.rows.map((row) => row.request_type),
        assignees: assigneesResult.rows,
      });
    } catch (error) {
      console.error("Workflow filters error:", error);
      return res.status(500).json({ message: "تعذر تحميل فلاتر سير الإجراءات." });
    }
  }
);

app.get(
  "/api/admin/workflow/requests",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureWorkflowSchema();
      const search = normalizeString(req.query.search)?.toLowerCase() || null;
      const status = normalizeString(req.query.status);
      const requestType = normalizeString(req.query.request_type);
      const priority = normalizeString(req.query.priority);
      const assignedTo = normalizeString(req.query.assigned_to);
      const cohortId = normalizeString(req.query.cohort_id);
      const cohortNo = parseInteger(req.query.cohort_no);
      const platoonId = normalizeString(req.query.platoon_id);
      const platoonNo = parseInteger(req.query.platoon_no);
      const limit = Math.min(Number(req.query.limit) || 100, 300);
      const offset = Number(req.query.offset) || 0;

      const conditions = [];
      const values = [];
      let index = 1;

      if (search) {
        conditions.push(
          `(lower(r.title) like $${index}
            or lower(coalesce(r.body, '')) like $${index}
            or lower(coalesce(c.candidate_no, '')) like $${index}
            or lower(coalesce(c.military_no, '')) like $${index}
            or lower(coalesce(p.first_name, '')) like $${index}
            or lower(coalesce(p.last_name, '')) like $${index})`
        );
        values.push(`%${search}%`);
        index += 1;
      }

      if (status) {
        conditions.push(`r.status = $${index}`);
        values.push(status);
        index += 1;
      }

      if (requestType) {
        conditions.push(`r.request_type = $${index}`);
        values.push(requestType);
        index += 1;
      }

      if (priority) {
        conditions.push(`r.priority = $${index}`);
        values.push(priority);
        index += 1;
      }

      if (assignedTo) {
        conditions.push(`r.assigned_to = $${index}`);
        values.push(assignedTo);
        index += 1;
      }

      if (cohortId) {
        conditions.push(`coh.id = $${index}`);
        values.push(cohortId);
        index += 1;
      } else if (cohortNo !== null) {
        conditions.push(`coh.cohort_no = $${index}`);
        values.push(cohortNo);
        index += 1;
      }

      if (platoonId) {
        conditions.push(`pl.id = $${index}`);
        values.push(platoonId);
        index += 1;
      } else if (platoonNo !== null) {
        conditions.push(`pl.platoon_no = $${index}`);
        values.push(platoonNo);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const [rowsResult, totalResult] = await Promise.all([
        pool.query(
          `
          select
            r.id,
            r.request_type,
            r.title,
            r.body,
            r.status,
            r.priority,
            r.approval_count,
            r.required_approvals,
            r.submitted_at,
            r.updated_at,
            r.due_at,
            r.last_decision_at,
            r.candidate_id,
            c.candidate_no,
            c.military_no,
            p.first_name,
            p.last_name,
            coh.id as cohort_id,
            coh.cohort_no,
            pl.id as platoon_id,
            pl.platoon_no,
            r.assigned_to,
            assignee.username as assigned_username,
            decider.username as last_decision_by_username
          from core.requests r
          left join core.candidates c on c.id = r.candidate_id
          left join core.people p on p.id = c.person_id
          left join core.cohorts coh on coh.id = c.cohort_id
          left join core.platoons pl on pl.id = c.platoon_id
          left join auth.users assignee on assignee.id = r.assigned_to
          left join auth.users decider on decider.id = r.last_decision_by
          ${whereClause}
          order by
            case r.priority
              when 'critical' then 1
              when 'high' then 2
              when 'normal' then 3
              else 4
            end,
            coalesce(r.due_at, r.submitted_at) asc
          limit $${index} offset $${index + 1}
          `,
          [...values, limit, offset]
        ),
        pool.query(
          `
          select count(*)::int as total
          from core.requests r
          left join core.candidates c on c.id = r.candidate_id
          left join core.people p on p.id = c.person_id
          left join core.cohorts coh on coh.id = c.cohort_id
          left join core.platoons pl on pl.id = c.platoon_id
          ${whereClause}
          `,
          values
        ),
      ]);

      return res.json({
        rows: rowsResult.rows,
        total: totalResult.rows[0]?.total || 0,
      });
    } catch (error) {
      console.error("Workflow requests list error:", error);
      return res.status(500).json({ message: "تعذر تحميل طلبات سير الإجراءات." });
    }
  }
);

app.get(
  "/api/admin/workflow/requests/:id/actions",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      await ensureWorkflowSchema();
      const requestId = req.params.id;
      const result = await pool.query(
        `
        select
          ra.id,
          ra.action,
          ra.note,
          ra.acted_at,
          ra.approval_level,
          ra.metadata,
          u.username as acted_by_username
        from core.request_actions ra
        left join auth.users u on u.id = ra.acted_by
        where ra.request_id = $1
        order by ra.acted_at desc
        `,
        [requestId]
      );
      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Workflow actions list error:", error);
      return res.status(500).json({ message: "تعذر تحميل سجل القرارات." });
    }
  }
);

app.put(
  "/api/admin/workflow/requests/:id/assign",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureWorkflowSchema();
      const requestId = req.params.id;
      const assignedTo = normalizeString(req.body?.assignedTo);
      const parsedPriority = normalizePriority(req.body?.priority);
      const dueAt = parseDateTime(req.body?.dueAt);
      const note = normalizeString(req.body?.note);

      if (req.body?.priority !== undefined && parsedPriority === null) {
        return res.status(400).json({ message: "Invalid priority value." });
      }

      await client.query("begin");
      const updateResult = await client.query(
        `
        update core.requests
        set
          assigned_to = $1,
          priority = $2,
          due_at = $3,
          status = case when status = 'submitted' then 'in_review' else status end,
          updated_at = now()
        where id = $4
        returning id
        `,
        [assignedTo, parsedPriority || "normal", dueAt, requestId]
      );

      if (updateResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ message: "Request not found." });
      }

      await client.query(
        `
        insert into core.request_actions (
          request_id,
          action,
          note,
          acted_by,
          metadata
        )
        values ($1, 'workflow_assignment', $2, $3, $4::jsonb)
        `,
        [
          requestId,
          note,
          req.user.userId,
          JSON.stringify({
            assignedTo,
            priority: parsedPriority || "normal",
            dueAt,
          }),
        ]
      );

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Workflow assign error:", error);
      return res.status(500).json({ message: "Failed to update assignment." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/admin/workflow/requests/:id/comment",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureWorkflowSchema();
      const requestId = req.params.id;
      const note = normalizeString(req.body?.note);
      if (!note) {
        return res.status(400).json({ message: "يرجى إدخال تعليق." });
      }

      const existsResult = await client.query(
        `select id from core.requests where id = $1`,
        [requestId]
      );
      if (existsResult.rowCount === 0) {
        return res.status(404).json({ message: "الطلب غير موجود." });
      }

      await client.query("begin");
      await client.query(
        `update core.requests set updated_at = now() where id = $1`,
        [requestId]
      );
      await client.query(
        `
        insert into core.request_actions (request_id, action, note, acted_by)
        values ($1, 'workflow_comment', $2, $3)
        `,
        [requestId, note, req.user.userId]
      );
      await client.query("commit");
      return res.status(201).json({ created: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Workflow comment error:", error);
      return res.status(500).json({ message: "تعذر حفظ التعليق." });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/admin/workflow/requests/:id/decision",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureWorkflowSchema();
      const requestId = req.params.id;
      const note = normalizeString(req.body?.note);
      const requiredApprovalsInput = parseInteger(req.body?.requiredApprovals);

      await client.query("begin");

      if (requiredApprovalsInput !== null && requiredApprovalsInput >= 1) {
        await client.query(
          `
          update core.requests
          set required_approvals = greatest($2, approval_count),
              updated_at = now()
          where id = $1
          `,
          [requestId, requiredApprovalsInput]
        );
      }

      const result = await applyWorkflowDecision(client, {
        requestId,
        decision: req.body?.decision,
        note,
        actorUserId: req.user.userId,
      });

      await client.query("commit");
      return res.json({
        updated: true,
        status: result.status,
        approvalCount: result.approvalCount,
        requiredApprovals: result.requiredApprovals,
      });
    } catch (error) {
      await client.query("rollback");
      const status = Number(error.status) || 500;
      console.error("Workflow decision error:", error);
      return res.status(status).json({
        message: status === 500 ? "تعذر معالجة قرار سير الإجراءات." : error.message,
      });
    } finally {
      client.release();
    }
  }
);

app.get("/api/media/home", async (req, res) => {
  try {
    await ensureMediaCenterSchema();

    const [postsResult, categoriesResult, eventsResult, announcementsResult] = await Promise.all([
      pool.query(
        `
        select
          mp.id,
          mp.category_id,
          mc.slug as category_slug,
          mc.name_ar as category_name,
          mp.title,
          mp.slug,
          coalesce(mp.summary, left(mp.body, 240)) as summary,
          mp.body,
          mp.cover_image_url,
          mp.cover_file_id,
          mp.gallery,
          mp.tags,
          mp.post_type,
          mp.audience,
          mp.status,
          mp.is_pinned,
          mp.is_featured,
          mp.event_at,
          mp.location,
          mp.views_count,
          mp.publish_starts_at,
          mp.publish_ends_at,
          mp.published_at,
          mp.created_at,
          mp.updated_at,
          mp.created_by,
          mp.approved_by,
          cp.username as created_by_name,
          ap.username as approved_by_name,
          mp.decision_note
        from comms.media_posts mp
        left join comms.media_categories mc on mc.id = mp.category_id
        left join auth.users cp on cp.id = mp.created_by
        left join auth.users ap on ap.id = mp.approved_by
        where mp.status = 'published'
          and mp.audience = 'public'
          and (mp.publish_starts_at is null or mp.publish_starts_at <= now())
          and (mp.publish_ends_at is null or mp.publish_ends_at >= now())
        order by mp.is_pinned desc, mp.is_featured desc, coalesce(mp.published_at, mp.created_at) desc
        limit 10
        `
      ),
      pool.query(
        `
        select
          mc.id,
          mc.slug,
          mc.name_ar,
          mc.name_en,
          mc.description,
          mc.sort_order,
          count(mp.id)::int as post_count
        from comms.media_categories mc
        left join comms.media_posts mp
          on mp.category_id = mc.id
         and mp.status = 'published'
         and mp.audience = 'public'
         and (mp.publish_starts_at is null or mp.publish_starts_at <= now())
         and (mp.publish_ends_at is null or mp.publish_ends_at >= now())
        where mc.is_active = true
        group by mc.id
        order by mc.sort_order, mc.name_ar
        `
      ),
      pool.query(
        `
        select
          mp.id,
          mp.title,
          mp.slug,
          mp.summary,
          mp.cover_image_url,
          mp.cover_file_id,
          mp.event_at,
          mp.location,
          mc.name_ar as category_name
        from comms.media_posts mp
        left join comms.media_categories mc on mc.id = mp.category_id
        where mp.status = 'published'
          and mp.audience = 'public'
          and mp.post_type = 'event'
          and mp.event_at is not null
          and mp.event_at >= now()
          and (mp.publish_starts_at is null or mp.publish_starts_at <= now())
          and (mp.publish_ends_at is null or mp.publish_ends_at >= now())
        order by mp.event_at asc
        limit 6
        `
      ),
      pool.query(
        `
        select
          id,
          title,
          body,
          priority,
          published_at,
          expires_at
        from comms.announcements
        where status = 'published'
          and (published_at is null or published_at <= now())
          and (expires_at is null or expires_at >= now())
        order by priority desc, published_at desc nulls last
        limit 4
        `
      ),
    ]);

    const posts = postsResult.rows.map(mapMediaPostRow);
    const featured = posts[0] || null;

    return res.json({
      featured,
      latest: posts.slice(1),
      categories: categoriesResult.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        description: row.description,
        sortOrder: row.sort_order,
        postCount: Number(row.post_count || 0),
      })),
      events: eventsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        summary: row.summary,
        coverImageUrl: normalizeString(row.cover_image_url) || buildMediaFilePublicUrl(row.cover_file_id),
        eventAt: row.event_at,
        location: row.location,
        categoryName: row.category_name,
      })),
      announcements: announcementsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        priority: Number(row.priority || 0),
        publishedAt: row.published_at,
        expiresAt: row.expires_at,
      })),
    });
  } catch (error) {
    console.error("Media home error:", error);
    return res.status(500).json({ message: "تعذر تحميل بيانات المركز الإعلامي." });
  }
});

app.get("/api/media/posts", async (req, res) => {
  try {
    await ensureMediaCenterSchema();

    const search = normalizeString(req.query.search)?.toLowerCase() || null;
    const categoryId = normalizeString(req.query.category_id);
    const categorySlug = normalizeString(req.query.category_slug);
    const postType = normalizeMediaType(req.query.post_type);
    const from = parseDateTime(req.query.from);
    const to = parseDateTime(req.query.to);
    const limit = Math.min(Math.max(parseInteger(req.query.limit) || 12, 1), 100);
    const page = Math.max(parseInteger(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    if (req.query.post_type !== undefined && postType === null) {
      return res.status(400).json({ message: "نوع المحتوى غير صالح." });
    }
    if (req.query.from && !from) {
      return res.status(400).json({ message: "تاريخ البداية غير صالح." });
    }
    if (req.query.to && !to) {
      return res.status(400).json({ message: "تاريخ النهاية غير صالح." });
    }

    const conditions = [
      `mp.status = 'published'`,
      `mp.audience = 'public'`,
      `(mp.publish_starts_at is null or mp.publish_starts_at <= now())`,
      `(mp.publish_ends_at is null or mp.publish_ends_at >= now())`,
    ];
    const values = [];
    let index = 1;

    if (search) {
      conditions.push(
        `(lower(mp.title) like $${index}
          or lower(coalesce(mp.summary, '')) like $${index}
          or lower(coalesce(mp.body, '')) like $${index})`
      );
      values.push(`%${search}%`);
      index += 1;
    }

    if (categoryId) {
      conditions.push(`mp.category_id = $${index}`);
      values.push(categoryId);
      index += 1;
    }

    if (categorySlug) {
      conditions.push(`mc.slug = $${index}`);
      values.push(categorySlug);
      index += 1;
    }

    if (postType) {
      conditions.push(`mp.post_type = $${index}`);
      values.push(postType);
      index += 1;
    }

    if (from) {
      conditions.push(`coalesce(mp.published_at, mp.created_at) >= $${index}`);
      values.push(from);
      index += 1;
    }

    if (to) {
      conditions.push(`coalesce(mp.published_at, mp.created_at) <= $${index}`);
      values.push(to);
      index += 1;
    }

    const whereClause = `where ${conditions.join(" and ")}`;
    const result = await pool.query(
      `
      select
        mp.id,
        mp.category_id,
        mc.slug as category_slug,
        mc.name_ar as category_name,
        mp.title,
        mp.slug,
        coalesce(mp.summary, left(mp.body, 240)) as summary,
        mp.body,
        mp.cover_image_url,
        mp.cover_file_id,
        mp.gallery,
        mp.tags,
        mp.post_type,
        mp.audience,
        mp.status,
        mp.is_pinned,
        mp.is_featured,
        mp.event_at,
        mp.location,
        mp.views_count,
        mp.publish_starts_at,
        mp.publish_ends_at,
        mp.published_at,
        mp.created_at,
        mp.updated_at,
        mp.created_by,
        mp.approved_by,
        cp.username as created_by_name,
        ap.username as approved_by_name,
        mp.decision_note,
        count(*) over()::int as total_count
      from comms.media_posts mp
      left join comms.media_categories mc on mc.id = mp.category_id
      left join auth.users cp on cp.id = mp.created_by
      left join auth.users ap on ap.id = mp.approved_by
      ${whereClause}
      order by mp.is_pinned desc, coalesce(mp.published_at, mp.created_at) desc
      limit $${index} offset $${index + 1}
      `,
      [...values, limit, offset]
    );

    return res.json({
      rows: result.rows.map(mapMediaPostRow),
      total: Number(result.rows[0]?.total_count || 0),
      page,
      limit,
    });
  } catch (error) {
    console.error("Media posts error:", error);
    return res.status(500).json({ message: "تعذر تحميل الأخبار." });
  }
});

app.get("/api/media/files/:id", async (req, res) => {
  try {
    await ensureMediaCenterSchema();
    const fileId = normalizeString(req.params.id);
    if (!fileId || !isValidUuid(fileId)) {
      return res.status(400).json({ message: "Invalid media file id." });
    }

    const result = await pool.query(
      `
      select
        fo.id,
        fo.storage_key,
        fo.original_name,
        fo.mime_type,
        fo.visibility,
        max(
          case
            when mp.status = 'published'
             and mp.audience = 'public'
             and (mp.publish_starts_at is null or mp.publish_starts_at <= now())
             and (mp.publish_ends_at is null or mp.publish_ends_at >= now())
            then 1 else 0
          end
        ) as linked_public_post
      from files.file_objects fo
      left join files.file_links fl
        on fl.file_id = fo.id
       and fl.entity_type = 'media_post'
      left join comms.media_posts mp
        on mp.id = fl.entity_id
      where fo.id = $1
      group by fo.id
      `,
      [fileId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Media file not found." });
    }

    const row = result.rows[0];
    const isPublic = row.visibility === "public";
    const isLinkedToPublicPost = Number(row.linked_public_post || 0) > 0;
    if (!isPublic && !isLinkedToPublicPost) {
      return res.status(404).json({ message: "Media file not available." });
    }

    if (!String(row.storage_key).startsWith("uploads/")) {
      return res.status(404).json({ message: "Media file content not found." });
    }

    const relativePath = String(row.storage_key).replace(/^uploads\//, "");
    const absolutePath = path.resolve(uploadsDir, relativePath);
    const fileBuffer = await fs.readFile(absolutePath);

    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${sanitizeFilename(row.original_name || "media-file")}"`
    );
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(fileBuffer);
  } catch (error) {
    console.error("Public media file error:", error);
    return res.status(500).json({ message: "Failed to load media file." });
  }
});

app.get("/api/media/posts/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureMediaCenterSchema();

    const identifier = normalizeString(req.params.id);
    if (!identifier) {
      return res.status(400).json({ message: "معرّف الخبر مطلوب." });
    }

    await client.query("begin");
    const touchResult = await client.query(
      `
      update comms.media_posts
      set views_count = views_count + 1
      where (id::text = $1 or slug = $1)
        and status = 'published'
        and audience = 'public'
        and (publish_starts_at is null or publish_starts_at <= now())
        and (publish_ends_at is null or publish_ends_at >= now())
      returning id, category_id
      `,
      [identifier]
    );

    if (touchResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ message: "الخبر غير موجود." });
    }

    const postId = touchResult.rows[0].id;
    const categoryId = touchResult.rows[0].category_id;

    const postResult = await client.query(
      `
      select
        mp.id,
        mp.category_id,
        mc.slug as category_slug,
        mc.name_ar as category_name,
        mp.title,
        mp.slug,
        coalesce(mp.summary, left(mp.body, 240)) as summary,
        mp.body,
        mp.cover_image_url,
        mp.cover_file_id,
        mp.gallery,
        mp.tags,
        mp.post_type,
        mp.audience,
        mp.status,
        mp.is_pinned,
        mp.is_featured,
        mp.event_at,
        mp.location,
        mp.views_count,
        mp.publish_starts_at,
        mp.publish_ends_at,
        mp.published_at,
        mp.created_at,
        mp.updated_at,
        mp.created_by,
        mp.approved_by,
        cp.username as created_by_name,
        ap.username as approved_by_name,
        mp.decision_note
      from comms.media_posts mp
      left join comms.media_categories mc on mc.id = mp.category_id
      left join auth.users cp on cp.id = mp.created_by
      left join auth.users ap on ap.id = mp.approved_by
      where mp.id = $1
      `,
      [postId]
    );

    const relatedResult = await client.query(
      `
      select
        mp.id,
        mp.title,
        mp.slug,
        coalesce(mp.summary, left(mp.body, 200)) as summary,
        mp.cover_image_url,
        mp.cover_file_id,
        mp.published_at,
        mc.name_ar as category_name
      from comms.media_posts mp
      left join comms.media_categories mc on mc.id = mp.category_id
      where mp.id <> $1
        and ($2::uuid is null or mp.category_id = $2::uuid)
        and mp.status = 'published'
        and mp.audience = 'public'
        and (mp.publish_starts_at is null or mp.publish_starts_at <= now())
        and (mp.publish_ends_at is null or mp.publish_ends_at >= now())
      order by coalesce(mp.published_at, mp.created_at) desc
      limit 4
      `,
      [postId, categoryId]
    );

    await client.query("commit");

    return res.json({
      post: mapMediaPostRow(postResult.rows[0]),
      related: relatedResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        summary: row.summary,
        coverImageUrl: normalizeString(row.cover_image_url) || buildMediaFilePublicUrl(row.cover_file_id),
        publishedAt: row.published_at,
        categoryName: row.category_name,
      })),
    });
  } catch (error) {
    await client.query("rollback");
    console.error("Media post detail error:", error);
    return res.status(500).json({ message: "تعذر تحميل الخبر." });
  } finally {
    client.release();
  }
});

app.get(
  "/api/admin/media/categories",
  requireAuth,
  requireRole(MEDIA_ROLES),
  async (req, res) => {
    try {
      await ensureMediaCenterSchema();
      const result = await pool.query(
        `
        select id, slug, name_ar, name_en, description, sort_order, is_active, created_at, updated_at
        from comms.media_categories
        order by sort_order, name_ar
        `
      );
      return res.json({
        rows: result.rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          description: row.description,
          sortOrder: row.sort_order,
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    } catch (error) {
      console.error("Media categories error:", error);
      return res.status(500).json({ message: "تعذر تحميل تصنيفات المركز الإعلامي." });
    }
  }
);

app.post(
  "/api/admin/media/categories",
  requireAuth,
  requireRole(MEDIA_PUBLISHER_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureMediaCenterSchema();
      const nameAr = normalizeString(req.body?.nameAr);
      const nameEn = normalizeString(req.body?.nameEn);
      const description = normalizeString(req.body?.description);
      const sortOrder = parseInteger(req.body?.sortOrder) ?? 0;
      const parsedIsActive = parseBoolean(req.body?.isActive);
      const isActive = parsedIsActive === null ? true : parsedIsActive;
      const slugInput = normalizeString(req.body?.slug);

      if (!nameAr) {
        return res.status(400).json({ message: "اسم التصنيف العربي مطلوب." });
      }

      await client.query("begin");
      const slug = slugify(slugInput || nameAr, "media-category");
      const insertResult = await client.query(
        `
        insert into comms.media_categories (
          slug, name_ar, name_en, description, sort_order, is_active, created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id, slug, name_ar, name_en, description, sort_order, is_active, created_at, updated_at
        `,
        [slug, nameAr, nameEn, description, sortOrder, isActive, req.user.userId]
      );
      await client.query("commit");

      const row = insertResult.rows[0];
      return res.status(201).json({
        category: {
          id: row.id,
          slug: row.slug,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          description: row.description,
          sortOrder: row.sort_order,
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (error) {
      await client.query("rollback");
      if (error.code === "23505") {
        return res.status(409).json({ message: "slug التصنيف موجود مسبقًا." });
      }
      console.error("Create media category error:", error);
      return res.status(500).json({ message: "تعذر إنشاء التصنيف." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/admin/media/files",
  requireAuth,
  requireRole(MEDIA_FILE_ACCESS_ROLES),
  async (req, res) => {
    try {
      await ensureMediaCenterSchema();
      const search = normalizeString(req.query.search)?.toLowerCase() || null;
      const limit = Math.min(Math.max(parseInteger(req.query.limit) || 100, 1), 300);
      const offset = Math.max(parseInteger(req.query.offset) || 0, 0);

      const conditions = [
        `(coalesce(lower(fo.mime_type), '') like 'image/%' or lower(coalesce(fo.original_name, '')) ~ '\\.(png|jpe?g|gif|webp|bmp|svg|avif)$')`,
      ];
      const values = [];
      let index = 1;

      if (search) {
        conditions.push(
          `(lower(coalesce(fo.original_name, '')) like $${index}
            or lower(coalesce(fo.storage_key, '')) like $${index})`
        );
        values.push(`%${search}%`);
        index += 1;
      }

      const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(
        `
        select
          fo.id,
          fo.original_name,
          fo.mime_type,
          fo.size_bytes,
          fo.visibility,
          fo.uploaded_at,
          u.username as uploaded_by,
          count(fl.id) filter (where fl.entity_type = 'media_post')::int as media_links_count
        from files.file_objects fo
        left join auth.users u on u.id = fo.uploaded_by
        left join files.file_links fl on fl.file_id = fo.id
        ${whereClause}
        group by fo.id, u.username
        order by fo.uploaded_at desc
        limit $${index} offset $${index + 1}
        `,
        [...values, limit, offset]
      );

      return res.json({
        rows: result.rows.map((row) => ({
          id: row.id,
          originalName: row.original_name,
          mimeType: row.mime_type,
          sizeBytes: Number(row.size_bytes || 0),
          visibility: row.visibility,
          uploadedAt: row.uploaded_at,
          uploadedBy: row.uploaded_by,
          mediaLinksCount: Number(row.media_links_count || 0),
          publicUrl: buildMediaFilePublicUrl(row.id),
          downloadUrl: `/api/upload/files/${row.id}/download`,
        })),
      });
    } catch (error) {
      console.error("Admin media files error:", error);
      return res.status(500).json({ message: "Failed to load media files." });
    }
  }
);

app.get(
  "/api/admin/media/posts",
  requireAuth,
  requireRole(MEDIA_ROLES),
  async (req, res) => {
    try {
      await ensureMediaCenterSchema();

      const search = normalizeString(req.query.search)?.toLowerCase() || null;
      const status = normalizeMediaStatus(req.query.status);
      const categoryId = normalizeString(req.query.category_id);
      const postType = normalizeMediaType(req.query.post_type);
      const audience = normalizeMediaAudience(req.query.audience);
      const limit = Math.min(Math.max(parseInteger(req.query.limit) || 20, 1), 200);
      const offset = Math.max(parseInteger(req.query.offset) || 0, 0);

      if (req.query.status !== undefined && status === null) {
        return res.status(400).json({ message: "حالة النشر غير صالحة." });
      }
      if (req.query.post_type !== undefined && postType === null) {
        return res.status(400).json({ message: "نوع المحتوى غير صالح." });
      }
      if (req.query.audience !== undefined && audience === null) {
        return res.status(400).json({ message: "نوع الجمهور غير صالح." });
      }

      const values = [];
      const conditions = [];
      let index = 1;
      const userRoles = req.user?.roles || [];
      const isWriterOnly =
        hasAnyRole(userRoles, ["media_writer"]) &&
        !hasAnyRole(userRoles, ["admin", "media_reviewer", "media_publisher"]);

      if (search) {
        conditions.push(
          `(lower(mp.title) like $${index}
            or lower(coalesce(mp.summary, '')) like $${index}
            or lower(coalesce(mp.body, '')) like $${index})`
        );
        values.push(`%${search}%`);
        index += 1;
      }
      if (status) {
        conditions.push(`mp.status = $${index}`);
        values.push(status);
        index += 1;
      }
      if (categoryId) {
        conditions.push(`mp.category_id = $${index}`);
        values.push(categoryId);
        index += 1;
      }
      if (postType) {
        conditions.push(`mp.post_type = $${index}`);
        values.push(postType);
        index += 1;
      }
      if (audience) {
        conditions.push(`mp.audience = $${index}`);
        values.push(audience);
        index += 1;
      }
      if (isWriterOnly) {
        conditions.push(`mp.created_by = $${index}`);
        values.push(req.user.userId);
        index += 1;
      }

      const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(
        `
        select
          mp.id,
          mp.category_id,
          mc.slug as category_slug,
          mc.name_ar as category_name,
          mp.title,
          mp.slug,
          coalesce(mp.summary, left(mp.body, 240)) as summary,
          mp.body,
          mp.cover_image_url,
          mp.cover_file_id,
          mp.gallery,
          mp.tags,
          mp.post_type,
          mp.audience,
          mp.status,
          mp.is_pinned,
          mp.is_featured,
          mp.event_at,
          mp.location,
          mp.views_count,
          mp.publish_starts_at,
          mp.publish_ends_at,
          mp.published_at,
          mp.created_at,
          mp.updated_at,
          mp.created_by,
          mp.approved_by,
          cp.username as created_by_name,
          ap.username as approved_by_name,
          mp.decision_note,
          count(*) over()::int as total_count
        from comms.media_posts mp
        left join comms.media_categories mc on mc.id = mp.category_id
        left join auth.users cp on cp.id = mp.created_by
        left join auth.users ap on ap.id = mp.approved_by
        ${whereClause}
        order by mp.updated_at desc
        limit $${index} offset $${index + 1}
        `,
        [...values, limit, offset]
      );

      return res.json({
        rows: result.rows.map(mapMediaPostRow),
        total: Number(result.rows[0]?.total_count || 0),
      });
    } catch (error) {
      console.error("Admin media posts list error:", error);
      return res.status(500).json({ message: "تعذر تحميل منشورات المركز الإعلامي." });
    }
  }
);

app.get(
  "/api/admin/media/dashboard",
  requireAuth,
  requireRole(MEDIA_ROLES),
  async (req, res) => {
    try {
      await ensureMediaCenterSchema();
      const status = normalizeMediaStatus(req.query.status);
      const categoryId = normalizeString(req.query.category_id);

      if (req.query.status !== undefined && status === null) {
        return res.status(400).json({ message: "Invalid status filter." });
      }
      if (categoryId && !isValidUuid(categoryId)) {
        return res.status(400).json({ message: "Invalid category filter." });
      }

      const conditions = [];
      const values = [];
      let index = 1;

      if (status) {
        conditions.push(`mp.status = $${index}`);
        values.push(status);
        index += 1;
      }
      if (categoryId) {
        conditions.push(`mp.category_id = $${index}`);
        values.push(categoryId);
        index += 1;
      }

      const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
      const publishedConditions = [...conditions, `mp.published_at is not null`];
      const publishedWhereClause = `where ${publishedConditions.join(" and ")}`;

      const [summaryResult, topCategoryResult, weeklyResult, alertsResult] = await Promise.all([
        pool.query(
          `
          select
            count(*)::int as total_posts,
            count(*) filter (where mp.status = 'published')::int as published_posts,
            count(*) filter (where mp.status = 'in_review')::int as in_review_posts,
            count(*) filter (where mp.status = 'draft')::int as draft_posts,
            count(*) filter (where mp.created_at >= now() - interval '7 days')::int as created_last_7_days,
            count(*) filter (where mp.published_at >= now() - interval '7 days')::int as published_last_7_days
          from comms.media_posts mp
          ${whereClause}
          `,
          values
        ),
        pool.query(
          `
          select
            mc.id,
            mc.name_ar,
            count(mp.id)::int as post_count
          from comms.media_posts mp
          left join comms.media_categories mc on mc.id = mp.category_id
          ${whereClause}
          group by mc.id, mc.name_ar
          order by post_count desc, mc.name_ar asc nulls last
          limit 1
          `,
          values
        ),
        pool.query(
          `
          with week_series as (
            select
              generate_series(
                date_trunc('week', now()) - interval '7 weeks',
                date_trunc('week', now()),
                interval '1 week'
              ) as week_start
          ),
          created_weekly as (
            select
              date_trunc('week', mp.created_at) as week_start,
              count(*)::int as created_count
            from comms.media_posts mp
            ${whereClause}
            group by 1
          ),
          published_weekly as (
            select
              date_trunc('week', mp.published_at) as week_start,
              count(*)::int as published_count
            from comms.media_posts mp
            ${publishedWhereClause}
            group by 1
          )
          select
            ws.week_start,
            coalesce(cw.created_count, 0)::int as created_count,
            coalesce(pw.published_count, 0)::int as published_count
          from week_series ws
          left join created_weekly cw on cw.week_start = ws.week_start
          left join published_weekly pw on pw.week_start = ws.week_start
          order by ws.week_start asc
          `,
          values
        ),
        pool.query(
          `
          select
            count(*) filter (
              where mp.status = 'in_review'
                and mp.updated_at < now() - interval '72 hours'
            )::int as stale_reviews,
            count(*) filter (
              where mp.status = 'draft'
                and mp.created_at < now() - interval '14 days'
            )::int as stale_drafts
          from comms.media_posts mp
          ${whereClause}
          `,
          values
        ),
      ]);

      const summaryRow = summaryResult.rows[0] || {};
      const totalPosts = Number(summaryRow.total_posts || 0);
      const publishedPosts = Number(summaryRow.published_posts || 0);
      const publishRate = totalPosts > 0 ? Number(((publishedPosts / totalPosts) * 100).toFixed(2)) : 0;

      const alertsRow = alertsResult.rows[0] || {};
      const staleReviews = Number(alertsRow.stale_reviews || 0);
      const staleDrafts = Number(alertsRow.stale_drafts || 0);
      const alerts = [];
      if (staleReviews > 0) {
        alerts.push({
          code: "stale_reviews",
          level: staleReviews >= 5 ? "high" : "medium",
          message: `There are ${staleReviews} posts pending review for more than 72 hours.`,
        });
      }
      if (staleDrafts > 0) {
        alerts.push({
          code: "stale_drafts",
          level: staleDrafts >= 8 ? "medium" : "low",
          message: `There are ${staleDrafts} old draft posts older than 14 days.`,
        });
      }

      return res.json({
        summary: {
          totalPosts,
          publishedPosts,
          inReviewPosts: Number(summaryRow.in_review_posts || 0),
          draftPosts: Number(summaryRow.draft_posts || 0),
          createdLast7Days: Number(summaryRow.created_last_7_days || 0),
          publishedLast7Days: Number(summaryRow.published_last_7_days || 0),
          publishRate,
        },
        topCategory: topCategoryResult.rows[0]
          ? {
              id: topCategoryResult.rows[0].id,
              nameAr: topCategoryResult.rows[0].name_ar,
              postCount: Number(topCategoryResult.rows[0].post_count || 0),
            }
          : null,
        weekly: weeklyResult.rows.map((row) => ({
          weekStart: row.week_start,
          createdCount: Number(row.created_count || 0),
          publishedCount: Number(row.published_count || 0),
        })),
        alerts,
      });
    } catch (error) {
      console.error("Admin media dashboard error:", error);
      return res.status(500).json({ message: "Failed to load media dashboard." });
    }
  }
);

app.post(
  "/api/admin/media/posts",
  requireAuth,
  requireRole(MEDIA_EDITOR_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureMediaCenterSchema();

      const title = normalizeString(req.body?.title);
      const summary = normalizeString(req.body?.summary);
      const body = normalizeString(req.body?.body);
      const categoryId = normalizeString(req.body?.categoryId);
      const coverFileId = normalizeString(req.body?.coverFileId);
      const coverImageUrl = normalizeString(req.body?.coverImageUrl);
      const galleryFileIds = normalizeUuidArray(req.body?.galleryFileIds);
      const tags = normalizeStringArray(req.body?.tags);
      const gallery = normalizeGallery(req.body?.gallery);
      const postType = normalizeMediaType(req.body?.postType);
      const audience = normalizeMediaAudience(req.body?.audience);
      const status = normalizeMediaStatus(req.body?.status);
      const parsedPinned = parseBoolean(req.body?.isPinned);
      const parsedFeatured = parseBoolean(req.body?.isFeatured);
      const isPinned = parsedPinned === null ? false : parsedPinned;
      const isFeatured = parsedFeatured === null ? false : parsedFeatured;
      const eventAt = parseDateTime(req.body?.eventAt);
      const location = normalizeString(req.body?.location);
      const publishStartsAt = parseDateTime(req.body?.publishStartsAt);
      const publishEndsAt = parseDateTime(req.body?.publishEndsAt);
      const decisionNote = normalizeString(req.body?.decisionNote);
      const userRoles = req.user?.roles || [];
      const isAdmin = hasAnyRole(userRoles, ["admin"]);
      const isPublisher = hasAnyRole(userRoles, ["media_publisher"]);
      const isWriter = hasAnyRole(userRoles, ["media_writer"]);

      if (!title || !body) {
        return res.status(400).json({ message: "عنوان الخبر والمحتوى مطلوبان." });
      }
      if (req.body?.postType !== undefined && postType === null) {
        return res.status(400).json({ message: "نوع المحتوى غير صالح." });
      }
      if (req.body?.audience !== undefined && audience === null) {
        return res.status(400).json({ message: "نوع الجمهور غير صالح." });
      }
      if (req.body?.status !== undefined && status === null) {
        return res.status(400).json({ message: "حالة النشر غير صالحة." });
      }
      if (req.body?.eventAt && !eventAt) {
        return res.status(400).json({ message: "تاريخ الفعالية غير صالح." });
      }
      if (req.body?.publishStartsAt && !publishStartsAt) {
        return res.status(400).json({ message: "تاريخ بداية النشر غير صالح." });
      }
      if (req.body?.publishEndsAt && !publishEndsAt) {
        return res.status(400).json({ message: "تاريخ نهاية النشر غير صالح." });
      }

      if (coverFileId && !isValidUuid(coverFileId)) {
        return res.status(400).json({ message: "Invalid cover file id." });
      }
      if (
        !isAdmin &&
        !isPublisher &&
        isWriter &&
        ["approved", "published", "archived"].includes(status || "draft")
      ) {
        return res.status(403).json({ message: "Writer role cannot set this publish status on creation." });
      }

      await client.query("begin");
      await getMediaImageFilesByIds(client, [coverFileId, ...galleryFileIds].filter(Boolean));
      const normalizedGallery = [...gallery];
      const galleryFileIdSet = new Set(
        normalizedGallery
          .map((item) => normalizeString(item.fileId))
          .filter((item) => item !== null)
      );
      for (const fileId of galleryFileIds) {
        if (galleryFileIdSet.has(fileId)) continue;
        normalizedGallery.push({
          fileId,
          url: buildMediaFilePublicUrl(fileId),
        });
        galleryFileIdSet.add(fileId);
      }
      const resolvedCoverImageUrl = coverFileId
        ? buildMediaFilePublicUrl(coverFileId)
        : coverImageUrl;

      const slug = await ensureUniqueMediaSlug(client, req.body?.slug, title);
      const insertStatus = status || "draft";
      const publishAt = insertStatus === "published" ? new Date().toISOString() : null;
      const approvedBy = ["approved", "published"].includes(insertStatus)
        ? req.user.userId
        : null;

      const insertResult = await client.query(
        `
        insert into comms.media_posts (
          category_id,
          title,
          slug,
          summary,
          body,
          cover_image_url,
          cover_file_id,
          gallery,
          tags,
          post_type,
          audience,
          status,
          is_pinned,
          is_featured,
          event_at,
          location,
          publish_starts_at,
          publish_ends_at,
          published_at,
          created_by,
          approved_by,
          last_decision_at,
          last_decision_by,
          decision_note
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, now(), $20, $22
        )
        returning id
        `,
        [
          categoryId,
          title,
          slug,
          summary,
          body,
          resolvedCoverImageUrl,
          coverFileId,
          JSON.stringify(normalizedGallery),
          tags,
          postType || "news",
          audience || "public",
          insertStatus,
          isPinned,
          isFeatured,
          eventAt,
          location,
          publishStartsAt,
          publishEndsAt,
          publishAt,
          req.user.userId,
          approvedBy,
          decisionNote,
        ]
      );

      const postId = insertResult.rows[0].id;
      await syncMediaPostFileLinks(client, {
        postId,
        coverFileId,
        galleryFileIds: Array.from(galleryFileIdSet),
      });
      await logMediaAction(client, {
        postId,
        action: "create_post",
        fromStatus: null,
        toStatus: insertStatus,
        note: decisionNote,
        actedBy: req.user.userId,
        metadata: {
          isPinned,
          isFeatured,
          coverFileId,
          galleryFileIds: Array.from(galleryFileIdSet),
        },
      });

      await client.query("commit");
      return res.status(201).json({ id: postId });
    } catch (error) {
      await client.query("rollback");
      console.error("Create media post error:", error);
      return res.status(500).json({ message: "تعذر إنشاء الخبر." });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/admin/media/posts/:id",
  requireAuth,
  requireRole(MEDIA_EDITOR_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureMediaCenterSchema();

      const postId = normalizeString(req.params.id);
      if (!postId) {
        return res.status(400).json({ message: "معرّف الخبر مطلوب." });
      }

      const title = normalizeString(req.body?.title);
      const summary = normalizeString(req.body?.summary);
      const body = normalizeString(req.body?.body);
      const categoryId = normalizeString(req.body?.categoryId);
      const coverFileId = normalizeString(req.body?.coverFileId);
      const coverImageUrl = normalizeString(req.body?.coverImageUrl);
      const galleryFileIds = normalizeUuidArray(req.body?.galleryFileIds);
      const tags = normalizeStringArray(req.body?.tags);
      const gallery = normalizeGallery(req.body?.gallery);
      const postType = normalizeMediaType(req.body?.postType);
      const audience = normalizeMediaAudience(req.body?.audience);
      const parsedPinned = parseBoolean(req.body?.isPinned);
      const parsedFeatured = parseBoolean(req.body?.isFeatured);
      const isPinned = parsedPinned === null ? false : parsedPinned;
      const isFeatured = parsedFeatured === null ? false : parsedFeatured;
      const eventAt = parseDateTime(req.body?.eventAt);
      const location = normalizeString(req.body?.location);
      const publishStartsAt = parseDateTime(req.body?.publishStartsAt);
      const publishEndsAt = parseDateTime(req.body?.publishEndsAt);
      const decisionNote = normalizeString(req.body?.decisionNote);
      const userRoles = req.user?.roles || [];
      const isAdmin = hasAnyRole(userRoles, ["admin"]);
      const isPublisher = hasAnyRole(userRoles, ["media_publisher"]);
      const isWriter = hasAnyRole(userRoles, ["media_writer"]);

      if (!title || !body) {
        return res.status(400).json({ message: "عنوان الخبر والمحتوى مطلوبان." });
      }
      if (req.body?.postType !== undefined && postType === null) {
        return res.status(400).json({ message: "نوع المحتوى غير صالح." });
      }
      if (req.body?.audience !== undefined && audience === null) {
        return res.status(400).json({ message: "نوع الجمهور غير صالح." });
      }
      if (req.body?.eventAt && !eventAt) {
        return res.status(400).json({ message: "تاريخ الفعالية غير صالح." });
      }
      if (req.body?.publishStartsAt && !publishStartsAt) {
        return res.status(400).json({ message: "تاريخ بداية النشر غير صالح." });
      }
      if (req.body?.publishEndsAt && !publishEndsAt) {
        return res.status(400).json({ message: "تاريخ نهاية النشر غير صالح." });
      }

      if (coverFileId && !isValidUuid(coverFileId)) {
        return res.status(400).json({ message: "Invalid cover file id." });
      }

      await client.query("begin");

      const currentResult = await client.query(
        `select id, status, created_by from comms.media_posts where id = $1`,
        [postId]
      );
      if (currentResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ message: "الخبر غير موجود." });
      }

      const currentPost = currentResult.rows[0];
      const isOwner = currentPost.created_by === req.user.userId;

      if (!isAdmin && !isPublisher) {
        if (!isWriter || !isOwner) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only the post owner can edit this item." });
        }
        if (["published", "archived"].includes(currentPost.status)) {
          await client.query("rollback");
          return res.status(403).json({ message: "Published or archived posts cannot be edited by writer role." });
        }
      }

      await getMediaImageFilesByIds(client, [coverFileId, ...galleryFileIds].filter(Boolean));
      const normalizedGallery = [...gallery];
      const galleryFileIdSet = new Set(
        normalizedGallery
          .map((item) => normalizeString(item.fileId))
          .filter((item) => item !== null)
      );
      for (const fileId of galleryFileIds) {
        if (galleryFileIdSet.has(fileId)) continue;
        normalizedGallery.push({
          fileId,
          url: buildMediaFilePublicUrl(fileId),
        });
        galleryFileIdSet.add(fileId);
      }
      const resolvedCoverImageUrl = coverFileId
        ? buildMediaFilePublicUrl(coverFileId)
        : coverImageUrl;

      const slug = await ensureUniqueMediaSlug(client, req.body?.slug || title, title, postId);
      await client.query(
        `
        update comms.media_posts
        set
          category_id = $2,
          title = $3,
          slug = $4,
          summary = $5,
          body = $6,
          cover_image_url = $7,
          cover_file_id = $8,
          gallery = $9::jsonb,
          tags = $10::text[],
          post_type = $11,
          audience = $12,
          is_pinned = $13,
          is_featured = $14,
          event_at = $15,
          location = $16,
          publish_starts_at = $17,
          publish_ends_at = $18,
          decision_note = $19,
          updated_at = now()
        where id = $1
        `,
        [
          postId,
          categoryId,
          title,
          slug,
          summary,
          body,
          resolvedCoverImageUrl,
          coverFileId,
          JSON.stringify(normalizedGallery),
          tags,
          postType || "news",
          audience || "public",
          isPinned,
          isFeatured,
          eventAt,
          location,
          publishStartsAt,
          publishEndsAt,
          decisionNote,
        ]
      );

      await syncMediaPostFileLinks(client, {
        postId,
        coverFileId,
        galleryFileIds: Array.from(galleryFileIdSet),
      });

      await logMediaAction(client, {
        postId,
        action: "update_post",
        fromStatus: currentResult.rows[0].status,
        toStatus: currentResult.rows[0].status,
        note: decisionNote,
        actedBy: req.user.userId,
        metadata: {
          isPinned,
          isFeatured,
          coverFileId,
          galleryFileIds: Array.from(galleryFileIdSet),
        },
      });

      await client.query("commit");
      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Update media post error:", error);
      return res.status(500).json({ message: "تعذر تحديث الخبر." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/admin/media/posts/:id/actions",
  requireAuth,
  requireRole(MEDIA_ROLES),
  async (req, res) => {
    try {
      await ensureMediaCenterSchema();
      const postId = normalizeString(req.params.id);
      const postResult = await pool.query(
        `select id, created_by from comms.media_posts where id = $1`,
        [postId]
      );
      if (postResult.rowCount === 0) {
        return res.status(404).json({ message: "Media post not found." });
      }
      const userRoles = req.user?.roles || [];
      const isWriterOnly =
        hasAnyRole(userRoles, ["media_writer"]) &&
        !hasAnyRole(userRoles, ["admin", "media_reviewer", "media_publisher"]);
      if (isWriterOnly && postResult.rows[0].created_by !== req.user.userId) {
        return res.status(403).json({ message: "You are not allowed to read actions for this post." });
      }
      const result = await pool.query(
        `
        select
          a.id,
          a.action,
          a.from_status,
          a.to_status,
          a.note,
          a.acted_at,
          a.metadata,
          u.username as acted_by_username
        from comms.media_post_actions a
        left join auth.users u on u.id = a.acted_by
        where a.post_id = $1
        order by a.acted_at desc
        `,
        [postId]
      );
      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Media post actions error:", error);
      return res.status(500).json({ message: "تعذر تحميل سجل إجراءات الخبر." });
    }
  }
);

app.put(
  "/api/admin/media/posts/:id/status",
  requireAuth,
  requireRole(MEDIA_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureMediaCenterSchema();

      const postId = normalizeString(req.params.id);
      const action = normalizeString(req.body?.action)?.toLowerCase();
      const note = normalizeString(req.body?.note);

      if (!postId || !action) {
        return res.status(400).json({ message: "المعرف والإجراء مطلوبان." });
      }

      await client.query("begin");
      const currentResult = await client.query(
        `select id, status, is_pinned, is_featured, created_by from comms.media_posts where id = $1`,
        [postId]
      );
      if (currentResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ message: "الخبر غير موجود." });
      }

      const current = currentResult.rows[0];
      const fromStatus = current.status;
      let nextStatus = fromStatus;
      let updateFlags = {};
      const userRoles = req.user?.roles || [];
      const isAdmin = hasAnyRole(userRoles, ["admin"]);
      const isWriter = hasAnyRole(userRoles, ["media_writer"]);
      const isReviewer = hasAnyRole(userRoles, ["media_reviewer"]);
      const isPublisher = hasAnyRole(userRoles, ["media_publisher"]);
      const isOwner = current.created_by === req.user.userId;

      if (action === "submit") {
        if (!isAdmin && !isPublisher && !(isWriter && isOwner)) {
          await client.query("rollback");
          return res.status(403).json({ message: "You are not allowed to submit this post for review." });
        }
        if (!["draft", "rejected"].includes(fromStatus)) {
          await client.query("rollback");
          return res.status(400).json({ message: "لا يمكن إرسال الخبر للمراجعة من حالته الحالية." });
        }
        nextStatus = "in_review";
      } else if (action === "approve") {
        if (!isAdmin && !isReviewer) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only reviewer role can approve media posts." });
        }
        if (fromStatus !== "in_review") {
          await client.query("rollback");
          return res.status(400).json({ message: "الاعتماد متاح فقط للخبر قيد المراجعة." });
        }
        nextStatus = "approved";
      } else if (action === "reject") {
        if (!isAdmin && !isReviewer) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only reviewer role can reject media posts." });
        }
        if (!["in_review", "approved"].includes(fromStatus)) {
          await client.query("rollback");
          return res.status(400).json({ message: "الرفض غير متاح في الحالة الحالية." });
        }
        nextStatus = "rejected";
      } else if (action === "publish") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can publish media posts." });
        }
        if (!["approved", "archived"].includes(fromStatus)) {
          await client.query("rollback");
          return res.status(400).json({ message: "النشر يتطلب اعتمادًا مسبقًا." });
        }
        nextStatus = "published";
      } else if (action === "archive") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can archive media posts." });
        }
        if (fromStatus !== "published") {
          await client.query("rollback");
          return res.status(400).json({ message: "الأرشفة متاحة فقط للمحتوى المنشور." });
        }
        nextStatus = "archived";
      } else if (action === "return_to_draft") {
        if (!isAdmin && !isPublisher && !isReviewer && !(isWriter && isOwner)) {
          await client.query("rollback");
          return res.status(403).json({ message: "You are not allowed to move this post back to draft." });
        }
        if (fromStatus === "published") {
          await client.query("rollback");
          return res.status(400).json({ message: "لا يمكن إعادة المحتوى المنشور إلى مسودة مباشرة." });
        }
        nextStatus = "draft";
      } else if (action === "pin") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can pin media posts." });
        }
        updateFlags = { isPinned: true };
      } else if (action === "unpin") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can unpin media posts." });
        }
        updateFlags = { isPinned: false };
      } else if (action === "feature") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can feature media posts." });
        }
        updateFlags = { isFeatured: true };
      } else if (action === "unfeature") {
        if (!isAdmin && !isPublisher) {
          await client.query("rollback");
          return res.status(403).json({ message: "Only publisher role can unfeature media posts." });
        }
        updateFlags = { isFeatured: false };
      } else {
        await client.query("rollback");
        return res.status(400).json({ message: "الإجراء غير مدعوم." });
      }

      const setClauses = [
        `updated_at = now()`,
        `last_decision_at = now()`,
        `last_decision_by = $2`,
      ];
      const values = [postId, req.user.userId];
      let valueIndex = values.length + 1;

      if (nextStatus !== fromStatus) {
        setClauses.push(`status = $${valueIndex}`);
        values.push(nextStatus);
        valueIndex += 1;
      }

      if (Object.prototype.hasOwnProperty.call(updateFlags, "isPinned")) {
        setClauses.push(`is_pinned = $${valueIndex}`);
        values.push(updateFlags.isPinned);
        valueIndex += 1;
      }

      if (Object.prototype.hasOwnProperty.call(updateFlags, "isFeatured")) {
        setClauses.push(`is_featured = $${valueIndex}`);
        values.push(updateFlags.isFeatured);
        valueIndex += 1;
      }

      if (nextStatus === "approved" || nextStatus === "published") {
        setClauses.push(`approved_by = $${valueIndex}`);
        values.push(req.user.userId);
        valueIndex += 1;
      }

      if (nextStatus === "published") {
        setClauses.push(`published_at = coalesce(published_at, now())`);
      }

      if (note) {
        setClauses.push(`decision_note = $${valueIndex}`);
        values.push(note);
      }

      await client.query(
        `
        update comms.media_posts
        set ${setClauses.join(", ")}
        where id = $1
        `,
        values
      );

      await logMediaAction(client, {
        postId,
        action,
        fromStatus,
        toStatus: nextStatus,
        note,
        actedBy: req.user.userId,
        metadata: updateFlags,
      });

      await client.query("commit");
      return res.json({
        updated: true,
        status: nextStatus,
        isPinned: Object.prototype.hasOwnProperty.call(updateFlags, "isPinned")
          ? updateFlags.isPinned
          : current.is_pinned,
        isFeatured: Object.prototype.hasOwnProperty.call(updateFlags, "isFeatured")
          ? updateFlags.isFeatured
          : current.is_featured,
      });
    } catch (error) {
      await client.query("rollback");
      console.error("Update media status error:", error);
      return res.status(500).json({ message: "تعذر تحديث حالة النشر." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/upload/files",
  requireAuth,
  requireRole(MEDIA_FILE_ACCESS_ROLES),
  async (req, res) => {
    try {
      const search = normalizeString(req.query.search)?.toLowerCase() || null;
      const entityType = normalizeString(req.query.entity_type);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const values = [];
      const conditions = [];
      let index = 1;

      if (entityType) {
        conditions.push(`fl.entity_type = $${index}`);
        values.push(entityType);
        index += 1;
      }

      if (search) {
        conditions.push(
          `(lower(fo.original_name) like $${index} or lower(fo.storage_key) like $${index})`
        );
        values.push(`%${search}%`);
        index += 1;
      }

      const whereClause = conditions.length
        ? `where ${conditions.join(" and ")}`
        : "";

      const result = await pool.query(
        `
        select
          fo.id,
          fo.storage_key,
          fo.original_name,
          fo.mime_type,
          fo.size_bytes,
          fo.sha256,
          fo.visibility,
          fo.uploaded_at,
          u.username as uploaded_by,
          fl.entity_type,
          fl.entity_id,
          fl.note
        from files.file_objects fo
        left join auth.users u on u.id = fo.uploaded_by
        left join files.file_links fl on fl.file_id = fo.id
        ${whereClause}
        order by fo.uploaded_at desc
        limit $${index} offset $${index + 1}
        `,
        [...values, limit, offset]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Upload files list error:", error);
      return res.status(500).json({ message: "تعذر تحميل الملفات." });
    }
  }
);

app.post(
  "/api/upload/files",
  requireAuth,
  requireRole(["uploader", "admin", "media_writer", "media_publisher"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const {
        originalName,
        mimeType,
        visibility,
        entityType,
        entityId,
        note,
        contentBase64,
      } = req.body || {};

      if (!normalizeString(originalName)) {
        return res.status(400).json({ message: "يرجى اختيار ملف للرفع." });
      }

      const parsedVisibility = normalizeString(visibility) || "private";
      const safeName = sanitizeFilename(originalName);
      const fileBuffer = normalizeString(contentBase64)
        ? Buffer.from(String(contentBase64), "base64")
        : null;

      let storageKey = `manual/${Date.now()}-${safeName}`;
      let sha256 = null;
      let sizeBytes = 0;

      if (fileBuffer) {
        await ensureUploadsDir();
        const fileName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const absolutePath = path.resolve(uploadsDir, fileName);
        await fs.writeFile(absolutePath, fileBuffer);
        storageKey = `uploads/${fileName}`;
        sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        sizeBytes = fileBuffer.length;
      }

      await client.query("begin");

      const fileResult = await client.query(
        `
        insert into files.file_objects (
          storage_key,
          original_name,
          mime_type,
          size_bytes,
          sha256,
          visibility,
          uploaded_by
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id
        `,
        [
          storageKey,
          normalizeString(originalName),
          normalizeString(mimeType),
          sizeBytes,
          sha256,
          parsedVisibility,
          req.user.userId,
        ]
      );

      const fileId = fileResult.rows[0].id;

      if (normalizeString(entityType) && normalizeString(entityId)) {
        await client.query(
          `
          insert into files.file_links (file_id, entity_type, entity_id, note)
          values ($1, $2, $3, $4)
          `,
          [fileId, normalizeString(entityType), normalizeString(entityId), normalizeString(note)]
        );
      }

      await client.query("commit");
      return res.status(201).json({ fileId, storageKey });
    } catch (error) {
      await client.query("rollback");
      console.error("Upload create error:", error);
      return res.status(500).json({ message: "تعذر رفع الملف." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/upload/files/:id/download",
  requireAuth,
  requireRole(MEDIA_FILE_ACCESS_ROLES),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        select id, storage_key, original_name, mime_type
        from files.file_objects
        where id = $1
        `,
        [req.params.id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "الملف غير موجود." });
      }

      const fileRow = result.rows[0];
      if (!String(fileRow.storage_key).startsWith("uploads/")) {
        return res.status(400).json({ message: "هذا الملف مرجعي فقط ولا يملك محتوى محلي." });
      }

      const relativePath = String(fileRow.storage_key).replace(/^uploads\//, "");
      const absolutePath = path.resolve(uploadsDir, relativePath);
      const fileBuffer = await fs.readFile(absolutePath);

      res.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sanitizeFilename(fileRow.original_name || "file")}"`
      );
      return res.send(fileBuffer);
    } catch (error) {
      console.error("Upload download error:", error);
      return res.status(500).json({ message: "تعذر تنزيل الملف." });
    }
  }
);

async function getInstructorStaffId(userId) {
  const result = await pool.query(
    `
    select id
    from core.staff
    where user_id = $1
    `,
    [userId]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0].id;
}

async function applyWorkflowDecision(client, { requestId, decision, note, actorUserId }) {
  const normalizedDecision = normalizeWorkflowDecision(decision);
  if (!normalizedDecision) {
    const error = new Error("قرار غير صالح.");
    error.status = 400;
    throw error;
  }

  if (normalizedDecision === "reject" && !normalizeString(note)) {
    const error = new Error("يرجى إدخال سبب الرفض.");
    error.status = 400;
    throw error;
  }

  const requestResult = await client.query(
    `
    select
      id,
      status,
      approval_count,
      required_approvals
    from core.requests
    where id = $1
    for update
    `,
    [requestId]
  );

  if (requestResult.rowCount === 0) {
    const error = new Error("الطلب غير موجود.");
    error.status = 404;
    throw error;
  }

  const requestRow = requestResult.rows[0];
  const fromStatus = requestRow.status;
  const currentApprovals = Number(requestRow.approval_count || 0);
  const requiredApprovals = Number(requestRow.required_approvals || 2);

  if (
    ["approved", "rejected", "cancelled"].includes(fromStatus) &&
    normalizedDecision !== "escalate"
  ) {
    const error = new Error("لا يمكن تعديل طلب مغلق.");
    error.status = 409;
    throw error;
  }

  let nextStatus = fromStatus;
  let nextApprovals = currentApprovals;
  let nextRequiredApprovals = requiredApprovals;
  let actionName = "workflow_comment";

  if (normalizedDecision === "in_review") {
    nextStatus = "in_review";
    actionName = "workflow_in_review";
  }

  if (normalizedDecision === "approve") {
    nextApprovals = Math.min(requiredApprovals, currentApprovals + 1);
    nextStatus = nextApprovals >= requiredApprovals ? "approved" : "in_review";
    actionName =
      nextStatus === "approved"
        ? "workflow_approved_final"
        : "workflow_approved_level";
  }

  if (normalizedDecision === "reject") {
    nextStatus = "rejected";
    actionName = "workflow_rejected";
  }

  if (normalizedDecision === "escalate") {
    nextStatus = "in_review";
    nextRequiredApprovals = Math.min(5, Math.max(requiredApprovals + 1, currentApprovals + 1));
    actionName = "workflow_escalated";
  }

  await client.query(
    `
    update core.requests
    set
      status = $1,
      approval_count = $2,
      required_approvals = $3,
      updated_at = now(),
      last_decision_at = now(),
      last_decision_by = $4,
      closed_at = case when $1 in ('approved', 'rejected', 'cancelled') then now() else null end
    where id = $5
    `,
    [nextStatus, nextApprovals, nextRequiredApprovals, actorUserId, requestId]
  );

  await client.query(
    `
    insert into core.request_actions (
      request_id,
      action,
      note,
      acted_by,
      approval_level,
      metadata
    )
    values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      requestId,
      actionName,
      normalizeString(note),
      actorUserId,
      normalizedDecision === "approve" ? nextApprovals : currentApprovals,
      JSON.stringify({
        decision: normalizedDecision,
        fromStatus,
        toStatus: nextStatus,
        approvalCount: nextApprovals,
        requiredApprovals: nextRequiredApprovals,
      }),
    ]
  );

  return {
    status: nextStatus,
    approvalCount: nextApprovals,
    requiredApprovals: nextRequiredApprovals,
  };
}

app.get(
  "/api/instructor/sections",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const result = await pool.query(
        `
        select
          cs.id,
          c.code as course_code,
          c.title as course_title,
          cs.section_code,
          t.name as term_name
        from academics.course_sections cs
        join academics.courses c on c.id = cs.course_id
        join academics.terms t on t.id = cs.term_id
        where cs.instructor_staff_id = $1
        order by t.start_date desc, c.code
        `,
        [staffId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor sections error:", error);
      return res.status(500).json({ message: "تعذر تحميل شعب المحاضر." });
    }
  }
);

app.get(
  "/api/instructor/assessments",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const sectionId = normalizeString(req.query.section_id);
      if (!sectionId) {
        return res.json({ rows: [] });
      }

      const result = await pool.query(
        `
        select a.id, a.name, a.max_score, a.weight
        from academics.assessments a
        join academics.course_sections cs on cs.id = a.section_id
        where a.section_id = $1 and cs.instructor_staff_id = $2
        order by a.name
        `,
        [sectionId, staffId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor assessments error:", error);
      return res.status(500).json({ message: "تعذر تحميل التقييمات." });
    }
  }
);

app.get(
  "/api/instructor/grades",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const sectionId = normalizeString(req.query.section_id);
      const assessmentId = normalizeString(req.query.assessment_id);
      if (!sectionId || !assessmentId) {
        return res.json({ rows: [] });
      }

      const sectionResult = await pool.query(
        `
        select id
        from academics.course_sections
        where id = $1 and instructor_staff_id = $2
        `,
        [sectionId, staffId]
      );

      if (sectionResult.rowCount === 0) {
        return res.status(403).json({ message: "غير مصرح بهذه الشعبة." });
      }

      const result = await pool.query(
        `
        select
          cand.id as candidate_id,
          cand.candidate_no,
          p.first_name,
          p.last_name,
          g.score,
          a.max_score
        from academics.enrollments e
        join core.candidates cand on cand.id = e.candidate_id
        join core.people p on p.id = cand.person_id
        join academics.assessments a on a.id = $2
        left join academics.grades g
          on g.candidate_id = cand.id and g.assessment_id = a.id
        where e.section_id = $1
        order by cand.candidate_no
        `,
        [sectionId, assessmentId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor grades error:", error);
      return res.status(500).json({ message: "تعذر تحميل درجات الطلبة." });
    }
  }
);

app.post(
  "/api/instructor/grades",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const { sectionId, assessmentId, grades } = req.body || {};
      if (!sectionId || !assessmentId || !Array.isArray(grades)) {
        return res.status(400).json({ message: "بيانات الدرجات غير مكتملة." });
      }

      const sectionResult = await client.query(
        `
        select id
        from academics.course_sections
        where id = $1 and instructor_staff_id = $2
        `,
        [sectionId, staffId]
      );

      if (sectionResult.rowCount === 0) {
        return res.status(403).json({ message: "غير مصرح بهذه الشعبة." });
      }

      await client.query("begin");
      let updated = 0;
      for (const row of grades) {
        if (!row?.candidateId || row?.score === null || row?.score === undefined) continue;
        await client.query(
          `
          insert into academics.grades (assessment_id, candidate_id, score, graded_by)
          values ($1, $2, $3, $4)
          on conflict (assessment_id, candidate_id)
          do update set
            score = excluded.score,
            graded_by = excluded.graded_by,
            graded_at = now()
          `,
          [assessmentId, String(row.candidateId), Number(row.score), req.user.userId]
        );
        updated += 1;
      }
      await client.query("commit");
      return res.json({ updated });
    } catch (error) {
      await client.query("rollback");
      console.error("Instructor grades upsert error:", error);
      return res.status(500).json({ message: "تعذر حفظ الدرجات." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/instructor/workflow/requests",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      await ensureWorkflowSchema();
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const search = normalizeString(req.query.search)?.toLowerCase() || null;
      const status = normalizeString(req.query.status);
      const requestType = normalizeString(req.query.request_type);
      const limit = Math.min(Number(req.query.limit) || 150, 300);

      const conditions = [
        `r.candidate_id in (
          select e.candidate_id
          from academics.enrollments e
          join academics.course_sections cs on cs.id = e.section_id
          where cs.instructor_staff_id = $1
        )`,
      ];
      const values = [staffId];
      let index = 2;

      if (search) {
        conditions.push(
          `(lower(r.title) like $${index}
            or lower(coalesce(r.body, '')) like $${index}
            or lower(coalesce(c.candidate_no, '')) like $${index}
            or lower(coalesce(p.first_name, '')) like $${index}
            or lower(coalesce(p.last_name, '')) like $${index})`
        );
        values.push(`%${search}%`);
        index += 1;
      }

      if (status) {
        conditions.push(`r.status = $${index}`);
        values.push(status);
        index += 1;
      }

      if (requestType) {
        conditions.push(`r.request_type = $${index}`);
        values.push(requestType);
        index += 1;
      }

      const whereClause = `where ${conditions.join(" and ")}`;

      const result = await pool.query(
        `
        select
          r.id,
          r.request_type,
          r.title,
          r.body,
          r.status,
          r.priority,
          r.approval_count,
          r.required_approvals,
          r.submitted_at,
          r.updated_at,
          c.id as candidate_id,
          c.candidate_no,
          p.first_name,
          p.last_name
        from core.requests r
        join core.candidates c on c.id = r.candidate_id
        join core.people p on p.id = c.person_id
        ${whereClause}
        order by r.submitted_at desc
        limit $${index}
        `,
        [...values, limit]
      );

      return res.json({ rows: result.rows, total: result.rows.length });
    } catch (error) {
      console.error("Instructor workflow requests error:", error);
      return res.status(500).json({ message: "تعذر تحميل طلبات المحاضر." });
    }
  }
);

app.get(
  "/api/instructor/sections/:id/students",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const sectionId = req.params.id;
      const sectionResult = await pool.query(
        `
        select id
        from academics.course_sections
        where id = $1 and instructor_staff_id = $2
        `,
        [sectionId, staffId]
      );
      if (sectionResult.rowCount === 0) {
        return res.status(403).json({ message: "غير مصرح بهذه الشعبة." });
      }

      const result = await pool.query(
        `
        select
          cand.id as candidate_id,
          cand.candidate_no,
          p.first_name,
          p.last_name
        from academics.enrollments e
        join core.candidates cand on cand.id = e.candidate_id
        join core.people p on p.id = cand.person_id
        where e.section_id = $1
        order by cand.candidate_no
        `,
        [sectionId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor section students error:", error);
      return res.status(500).json({ message: "تعذر تحميل طلاب الشعبة." });
    }
  }
);

app.get(
  "/api/instructor/workflow/requests/:id/actions",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const requestId = req.params.id;
      const ownershipResult = await pool.query(
        `
        select r.id
        from core.requests r
        where r.id = $1
          and r.candidate_id in (
            select e.candidate_id
            from academics.enrollments e
            join academics.course_sections cs on cs.id = e.section_id
            where cs.instructor_staff_id = $2
          )
        `,
        [requestId, staffId]
      );

      if (ownershipResult.rowCount === 0) {
        return res.status(404).json({ message: "الطلب غير موجود ضمن نطاق المحاضر." });
      }

      const result = await pool.query(
        `
        select
          ra.id,
          ra.action,
          ra.note,
          ra.acted_at,
          ra.approval_level,
          ra.metadata,
          u.username as acted_by_username
        from core.request_actions ra
        left join auth.users u on u.id = ra.acted_by
        where ra.request_id = $1
        order by ra.acted_at desc
        `,
        [requestId]
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor workflow actions error:", error);
      return res.status(500).json({ message: "تعذر تحميل سجل الطلب." });
    }
  }
);

async function handleInstructorRequestDecision(req, res) {
  const client = await pool.connect();
  try {
    await ensureWorkflowSchema();
    const staffId = await getInstructorStaffId(req.user.userId);
    if (!staffId) {
      return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
    }

    const requestId = req.params.id;
    const ownershipResult = await client.query(
      `
      select r.id
      from core.requests r
      where r.id = $1
        and r.candidate_id in (
          select e.candidate_id
          from academics.enrollments e
          join academics.course_sections cs on cs.id = e.section_id
          where cs.instructor_staff_id = $2
        )
      `,
      [requestId, staffId]
    );

    if (ownershipResult.rowCount === 0) {
      return res.status(404).json({ message: "الطلب غير موجود ضمن نطاق المحاضر." });
    }

    await client.query("begin");
    const statusInput = normalizeString(req.body?.status);
    const decisionMap = {
      in_review: "in_review",
      approved: "approve",
      rejected: "reject",
      escalate: "escalate",
    };
    const decision = decisionMap[statusInput] || statusInput;
    const decisionResult = await applyWorkflowDecision(client, {
      requestId,
      decision,
      note: normalizeString(req.body?.note),
      actorUserId: req.user.userId,
    });
    await client.query("commit");

    return res.json({
      updated: true,
      status: decisionResult.status,
      approvalCount: decisionResult.approvalCount,
      requiredApprovals: decisionResult.requiredApprovals,
    });
  } catch (error) {
    await client.query("rollback");
    const status = Number(error.status) || 500;
    console.error("Instructor request status error:", error);
    return res.status(status).json({
      message: status === 500 ? "تعذر تحديث حالة الطلب." : error.message,
    });
  } finally {
    client.release();
  }
}

app.put(
  "/api/instructor/workflow/requests/:id/status",
  requireAuth,
  requireRole(["instructor"]),
  handleInstructorRequestDecision
);

app.put(
  "/api/instructor/requests/:id/status",
  requireAuth,
  requireRole(["instructor"]),
  handleInstructorRequestDecision
);

app.post(
  "/api/instructor/workflow/requests/:id/comment",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await ensureWorkflowSchema();
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const requestId = req.params.id;
      const note = normalizeString(req.body?.note);
      if (!note) {
        return res.status(400).json({ message: "يرجى إدخال تعليق." });
      }

      const ownershipResult = await client.query(
        `
        select r.id
        from core.requests r
        where r.id = $1
          and r.candidate_id in (
            select e.candidate_id
            from academics.enrollments e
            join academics.course_sections cs on cs.id = e.section_id
            where cs.instructor_staff_id = $2
          )
        `,
        [requestId, staffId]
      );

      if (ownershipResult.rowCount === 0) {
        return res.status(404).json({ message: "الطلب غير موجود ضمن نطاق المحاضر." });
      }

      await client.query("begin");
      await client.query(
        `update core.requests set updated_at = now() where id = $1`,
        [requestId]
      );
      await client.query(
        `
        insert into core.request_actions (request_id, action, note, acted_by)
        values ($1, 'workflow_comment', $2, $3)
        `,
        [requestId, note, req.user.userId]
      );
      await client.query("commit");

      return res.status(201).json({ created: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Instructor workflow comment error:", error);
      return res.status(500).json({ message: "تعذر حفظ التعليق." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/instructor/messages",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const { candidateId, body, topic } = req.body || {};
      if (!candidateId || !normalizeString(body)) {
        return res.status(400).json({ message: "يرجى اختيار الطالب وكتابة الرسالة." });
      }

      const inScope = await candidateInInstructorScope(client, staffId, String(candidateId));
      if (!inScope) {
        return res.status(403).json({ message: "لا يمكنك مراسلة طالب خارج شعبك." });
      }

      const candidateUserResult = await client.query(
        `
        select user_id
        from core.candidates
        where id = $1
        `,
        [String(candidateId)]
      );

      if (candidateUserResult.rowCount === 0) {
        return res.status(404).json({ message: "الطالب غير موجود." });
      }

      const candidateUserId = candidateUserResult.rows[0].user_id;
      const senderUserId = req.user.userId;

      await client.query("begin");
      const existingConversationResult = await client.query(
        `
        select cp1.conversation_id
        from comms.conversation_participants cp1
        join comms.conversation_participants cp2
          on cp2.conversation_id = cp1.conversation_id
        where cp1.user_id = $1 and cp2.user_id = $2
        limit 1
        `,
        [senderUserId, candidateUserId]
      );

      let conversationId = existingConversationResult.rows[0]?.conversation_id;
      if (!conversationId) {
        const conversationResult = await client.query(
          `
          insert into comms.conversations (topic)
          values ($1)
          returning id
          `,
          [normalizeString(topic) || "Instructor Follow-up"]
        );
        conversationId = conversationResult.rows[0].id;
        await client.query(
          `
          insert into comms.conversation_participants (conversation_id, user_id)
          values ($1, $2), ($1, $3)
          on conflict do nothing
          `,
          [conversationId, senderUserId, candidateUserId]
        );
      }

      await client.query(
        `
        insert into comms.messages (conversation_id, sender_user_id, body)
        values ($1, $2, $3)
        `,
        [conversationId, senderUserId, normalizeString(body)]
      );

      await client.query("commit");
      return res.status(201).json({ sent: true, conversationId });
    } catch (error) {
      await client.query("rollback");
      console.error("Instructor message create error:", error);
      return res.status(500).json({ message: "تعذر إرسال الرسالة." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/instructor/messages/list",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const candidateId = normalizeString(req.query.candidate_id);
      const values = [req.user.userId, staffId];
      let index = 3;
      let candidateCondition = "";

      if (candidateId) {
        candidateCondition = `and cand.id = $${index}`;
        values.push(candidateId);
      }

      const result = await pool.query(
        `
        select
          m.id,
          m.body,
          m.sent_at,
          conv.id as conversation_id,
          conv.topic,
          sender.username as sender_username,
          cand.id as candidate_id,
          cand.candidate_no,
          p.first_name,
          p.last_name
        from comms.messages m
        join comms.conversations conv on conv.id = m.conversation_id
        join comms.conversation_participants cp_instructor
          on cp_instructor.conversation_id = conv.id
          and cp_instructor.user_id = $1
        join comms.conversation_participants cp_candidate
          on cp_candidate.conversation_id = conv.id
          and cp_candidate.user_id <> $1
        join core.candidates cand on cand.user_id = cp_candidate.user_id
        join core.people p on p.id = cand.person_id
        left join auth.users sender on sender.id = m.sender_user_id
        where cand.id in (
          select distinct e.candidate_id
          from academics.enrollments e
          join academics.course_sections cs on cs.id = e.section_id
          where cs.instructor_staff_id = $2
        )
        ${candidateCondition}
        order by m.sent_at desc
        limit 200
        `,
        values
      );

      return res.json({ rows: result.rows });
    } catch (error) {
      console.error("Instructor messages list error:", error);
      return res.status(500).json({ message: "تعذر تحميل سجل الرسائل." });
    }
  }
);

app.get(
  "/api/instructor/attendance/summary",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const sectionId = normalizeString(req.query.section_id);
      const fromDate = normalizeString(req.query.from);
      const toDate = normalizeString(req.query.to);

      const conditions = [`cs.instructor_staff_id = $1`];
      const values = [staffId];
      let index = 2;
      if (sectionId) {
        conditions.push(`cs.id = $${index}`);
        values.push(sectionId);
        index += 1;
      }
      if (fromDate) {
        conditions.push(`s.session_at::date >= $${index}`);
        values.push(fromDate);
        index += 1;
      }
      if (toDate) {
        conditions.push(`s.session_at::date <= $${index}`);
        values.push(toDate);
        index += 1;
      }
      const whereClause = `where ${conditions.join(" and ")}`;

      const [summaryResult, sectionsResult, rosterResult] = await Promise.all([
        pool.query(
          `
          select
            count(*)::int as total_sessions,
            sum(case when a.present then 1 else 0 end)::int as present_sessions,
            sum(case when a.present = false then 1 else 0 end)::int as absent_sessions
          from academics.attendance a
          join academics.attendance_sessions s on s.id = a.attendance_session_id
          join academics.course_sections cs on cs.id = s.section_id
          ${whereClause}
          `,
          values
        ),
        pool.query(
          `
          select
            cs.id,
            c.code as course_code,
            c.title as course_title,
            cs.section_code,
            t.name as term_name
          from academics.course_sections cs
          join academics.courses c on c.id = cs.course_id
          join academics.terms t on t.id = cs.term_id
          where cs.instructor_staff_id = $1
          order by t.start_date desc, c.code
          `,
          [staffId]
        ),
        pool.query(
          `
          select
            cand.id as candidate_id,
            cand.candidate_no,
            p.first_name,
            p.last_name,
            sum(case when a.present then 1 else 0 end)::int as present_sessions,
            sum(case when a.present = false then 1 else 0 end)::int as absent_sessions,
            count(a.id)::int as total_sessions,
            round(
              (sum(case when a.present then 1 else 0 end)::numeric / nullif(count(a.id), 0)) * 100,
              2
            ) as attendance_rate
          from academics.attendance a
          join academics.attendance_sessions s on s.id = a.attendance_session_id
          join academics.course_sections cs on cs.id = s.section_id
          join core.candidates cand on cand.id = a.candidate_id
          join core.people p on p.id = cand.person_id
          ${whereClause}
          group by cand.id, cand.candidate_no, p.first_name, p.last_name
          order by attendance_rate asc nulls last, cand.candidate_no
          limit 120
          `,
          values
        ),
      ]);

      const summary = summaryResult.rows[0] || {
        total_sessions: 0,
        present_sessions: 0,
        absent_sessions: 0,
      };
      return res.json({
        summary: {
          total: Number(summary.total_sessions || 0),
          present: Number(summary.present_sessions || 0),
          absent: Number(summary.absent_sessions || 0),
        },
        sections: sectionsResult.rows,
        roster: rosterResult.rows,
      });
    } catch (error) {
      console.error("Instructor attendance summary error:", error);
      return res.status(500).json({ message: "تعذر تحميل ملخص الحضور." });
    }
  }
);

app.post(
  "/api/instructor/attendance/records",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const sectionId = normalizeString(req.body?.sectionId);
      const sessionAt = parseDateTime(req.body?.sessionAt) || new Date().toISOString();
      const topic = normalizeString(req.body?.topic);
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!sectionId || records.length === 0) {
        return res.status(400).json({ message: "بيانات الحضور غير مكتملة." });
      }

      const sectionResult = await client.query(
        `
        select id
        from academics.course_sections
        where id = $1 and instructor_staff_id = $2
        `,
        [sectionId, staffId]
      );
      if (sectionResult.rowCount === 0) {
        return res.status(403).json({ message: "لا يمكنك تسجيل حضور لهذه الشعبة." });
      }

      await client.query("begin");
      const sessionResult = await client.query(
        `
        insert into academics.attendance_sessions (section_id, session_at, topic)
        values ($1, $2, $3)
        returning id
        `,
        [sectionId, sessionAt, topic]
      );
      const attendanceSessionId = sessionResult.rows[0].id;

      let updated = 0;
      for (const row of records) {
        const candidateId = normalizeString(row?.candidateId);
        if (!candidateId) continue;
        const inScope = await client.query(
          `
          select 1
          from academics.enrollments
          where section_id = $1 and candidate_id = $2
          `,
          [sectionId, candidateId]
        );
        if (inScope.rowCount === 0) continue;

        await client.query(
          `
          insert into academics.attendance (
            attendance_session_id,
            candidate_id,
            present,
            note
          )
          values ($1, $2, $3, $4)
          on conflict (attendance_session_id, candidate_id)
          do update set
            present = excluded.present,
            note = excluded.note
          `,
          [
            attendanceSessionId,
            candidateId,
            parseBoolean(row?.present) !== false,
            normalizeString(row?.note),
          ]
        );
        updated += 1;
      }

      await client.query("commit");
      return res.json({ updated, attendanceSessionId });
    } catch (error) {
      await client.query("rollback");
      console.error("Instructor attendance save error:", error);
      return res.status(500).json({ message: "تعذر حفظ الحضور." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/instructor/overview",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
      await ensureWorkflowSchema();
      const userId = req.user.userId;

      const staffResult = await pool.query(
        `
        select
          s.id,
          p.first_name,
          p.last_name,
          d.name as department,
          s.position_title,
          s.rank_title,
          r.name as rank_name
        from core.staff s
        join core.people p on p.id = s.person_id
        left join core.departments d on d.id = s.department_id
        left join core.ranks r on r.id = s.rank_id
        where s.user_id = $1
        `,
        [userId]
      );

      if (staffResult.rowCount === 0) {
        return res.status(404).json({
          message: "لا يوجد ملف موظف مرتبط بهذا الحساب.",
        });
      }

      const staff = staffResult.rows[0];

      const sectionsResult = await pool.query(
        `
        select
          cs.id,
          c.code,
          c.title,
          cs.section_code,
          t.name as term_name,
          (
            select count(*)
            from academics.enrollments e
            where e.section_id = cs.id
          )::int as enrollment_count
        from academics.course_sections cs
        join academics.courses c on c.id = cs.course_id
        join academics.terms t on t.id = cs.term_id
        where cs.instructor_staff_id = $1
        order by t.start_date desc, c.code
        `,
        [staff.id]
      );

      const sectionIds = sectionsResult.rows.map((row) => row.id);

      const studentsResult = sectionIds.length
        ? await pool.query(
            `
            select distinct
              cand.id,
              cand.candidate_no,
              cand.status,
              p.first_name,
              p.last_name
            from academics.enrollments e
            join academics.course_sections cs on cs.id = e.section_id
            join core.candidates cand on cand.id = e.candidate_id
            join core.people p on p.id = cand.person_id
            where cs.id = any($1::uuid[])
            order by p.last_name, p.first_name
            limit 50
            `,
            [sectionIds]
          )
        : { rows: [] };

      const gradesResult = sectionIds.length
        ? await pool.query(
            `
            select
              c.code,
              c.title,
              a.name as assessment_name,
              g.score,
              a.max_score,
              p.first_name,
              p.last_name,
              g.graded_at
            from academics.grades g
            join academics.assessments a on a.id = g.assessment_id
            join academics.course_sections cs on cs.id = a.section_id
            join academics.courses c on c.id = cs.course_id
            join core.candidates cand on cand.id = g.candidate_id
            join core.people p on p.id = cand.person_id
            where cs.id = any($1::uuid[])
            order by g.graded_at desc
            limit 20
            `,
            [sectionIds]
          )
        : { rows: [] };

      const requestsResult = sectionIds.length
        ? await pool.query(
            `
            select
              r.id,
              r.request_type,
              r.title,
              r.status,
              r.priority,
              r.approval_count,
              r.required_approvals,
              r.submitted_at,
              p.first_name,
              p.last_name
            from core.requests r
            join core.candidates cand on cand.id = r.candidate_id
            join core.people p on p.id = cand.person_id
            where r.candidate_id in (
              select e.candidate_id
              from academics.enrollments e
              where e.section_id = any($1::uuid[])
            )
            order by r.submitted_at desc
            limit 20
            `,
            [sectionIds]
          )
        : { rows: [] };

      const messagesResult = await pool.query(
        `
        select
          m.id,
          m.body,
          m.sent_at,
          u.username as sender_username
        from comms.messages m
        join comms.conversation_participants cp on cp.conversation_id = m.conversation_id
        left join auth.users u on u.id = m.sender_user_id
        where cp.user_id = $1
        order by m.sent_at desc
        limit 10
        `,
        [userId]
      );

      const totalSections = sectionsResult.rows.length;
      const totalStudents = studentsResult.rows.length;
      const pendingRequests = requestsResult.rows.filter(
        (row) => row.status === "submitted" || row.status === "in_review"
      ).length;

      const avgScoreResult = sectionIds.length
        ? await pool.query(
            `
            select avg(g.score)::numeric(10,2) as average_score
            from academics.grades g
            join academics.assessments a on a.id = g.assessment_id
            join academics.course_sections cs on cs.id = a.section_id
            where cs.id = any($1::uuid[])
            `,
            [sectionIds]
          )
        : { rows: [{ average_score: null }] };

      return res.json({
        profile: {
          fullName: `${staff.first_name} ${staff.last_name}`.trim(),
          department: staff.department,
          positionTitle: staff.position_title,
          rankTitle: staff.rank_name || staff.rank_title,
        },
        summary: {
          totalSections,
          totalStudents,
          pendingRequests,
          averageScore: avgScoreResult.rows[0]?.average_score || null,
        },
        courses: sectionsResult.rows,
        students: studentsResult.rows,
        grades: gradesResult.rows,
        requests: requestsResult.rows,
        messages: messagesResult.rows,
      });
    } catch (error) {
      console.error("Instructor overview error:", error);
      return res.status(500).json({ message: "تعذر تحميل بوابة المحاضر." });
    }
  }
);

app.get("/api/portal/overview", requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const profileResult = await pool.query(
      `
      select
        c.id as candidate_id,
        c.candidate_no,
        c.status,
        c.intake_year,
        c.advisor_staff_id,
        c.background,
        c.military_no,
        c.sports_no,
        coh.cohort_no,
        coh.name as cohort_name,
        coh.track as cohort_track,
        pl.platoon_no,
        pl.name as platoon_name,
        p.first_name,
        p.last_name,
        p.national_id,
        p.address,
        p.height_cm,
        p.weight_kg,
        p.birth_date,
        date_part('year', age(p.birth_date))::int as age,
        u.email,
        u.phone
      from core.candidates c
      join core.people p on p.id = c.person_id
      join auth.users u on u.id = c.user_id
      left join core.cohorts coh on coh.id = c.cohort_id
      left join core.platoons pl on pl.id = c.platoon_id
      where c.user_id = $1
      `,
      [userId]
    );

    if (profileResult.rowCount === 0) {
      return res.status(404).json({
        message: "لا توجد بيانات مرشح مرتبطة بهذا المستخدم.",
      });
    }

    const profileRow = profileResult.rows[0];
    const candidateId = profileRow.candidate_id;

    const gradesPromise = pool.query(
      `
      select
        c.code as course_code,
        c.title as course_title,
        a.name as assessment_name,
        g.score,
        a.max_score
      from academics.grades g
      join academics.assessments a on a.id = g.assessment_id
      join academics.course_sections cs on cs.id = a.section_id
      join academics.courses c on c.id = cs.course_id
      where g.candidate_id = $1
      order by c.code, a.name
      `,
      [candidateId]
    );

    const coursesPromise = pool.query(
      `
      select
        cs.id as section_id,
        c.code as course_code,
        c.title as course_title,
        cs.section_code,
        ip.first_name as instructor_first_name,
        ip.last_name as instructor_last_name
      from academics.enrollments e
      join academics.course_sections cs on cs.id = e.section_id
      join academics.courses c on c.id = cs.course_id
      left join core.staff s on s.id = cs.instructor_staff_id
      left join core.people ip on ip.id = s.person_id
      where e.candidate_id = $1
      order by c.code, cs.section_code
      `,
      [candidateId]
    );

    const requestsPromise = pool.query(
      `
      select id, request_type, title, body, status, submitted_at
      from core.requests
      where candidate_id = $1
      order by submitted_at desc
      `,
      [candidateId]
    );

    const notificationsPromise = pool.query(
      `
      select id, title, body, created_at, is_read
      from comms.notifications
      where user_id = $1
      order by created_at desc
      limit 10
      `,
      [userId]
    );

    const attendanceSummaryPromise = pool.query(
      `
      select
        count(*)::int as total_sessions,
        sum(case when present then 1 else 0 end)::int as present_sessions,
        sum(case when present = false then 1 else 0 end)::int as absent_sessions
      from academics.attendance
      where candidate_id = $1
      `,
      [candidateId]
    );

    const attendancePromise = pool.query(
      `
      select
        c.code as course_code,
        c.title as course_title,
        s.session_at,
        a.present
      from academics.attendance a
      join academics.attendance_sessions s on s.id = a.attendance_session_id
      join academics.course_sections cs on cs.id = s.section_id
      join academics.courses c on c.id = cs.course_id
      where a.candidate_id = $1
      order by s.session_at desc
      limit 20
      `,
      [candidateId]
    );

    const medicalPromise = pool.query(
      `
      select
        e.id,
        et.name as exam_name,
        e.status,
        e.scheduled_at,
        e.performed_at,
        r.fit_status,
        r.summary
      from medical.exams e
      join medical.exam_types et on et.id = e.exam_type_id
      left join medical.exam_results r on r.exam_id = e.id
      where e.candidate_id = $1
      order by coalesce(e.performed_at, e.scheduled_at) desc
      limit 10
      `,
      [candidateId]
    );

    const announcementsPromise = pool.query(
      `
      select
        a.id,
        a.title,
        a.body,
        a.published_at,
        a.expires_at
      from comms.announcements a
      where a.status = 'published'
        and (a.expires_at is null or a.expires_at > now())
        and (
          not exists (
            select 1
            from comms.announcement_targets t
            where t.announcement_id = a.id
          )
          or exists (
            select 1
            from comms.announcement_targets t
            join auth.roles r on r.id = t.role_id
            where t.announcement_id = a.id
              and r.name = 'candidate'
          )
          or exists (
            select 1
            from comms.announcement_targets t
            where t.announcement_id = a.id
              and t.candidate_id = $1
          )
        )
      order by a.published_at desc nulls last, a.created_at desc
      limit 10
      `,
      [candidateId]
    );

    const advisorPromise = profileRow.advisor_staff_id
      ? pool.query(
          `
          select
            p.first_name,
            p.last_name,
            d.name as department,
            s.position_title,
            s.rank_title
          from core.staff s
          join core.people p on p.id = s.person_id
          left join core.departments d on d.id = s.department_id
          where s.id = $1
          `,
          [profileRow.advisor_staff_id]
        )
      : Promise.resolve({ rows: [] });

    const [
      gradesResult,
      coursesResult,
      requestsResult,
      notificationsResult,
      attendanceSummaryResult,
      attendanceResult,
      medicalResult,
      announcementsResult,
      advisorResult,
    ] = await Promise.all([
      gradesPromise,
      coursesPromise,
      requestsPromise,
      notificationsPromise,
      attendanceSummaryPromise,
      attendancePromise,
      medicalPromise,
      announcementsPromise,
      advisorPromise,
    ]);

    const grades = gradesResult.rows.map((row) => {
      const score = Number(row.score);
      const maxScore = Number(row.max_score);
      const percentage =
        Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
          ? Math.round((score / maxScore) * 100)
          : null;

      return {
        courseCode: row.course_code,
        courseTitle: row.course_title,
        assessmentName: row.assessment_name,
        score,
        maxScore,
        percentage,
      };
    });

    const courses = coursesResult.rows.map((row) => ({
      sectionId: row.section_id,
      courseCode: row.course_code,
      courseTitle: row.course_title,
      sectionCode: row.section_code,
      instructorName:
        row.instructor_first_name || row.instructor_last_name
          ? `${row.instructor_first_name || ""} ${
              row.instructor_last_name || ""
            }`.trim()
          : null,
    }));

    const requests = requestsResult.rows.map((row) => ({
      id: row.id,
      requestType: row.request_type,
      title: row.title,
      body: row.body,
      status: row.status,
      submittedAt: row.submitted_at,
    }));

    const notifications = notificationsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      isRead: row.is_read,
    }));

    const attendanceSummaryRow = attendanceSummaryResult.rows[0] || {
      total_sessions: 0,
      present_sessions: 0,
      absent_sessions: 0,
    };

    const attendanceSummary = {
      totalSessions: Number(attendanceSummaryRow.total_sessions || 0),
      presentSessions: Number(attendanceSummaryRow.present_sessions || 0),
      absentSessions: Number(attendanceSummaryRow.absent_sessions || 0),
    };

    const attendance = attendanceResult.rows.map((row) => ({
      courseCode: row.course_code,
      courseTitle: row.course_title,
      sessionAt: row.session_at,
      present: row.present,
    }));

    const medical = medicalResult.rows.map((row) => ({
      id: row.id,
      examName: row.exam_name,
      status: row.status,
      scheduledAt: row.scheduled_at,
      performedAt: row.performed_at,
      fitStatus: row.fit_status,
      summary: row.summary,
    }));

    const announcements = announcementsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      publishedAt: row.published_at,
      expiresAt: row.expires_at,
    }));

    const advisorRow = advisorResult.rows[0];
    const advisor = advisorRow
      ? {
          name: `${advisorRow.first_name} ${advisorRow.last_name}`.trim(),
          department: advisorRow.department,
          positionTitle: advisorRow.position_title,
          rankTitle: advisorRow.rank_title,
        }
      : null;

    const profile = {
      candidateId,
      candidateNo: profileRow.candidate_no,
      status: profileRow.status,
      intakeYear: profileRow.intake_year,
      background: profileRow.background,
      militaryNo: profileRow.military_no,
      sportsNo: profileRow.sports_no,
      cohortNo: profileRow.cohort_no,
      cohortName: profileRow.cohort_name,
      cohortTrack: profileRow.cohort_track,
      platoonNo: profileRow.platoon_no,
      platoonName: profileRow.platoon_name,
      fullName: `${profileRow.first_name} ${profileRow.last_name}`.trim(),
      nationalId: profileRow.national_id,
      email: profileRow.email,
      phone: profileRow.phone,
      address: profileRow.address,
      heightCm: profileRow.height_cm,
      weightKg: profileRow.weight_kg,
      birthDate: profileRow.birth_date,
      age: profileRow.age,
    };

    return res.json({
      profile,
      grades,
      courses,
      advisor,
      requests,
      notifications,
      attendanceSummary,
      attendance,
      medical,
      announcements,
    });
  } catch (error) {
    console.error("Overview error:", error);
    return res.status(500).json({ message: "تعذر تحميل البيانات." });
  }
});

app.post("/api/requests", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureWorkflowSchema();
    const userId = req.user.userId;
    const { requestType, title, body, priority } = req.body || {};
    const parsedPriority = normalizePriority(priority || "normal");

    if (!requestType || !title) {
      return res.status(400).json({
        message: "يرجى إدخال نوع الطلب والعنوان.",
      });
    }

    if (!parsedPriority) {
      return res.status(400).json({ message: "قيمة الأولوية غير صالحة." });
    }

    const candidateResult = await client.query(
      `
      select id
      from core.candidates
      where user_id = $1
      `,
      [userId]
    );

    if (candidateResult.rowCount === 0) {
      return res.status(404).json({
        message: "لا توجد بيانات مرشح مرتبطة بهذا المستخدم.",
      });
    }

    const candidateId = candidateResult.rows[0].id;

    await client.query("begin");
    const insertResult = await client.query(
      `
      insert into core.requests (
        candidate_id,
        request_type,
        title,
        body,
        priority,
        required_approvals,
        approval_count,
        created_by
      )
      values ($1, $2, $3, $4, $5, 2, 0, $6)
      returning id, request_type, title, body, status, priority, submitted_at
      `,
      [candidateId, requestType, title, body || null, parsedPriority, userId]
    );

    const request = insertResult.rows[0];
    await client.query(
      `
      insert into core.request_actions (request_id, action, note, acted_by, approval_level, metadata)
      values ($1, 'workflow_submitted', $2, $3, 0, $4::jsonb)
      `,
      [
        request.id,
        "تم إنشاء الطلب من بوابة المرشح.",
        userId,
        JSON.stringify({
          status: request.status,
          priority: request.priority,
        }),
      ]
    );
    await client.query("commit");

    return res.status(201).json({
      request: {
        id: request.id,
        requestType: request.request_type,
        title: request.title,
        body: request.body,
        status: request.status,
        priority: request.priority,
        submittedAt: request.submitted_at,
      },
    });
  } catch (error) {
    await client.query("rollback");
    console.error("Create request error:", error);
    return res.status(500).json({ message: "تعذر حفظ الطلب." });
  } finally {
    client.release();
  }
});

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Another API process is likely running. Stop it first or change PORT in .env.`
    );
    return process.exit(1);
  }
  if (error.code === "EACCES") {
    console.error(
      `Port ${port} is blocked by system policy on this machine. Choose another port in .env (for example 4300 or 4400).`
    );
    return process.exit(1);
  }
  console.error("Server startup error:", error);
  process.exit(1);
});

