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
  } catch (error) {
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

function sanitizeFilename(filename) {
  const base = normalizeString(filename) || "file";
  return base.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function ensureUploadsDir() {
  await fs.mkdir(uploadsDir, { recursive: true });
}

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("select 1 as ok");
    return res.json({ ok: true, db: result.rows[0]?.ok === 1 });
  } catch (error) {
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
      normalizeString(candidateNo)?.toLowerCase().replace(/[^a-z0-9_\-]/g, "_");
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
          t.name as term_name
        from academics.course_sections cs
        join academics.courses c on c.id = cs.course_id
        join academics.terms t on t.id = cs.term_id
        join academics.enrollments e on e.section_id = cs.id
        join core.candidates cand on cand.id = e.candidate_id
        left join core.cohorts coh on coh.id = cand.cohort_id
        left join core.platoons pl on pl.id = cand.platoon_id
        ${whereClause}
        order by t.start_date desc, c.code, cs.section_code
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
      ]);

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
      });
    } catch (error) {
      console.error("Leadership overview error:", error);
      return res.status(500).json({ message: "تعذر تحميل لوحة القيادة." });
    }
  }
);

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
  "/api/admin/security/overview",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    try {
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
  "/api/upload/files",
  requireAuth,
  requireRole(["uploader", "admin"]),
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
  requireRole(["uploader", "admin"]),
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
  requireRole(["uploader", "admin"]),
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

app.put(
  "/api/instructor/requests/:id/status",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const staffId = await getInstructorStaffId(req.user.userId);
      if (!staffId) {
        return res.status(404).json({ message: "لا يوجد ملف محاضر مرتبط بالحساب." });
      }

      const requestId = req.params.id;
      const status = normalizeString(req.body?.status);
      const note = normalizeString(req.body?.note);
      if (!status) {
        return res.status(400).json({ message: "يرجى تحديد حالة الطلب." });
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
        `
        update core.requests
        set status = $1
        where id = $2
        `,
        [status, requestId]
      );

      await client.query(
        `
        insert into core.request_actions (request_id, action, note, acted_by)
        values ($1, $2, $3, $4)
        `,
        [requestId, `status_${status}`, note, req.user.userId]
      );
      await client.query("commit");

      return res.json({ updated: true });
    } catch (error) {
      await client.query("rollback");
      console.error("Instructor request status error:", error);
      return res.status(500).json({ message: "تعذر تحديث حالة الطلب." });
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
      const { candidateId, body, topic } = req.body || {};
      if (!candidateId || !normalizeString(body)) {
        return res.status(400).json({ message: "يرجى اختيار الطالب وكتابة الرسالة." });
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
  "/api/instructor/overview",
  requireAuth,
  requireRole(["instructor"]),
  async (req, res) => {
    try {
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
  try {
    const userId = req.user.userId;
    const { requestType, title, body } = req.body || {};

    if (!requestType || !title) {
      return res.status(400).json({
        message: "يرجى إدخال نوع الطلب والعنوان.",
      });
    }

    const candidateResult = await pool.query(
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

    const insertResult = await pool.query(
      `
      insert into core.requests (candidate_id, request_type, title, body, created_by)
      values ($1, $2, $3, $4, $5)
      returning id, request_type, title, body, status, submitted_at
      `,
      [candidateId, requestType, title, body || null, userId]
    );

    const request = insertResult.rows[0];

    return res.status(201).json({
      request: {
        id: request.id,
        requestType: request.request_type,
        title: request.title,
        body: request.body,
        status: request.status,
        submittedAt: request.submitted_at,
      },
    });
  } catch (error) {
    console.error("Create request error:", error);
    return res.status(500).json({ message: "تعذر حفظ الطلب." });
  }
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
