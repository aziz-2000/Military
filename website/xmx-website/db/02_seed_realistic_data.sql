-- ==========================================
-- Realistic seed data for cohorts, platoons, candidates, courses, grades
-- ==========================================

-- Ensure base roles exist
INSERT INTO auth.roles (name, description) VALUES
('admin', 'System administrator'),
('candidate', 'College candidate'),
('instructor', 'Academic instructor'),
('uploader', 'Data upload staff'),
('media_writer', 'Media content writer'),
('media_reviewer', 'Media content reviewer'),
('media_publisher', 'Media content publisher')
ON CONFLICT DO NOTHING;

INSERT INTO auth.permissions (code, description) VALUES
('media.categories.read', 'Read media categories'),
('media.categories.write', 'Manage media categories'),
('media.posts.read', 'Read media posts'),
('media.posts.write', 'Create and update media posts'),
('media.posts.review', 'Review and approve/reject media posts'),
('media.posts.publish', 'Publish/archive/pin media posts'),
('media.files.read', 'Read uploaded media files'),
('media.dashboard.read', 'Read media dashboard')
ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.code IN (
  'media.categories.read',
  'media.categories.write',
  'media.posts.read',
  'media.posts.write',
  'media.posts.review',
  'media.posts.publish',
  'media.files.read',
  'media.dashboard.read'
)
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.code IN (
  'media.categories.read',
  'media.posts.read',
  'media.posts.write',
  'media.files.read',
  'media.dashboard.read'
)
WHERE r.name = 'media_writer'
ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.code IN (
  'media.categories.read',
  'media.posts.read',
  'media.posts.review',
  'media.files.read',
  'media.dashboard.read'
)
WHERE r.name = 'media_reviewer'
ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.code IN (
  'media.categories.read',
  'media.categories.write',
  'media.posts.read',
  'media.posts.publish',
  'media.files.read',
  'media.dashboard.read'
)
WHERE r.name = 'media_publisher'
ON CONFLICT DO NOTHING;

-- Admin + uploader accounts
INSERT INTO auth.users (username, email, password_hash)
VALUES
('admin1', 'admin@college.test', crypt('admin123', gen_salt('bf'))),
('uploader1', 'uploader@college.test', crypt('upload123', gen_salt('bf'))),
('media_writer1', 'media_writer@college.test', crypt('writer123', gen_salt('bf'))),
('media_reviewer1', 'media_reviewer@college.test', crypt('review123', gen_salt('bf'))),
('media_publisher1', 'media_publisher@college.test', crypt('publish123', gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'admin'
WHERE u.username = 'admin1'
ON CONFLICT DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'uploader'
WHERE u.username = 'uploader1'
ON CONFLICT DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'media_writer'
WHERE u.username = 'media_writer1'
ON CONFLICT DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'media_reviewer'
WHERE u.username = 'media_reviewer1'
ON CONFLICT DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'media_publisher'
WHERE u.username = 'media_publisher1'
ON CONFLICT DO NOTHING;

INSERT INTO core.departments (name, code)
VALUES ('الإدارة العامة', 'ADM')
ON CONFLICT (name) DO NOTHING;

INSERT INTO core.people (national_id, first_name, last_name, gender)
VALUES
('ADM-001', 'سالم', 'الإداري', 'male'),
('UPL-001', 'راشد', 'الوثائق', 'male')
ON CONFLICT (national_id) DO NOTHING;

INSERT INTO core.staff (user_id, person_id, department_id, position_title, rank_title)
SELECT u.id, p.id, d.id, 'مدير النظام', 'عقيد ركن'
FROM auth.users u
JOIN core.people p ON p.national_id = 'ADM-001'
JOIN core.departments d ON d.code = 'ADM'
WHERE u.username = 'admin1'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO core.staff (user_id, person_id, department_id, position_title, rank_title)
SELECT u.id, p.id, d.id, 'مسؤول رفع البيانات', 'رقيب'
FROM auth.users u
JOIN core.people p ON p.national_id = 'UPL-001'
JOIN core.departments d ON d.code = 'ADM'
WHERE u.username = 'uploader1'
ON CONFLICT (user_id) DO NOTHING;

-- Cohorts
INSERT INTO core.cohorts (cohort_no, name, track, start_year) VALUES
(61, 'الدورة التقدمية 61', 'تقدمية', 2025),
(62, 'الدورة التأسيسية 62', 'تأسيسية', 2025),
(63, 'الدورة التأسيسية 63', 'تأسيسية', 2026)
ON CONFLICT (cohort_no) DO NOTHING;

-- Ranks (ordered from أعلى إلى أدنى)
INSERT INTO core.ranks (name, order_index, category) VALUES
('عقيد ركن', 1, 'ضباط'),
('مقدم', 2, 'ضباط'),
('رائد', 3, 'ضباط'),
('نقيب', 4, 'ضباط'),
('ملازم أول', 5, 'ضباط'),
('ملازم', 6, 'ضباط'),
('وكيل أول', 7, 'رتب أخرى'),
('وكيل', 8, 'رتب أخرى'),
('رقيب أول', 9, 'صف ضباط'),
('رقيب', 10, 'صف ضباط'),
('عريف', 11, 'صف ضباط'),
('نائب عريف', 12, 'صف ضباط'),
('جندي', 13, 'جنود')
ON CONFLICT (name) DO NOTHING;

-- Platoons (6 per cohort)
INSERT INTO core.platoons (cohort_id, platoon_no, name)
SELECT c.id, p, concat('الفصيل ', p)
FROM core.cohorts c
CROSS JOIN generate_series(1, 6) AS p
WHERE c.cohort_no IN (61, 62)
ON CONFLICT (cohort_id, platoon_no) DO NOTHING;

-- =========================
-- Candidate generation (10 per platoon, Arabic names)
-- =========================

DROP TABLE IF EXISTS tmp_candidates;
CREATE TEMP TABLE tmp_candidates (
  username text,
  email text,
  first_name text,
  last_name text,
  national_id text,
  birth_date date,
  height_cm int,
  weight_kg numeric(5,2),
  address text,
  background text,
  candidate_no text,
  military_no text,
  sports_no text,
  cohort_id uuid,
  platoon_id uuid
);

WITH names AS (
  SELECT
    ARRAY['أحمد','محمد','سالم','خالد','حمد','ناصر','علي','سلطان','راشد','سعيد','يوسف','مازن','فهد','بدر','حمود','جاسم','راكان','طلال','فيصل','زياد'] AS first_names,
    ARRAY['الكندي','البلوشي','الزدجالي','الهاشمي','الشامسي','الحراصي','العامري','الهنائي','الغافري','البوسعيدي','الكلباني','المنذري','الشحري','السعدي','العلوي','العريمي','السليطي','السالمي','الظاهري','المري'] AS last_names,
    ARRAY['مسقط','صحار','نزوى','صور','الرستاق','البريمي','صلالة','عبري'] AS cities,
    ARRAY['جامعي','عسكري سابق','مدني'] AS backgrounds
)
INSERT INTO tmp_candidates (
  username,
  email,
  first_name,
  last_name,
  national_id,
  birth_date,
  height_cm,
  weight_kg,
  address,
  background,
  candidate_no,
  military_no,
  sports_no,
  cohort_id,
  platoon_id
)
SELECT
  format('cad%s_%s_%s', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS username,
  format('cad%s_%s_%s@college.test', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS email,
  (names.first_names)[floor(random() * array_length(names.first_names, 1) + 1)] AS first_name,
  (names.last_names)[floor(random() * array_length(names.last_names, 1) + 1)] AS last_name,
  format('N%s%s%s', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS national_id,
  date '2001-01-01' + (random() * 1800)::int AS birth_date,
  (165 + floor(random() * 25))::int AS height_cm,
  round((60 + (random() * 30))::numeric, 2)::numeric(5,2) AS weight_kg,
  concat('سلطنة عمان - ', (names.cities)[floor(random() * array_length(names.cities, 1) + 1)]) AS address,
  (names.backgrounds)[floor(random() * array_length(names.backgrounds, 1) + 1)] AS background,
  format('C-%s-%s-%s', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS candidate_no,
  format('MN-%s-%s-%s', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS military_no,
  format('SN-%s-%s-%s', c.cohort_no, p.platoon_no, lpad(gs::text, 2, '0')) AS sports_no,
  c.id AS cohort_id,
  p.id AS platoon_id
FROM core.cohorts c
JOIN core.platoons p ON p.cohort_id = c.id
JOIN generate_series(1, 10) AS gs ON true
CROSS JOIN names
WHERE c.cohort_no IN (61, 62);

-- Users for candidates
INSERT INTO auth.users (username, email, password_hash)
SELECT username, email, crypt('candidate123', gen_salt('bf'))
FROM tmp_candidates
ON CONFLICT (username) DO NOTHING;

-- People for candidates
INSERT INTO core.people (national_id, first_name, last_name, gender, birth_date, height_cm, weight_kg, address)
SELECT national_id, first_name, last_name, 'male', birth_date, height_cm, weight_kg, address
FROM tmp_candidates
ON CONFLICT (national_id) DO NOTHING;

-- Candidate profiles
INSERT INTO core.candidates (
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
SELECT u.id, p.id, t.candidate_no, 'enrolled', 2025, t.cohort_id, t.platoon_id, t.background, t.military_no, t.sports_no
FROM tmp_candidates t
JOIN auth.users u ON u.username = t.username
JOIN core.people p ON p.national_id = t.national_id
ON CONFLICT (candidate_no) DO NOTHING;

-- Assign candidate role
INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'candidate'
WHERE u.username LIKE 'cad%'
ON CONFLICT DO NOTHING;

-- =========================
-- Instructor accounts (for instructor portal demo)
-- =========================
INSERT INTO auth.users (username, email, password_hash)
VALUES
('instructor_adv', 'instructor_adv@college.test', crypt('teach123', gen_salt('bf'))),
('instructor_fnd', 'instructor_fnd@college.test', crypt('teach123', gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;

INSERT INTO auth.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u
JOIN auth.roles r ON r.name = 'instructor'
WHERE u.username IN ('instructor_adv','instructor_fnd')
ON CONFLICT DO NOTHING;

INSERT INTO core.people (national_id, first_name, last_name, gender)
VALUES
('INS-ADV-001', 'ماهر', 'المدرسي', 'male'),
('INS-FND-001', 'أكرم', 'المحاضر', 'male')
ON CONFLICT (national_id) DO NOTHING;

INSERT INTO core.staff (user_id, person_id, position_title, rank_title)
SELECT u.id, p.id, 'محاضر', 'رائد'
FROM auth.users u
JOIN core.people p ON p.national_id = 'INS-ADV-001'
WHERE u.username = 'instructor_adv'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO core.staff (user_id, person_id, position_title, rank_title)
SELECT u.id, p.id, 'محاضر', 'نقيب'
FROM auth.users u
JOIN core.people p ON p.national_id = 'INS-FND-001'
WHERE u.username = 'instructor_fnd'
ON CONFLICT (user_id) DO NOTHING;

-- Assign rank_id to staff based on rank_title
UPDATE core.staff s
SET rank_id = r.id
FROM core.ranks r
WHERE s.rank_title = r.name
  AND (s.rank_id IS NULL);

-- Optional: ensure admin staff has a rank (if exists)
UPDATE core.staff s
SET rank_id = r.id, rank_title = r.name
FROM core.ranks r, auth.users u
WHERE u.id = s.user_id
  AND u.username = 'admin1'
  AND r.name = 'عقيد ركن';

-- Rank -> default role policies
INSERT INTO core.rank_role_policies (rank_id, role_id)
SELECT r.id, rl.id
FROM core.ranks r
JOIN auth.roles rl
  ON (r.name = 'عقيد ركن' AND rl.name = 'admin')
  OR (r.name IN ('رائد', 'نقيب') AND rl.name = 'instructor')
  OR (r.name = 'رقيب' AND rl.name = 'uploader')
ON CONFLICT DO NOTHING;

-- =========================
-- Academic terms
-- =========================
INSERT INTO academics.terms (name, start_date, end_date)
VALUES
('الدورة التقدمية 61 - 2025', '2025-09-01', '2026-06-30'),
('الدورة التأسيسية 62 - 2025', '2025-09-01', '2026-06-30')
ON CONFLICT (name) DO NOTHING;

-- Courses (advanced)
INSERT INTO academics.courses (code, title, credit_hours)
VALUES
('ADV-AR', 'اللغة العربية', 3),
('ADV-EN', 'اللغة الإنجليزية', 3),
('ADV-CUL', 'الثقافة', 2),
('ADV-MATH', 'الرياضيات', 3),
('ADV-PHY', 'الفيزياء', 3)
ON CONFLICT (code) DO NOTHING;

-- Courses (foundational)
INSERT INTO academics.courses (code, title, credit_hours)
VALUES
('FND-WEP', 'مهارة الأسلحة', 3),
('FND-COM', 'مهارة استخدام أجهزة الاتصالات', 3),
('FND-MED', 'الإسعافات الأولية', 2),
('FND-FORT', 'تحصينات الميدان', 3),
('FND-SPEAK', 'مهارة الإلقاء', 2)
ON CONFLICT (code) DO NOTHING;

-- Sections for advanced cohort
WITH instructor AS (
  SELECT s.id
  FROM core.staff s
  JOIN auth.users u ON u.id = s.user_id
  WHERE u.username = 'instructor_adv'
)
INSERT INTO academics.course_sections (course_id, term_id, section_code, capacity, instructor_staff_id)
SELECT c.id, t.id, 'A', 200, (SELECT id FROM instructor)
FROM academics.courses c
JOIN academics.terms t ON t.name = 'الدورة التقدمية 61 - 2025'
WHERE c.code IN ('ADV-AR','ADV-EN','ADV-CUL','ADV-MATH','ADV-PHY')
ON CONFLICT (course_id, term_id, section_code) DO NOTHING;

-- Sections for foundational cohort
WITH instructor AS (
  SELECT s.id
  FROM core.staff s
  JOIN auth.users u ON u.id = s.user_id
  WHERE u.username = 'instructor_fnd'
)
INSERT INTO academics.course_sections (course_id, term_id, section_code, capacity, instructor_staff_id)
SELECT c.id, t.id, 'A', 200, (SELECT id FROM instructor)
FROM academics.courses c
JOIN academics.terms t ON t.name = 'الدورة التأسيسية 62 - 2025'
WHERE c.code IN ('FND-WEP','FND-COM','FND-MED','FND-FORT','FND-SPEAK')
ON CONFLICT (course_id, term_id, section_code) DO NOTHING;

-- Enroll candidates by cohort into their term courses
INSERT INTO academics.enrollments (candidate_id, section_id)
SELECT cand.id, sec.id
FROM core.candidates cand
JOIN core.cohorts coh ON coh.id = cand.cohort_id
JOIN academics.terms t
  ON (coh.cohort_no = 61 AND t.name = 'الدورة التقدمية 61 - 2025')
  OR (coh.cohort_no = 62 AND t.name = 'الدورة التأسيسية 62 - 2025')
JOIN academics.course_sections sec ON sec.term_id = t.id
ON CONFLICT DO NOTHING;

-- Assessments (one per section)
INSERT INTO academics.assessments (section_id, name, weight, max_score, due_date)
SELECT s.id, 'الاختبار النهائي', 100, 100, t.end_date
FROM academics.course_sections s
JOIN academics.terms t ON t.id = s.term_id
WHERE NOT EXISTS (
  SELECT 1 FROM academics.assessments a
  WHERE a.section_id = s.id AND a.name = 'الاختبار النهائي'
);

-- Grades for all enrollments
INSERT INTO academics.grades (assessment_id, candidate_id, score)
SELECT a.id, e.candidate_id, round((60 + random() * 40)::numeric, 2)
FROM academics.assessments a
JOIN academics.enrollments e ON e.section_id = a.section_id
WHERE a.name = 'الاختبار النهائي'
ON CONFLICT (assessment_id, candidate_id) DO NOTHING;

-- =========================
-- Attendance sample (2 sessions per section)
-- =========================
WITH sessions AS (
  INSERT INTO academics.attendance_sessions (section_id, session_at, topic)
  SELECT s.id, now() - interval '3 days', 'محاضرة ميدانية'
  FROM academics.course_sections s
  UNION ALL
  SELECT s.id, now() - interval '1 day', 'محاضرة نظرية'
  FROM academics.course_sections s
  RETURNING id, section_id
)
INSERT INTO academics.attendance (attendance_session_id, candidate_id, present)
SELECT sess.id, e.candidate_id, (random() > 0.1)
FROM sessions sess
JOIN academics.enrollments e ON e.section_id = sess.section_id
ON CONFLICT DO NOTHING;

-- =========================
-- Medical sample
-- =========================
INSERT INTO medical.exam_types (code, name)
VALUES
('BLOOD', 'فحص دم'),
('XRAY', 'أشعة')
ON CONFLICT (code) DO NOTHING;

WITH picked AS (
  SELECT id
  FROM core.candidates
  ORDER BY random()
  LIMIT 20
)
INSERT INTO medical.exams (candidate_id, exam_type_id, scheduled_at, status)
SELECT p.id, t.id, now() + interval '2 days', 'scheduled'
FROM picked p
CROSS JOIN medical.exam_types t
WHERE t.code = 'BLOOD'
ON CONFLICT DO NOTHING;

INSERT INTO medical.exam_results (exam_id, summary, fit_status)
SELECT e.id, 'سليم', 'fit'
FROM medical.exams e
WHERE e.status = 'scheduled'
ON CONFLICT DO NOTHING;

-- =========================
-- Announcements
-- =========================
INSERT INTO comms.announcements (title, body, status, published_at)
VALUES
('تنبيه تدريبي', 'يرجى الالتزام بجدول التدريب الميداني هذا الأسبوع.', 'published', now()),
('إعلان إداري', 'تم تحديث تعليمات الزي العسكري للدورة الحالية.', 'published', now())
ON CONFLICT DO NOTHING;

-- =========================
-- Sample requests
-- =========================
INSERT INTO core.requests (candidate_id, request_type, title, body, status, created_by)
SELECT c.id, 'leave', 'طلب إجازة قصيرة', 'أرغب في الحصول على إجازة لمدة يومين.', 'submitted', c.user_id
FROM core.candidates c
ORDER BY random()
LIMIT 5
ON CONFLICT DO NOTHING;
