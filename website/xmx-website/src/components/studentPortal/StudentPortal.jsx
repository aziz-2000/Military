import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./StudentPortal.css";
import logo from "../../assets/logo.JPG";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const STORAGE_TOKEN_KEY = "xmx_portal_token";
const STORAGE_ROLES_KEY = "xmx_portal_roles";

const emptyOverview = {
  profile: null,
  grades: [],
  courses: [],
  advisor: null,
  requests: [],
  notifications: [],
  attendanceSummary: null,
  attendance: [],
  medical: [],
  announcements: [],
};

const statusLabels = {
  submitted: "قيد المراجعة",
  in_review: "قيد المراجعة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  cancelled: "ملغي",
};

const statusClasses = {
  submitted: "pending",
  in_review: "pending",
  approved: "completed",
  rejected: "completed",
  cancelled: "completed",
};

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ar-OM");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ar-OM");
}

function formatValue(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return value;
}

function formatMeasurement(value, unit) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return `${value} ${unit}`;
}

async function apiRequest(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || "حدث خطأ غير متوقع. يرجى المحاولة لاحقاً."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

export default function StudentPortal() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [userRoles, setUserRoles] = useState([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(emptyOverview);
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
    const storedRoles = localStorage.getItem(STORAGE_ROLES_KEY);
    if (storedToken) {
      setAuthToken(storedToken);
      setIsLoggedIn(true);
    }
    if (storedRoles) {
      try {
        setUserRoles(JSON.parse(storedRoles));
      } catch {
        localStorage.removeItem(STORAGE_ROLES_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (!authToken) return;
    if (userRoles.length === 0) {
      loadUserProfile();
      return;
    }
    if (userRoles.includes("candidate")) {
      loadOverview();
    }
  }, [authToken, userRoles]);

  useEffect(() => {
    if (!isLoggedIn || userRoles.length === 0) return;
    if (userRoles.includes("candidate")) return;
    const redirectPath = getRedirectPathForRoles(userRoles);
    if (redirectPath) {
      navigate(redirectPath, { replace: true });
    }
  }, [isLoggedIn, userRoles, navigate]);

  const rolesLabel = useMemo(() => userRoles.join(", "), [userRoles]);

  const loadUserProfile = async () => {
    try {
      const data = await apiRequest("/auth/me", { token: authToken });
      const roles = data?.user?.roles || [];
      setUserRoles(roles);
      localStorage.setItem(STORAGE_ROLES_KEY, JSON.stringify(roles));
    } catch (loadError) {
      if (loadError.status === 401) {
        handleLogout();
      }
    }
  };

  const loadOverview = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/portal/overview", { token: authToken });
      setOverview({ ...emptyOverview, ...data });
    } catch (loadError) {
      if (loadError.status === 401) {
        handleLogout();
      }
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: { identifier: email, password },
      });

      setAuthToken(data.token);
      localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
      setUserRoles(data.user?.roles || []);
      localStorage.setItem(
        STORAGE_ROLES_KEY,
        JSON.stringify(data.user?.roles || [])
      );
      setIsLoggedIn(true);
      setEmail("");
      setPassword("");
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_ROLES_KEY);
    setIsLoggedIn(false);
    setAuthToken("");
    setUserRoles([]);
    setEmail("");
    setPassword("");
    setOverview(emptyOverview);
  };

  const handleSubmitRequest = async (payload) => {
    setRequestSubmitting(true);
    setError("");

    try {
      await apiRequest("/requests", {
        method: "POST",
        token: authToken,
        body: payload,
      });
      await loadOverview();
      return { ok: true };
    } catch (submitError) {
      if (submitError.status === 401) {
        handleLogout();
      }
      return { ok: false, error: submitError.message };
    } finally {
      setRequestSubmitting(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <LoginPage
        onLogin={handleLogin}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        error={error}
        isLoading={loading}
      />
    );
  }

  if (userRoles.length > 0 && !userRoles.includes("candidate")) {
    return (
      <div className="portal-container">
        <header className="portal-header">
          <div className="header-content">
            <h1>بوابة الضابط المرشح</h1>
            <button onClick={handleLogout} className="logout-btn">
              تسجيل الخروج
            </button>
          </div>
        </header>
        <div className="portal-layout">
          <main className="portal-content">
            <div className="content-section">
              <h2>غير مخول للوصول</h2>
              <p>هذا الحساب ليس مرشحاً. سيتم تحويلك إلى البوابة المناسبة.</p>
              <p>
                <strong>الأدوار:</strong> {rolesLabel || "غير محدد"}
              </p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <PortalDashboard
      onLogout={handleLogout}
      overview={overview}
      onSubmitRequest={handleSubmitRequest}
      isLoading={loading}
      error={error}
      isSubmitting={requestSubmitting}
    />
  );
}

function LoginPage({
  onLogin,
  email,
  setEmail,
  password,
  setPassword,
  error,
  isLoading,
}) {
  return (
    <div className="login-container">
      <div className="login-wrapper">
        <div className="login-image-section">
          <img src={logo} alt="Military College" className="login-image" />
          <div className="image-overlay">
            <h1>كلية السلطان قابوس العسكرية</h1>
            <p>بوابة الضباط المرشحين</p>
          </div>
        </div>

        <div className="login-form-section">
          <div className="login-card">
            <h2>تسجيل الدخول</h2>
            <p className="login-subtitle">أدخل بيانات دخولك</p>

            <form onSubmit={onLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="email">البريد الإلكتروني</label>
                <input
                  type="text"
                  id="email"
                  placeholder="example@gmail.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">كلمة المرور</label>
                <input
                  type="password"
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button type="submit" className="login-btn" disabled={isLoading}>
                {isLoading ? "جاري الدخول..." : "دخول"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalDashboard({
  onLogout,
  overview,
  onSubmitRequest,
  isLoading,
  error,
  isSubmitting,
}) {
  const [activeSection, setActiveSection] = useState("home");

  const menuItems = [
    { id: "home", label: "الرئيسية", icon: "🏠" },
    { id: "announcements", label: "الإعلانات", icon: "📢" },
    { id: "personal", label: "البيانات الشخصية", icon: "👤" },
    { id: "grades", label: "الدرجات والنتائج", icon: "📊" },
    { id: "courses", label: "المواد والجدول", icon: "📚" },
    { id: "attendance", label: "الحضور والغياب", icon: "🧾" },
    { id: "medical", label: "الملف الطبي", icon: "🩺" },
    { id: "advisor", label: "المرشد الأكاديمي", icon: "👨‍🏫" },
    { id: "reports", label: "التقارير", icon: "📄" },
    { id: "complaints", label: "البلاغات والطلبات", icon: "📝" },
    { id: "moodle", label: "نظام التعليم الإلكتروني", icon: "🎓" },
  ];

  return (
    <div className="portal-container">
      <header className="portal-header">
        <div className="header-content">
          <h1>بوابة الضابط المرشح</h1>
          <button onClick={onLogout} className="logout-btn">
            تسجيل الخروج
          </button>
        </div>
      </header>

      <div className="portal-layout">
        <aside className="portal-sidebar">
          <nav className="portal-nav">
            {menuItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${
                  activeSection === item.id ? "active" : ""
                }`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="portal-content">
          {error && <div className="error-message">{error}</div>}
          {isLoading ? (
            <div className="content-section">
              <p>جاري تحميل البيانات...</p>
            </div>
          ) : (
            <>
              {activeSection === "home" && (
                <HomeSection notifications={overview.notifications} />
              )}
              {activeSection === "announcements" && (
                <AnnouncementsSection announcements={overview.announcements} />
              )}
              {activeSection === "personal" && (
                <PersonalDataSection profile={overview.profile} />
              )}
              {activeSection === "grades" && (
                <GradesSection grades={overview.grades} />
              )}
              {activeSection === "courses" && (
                <CoursesSection courses={overview.courses} />
              )}
              {activeSection === "attendance" && (
                <AttendanceSection
                  attendanceSummary={overview.attendanceSummary}
                  attendance={overview.attendance}
                />
              )}
              {activeSection === "medical" && (
                <MedicalSection medical={overview.medical} />
              )}
              {activeSection === "advisor" && (
                <AdvisorSection advisor={overview.advisor} />
              )}
              {activeSection === "reports" && <ReportsSection />}
              {activeSection === "complaints" && (
                <ComplaintsSection
                  requests={overview.requests}
                  onSubmit={onSubmitRequest}
                  isSubmitting={isSubmitting}
                />
              )}
              {activeSection === "moodle" && <MoodleSection />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function HomeSection({ notifications }) {
  return (
    <div className="content-section">
      <h2>أهلا وسهلا في البوابة الأكاديمية</h2>
      <div className="info-cards">
        <div className="info-card">
          <h3>📊 الدرجات</h3>
          <p>اطلع على درجاتك والنتائج الأكاديمية</p>
        </div>
        <div className="info-card">
          <h3>📚 المواد</h3>
          <p>عرض المواد المسجلة والجدول الدراسي</p>
        </div>
        <div className="info-card">
          <h3>👤 بياناتك</h3>
          <p>عرض معلوماتك الشخصية</p>
        </div>
        <div className="info-card">
          <h3>📝 الطلبات</h3>
          <p>تقديم الطلبات والبلاغات والمتابعة عليها</p>
        </div>
      </div>

      {notifications && notifications.length > 0 && (
        <div className="mt-40">
          <h3>آخر الإشعارات</h3>
          <div className="requests-history">
            {notifications.slice(0, 3).map((note) => (
              <div key={note.id} className="request-item">
                <p>
                  <strong>{note.title}</strong>
                </p>
                <p>{note.body}</p>
                <p>
                  <strong>التاريخ:</strong> {formatDate(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementsSection({ announcements }) {
  if (!announcements || announcements.length === 0) {
    return (
      <div className="content-section">
        <h2>الإعلانات</h2>
        <p>لا توجد إعلانات حالياً.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>الإعلانات</h2>
      <div className="requests-history">
        {announcements.map((announcement) => (
          <div key={announcement.id} className="request-item">
            <p>
              <strong>{announcement.title}</strong>
            </p>
            <p>{announcement.body}</p>
            <p>
              <strong>التاريخ:</strong>{" "}
              {formatDate(announcement.publishedAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonalDataSection({ profile }) {
  if (!profile) {
    return (
      <div className="content-section">
        <p>لا توجد بيانات شخصية لعرضها حالياً.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>عرض البيانات الشخصية</h2>
      <div className="form-section">
        <div className="form-group">
          <label>رقم الدورة</label>
          <input type="text" value={formatValue(profile.cohortNo)} disabled />
        </div>
        <div className="form-group">
          <label>اسم الدورة</label>
          <input type="text" value={formatValue(profile.cohortName)} disabled />
        </div>
        <div className="form-group">
          <label>نوع الدورة</label>
          <input type="text" value={formatValue(profile.cohortTrack)} disabled />
        </div>
        <div className="form-group">
          <label>الفصيل</label>
          <input type="text" value={formatValue(profile.platoonName)} disabled />
        </div>
        <div className="form-group">
          <label>الاسم الكامل</label>
          <input type="text" value={formatValue(profile.fullName)} disabled />
        </div>
        <div className="form-group">
          <label>رقم الهوية</label>
          <input type="text" value={formatValue(profile.nationalId)} disabled />
        </div>
        <div className="form-group">
          <label>الخلفية</label>
          <input type="text" value={formatValue(profile.background)} disabled />
        </div>
        <div className="form-group">
          <label>الرقم العسكري</label>
          <input type="text" value={formatValue(profile.militaryNo)} disabled />
        </div>
        <div className="form-group">
          <label>الرقم الرياضي</label>
          <input type="text" value={formatValue(profile.sportsNo)} disabled />
        </div>
        <div className="form-group">
          <label>العمر</label>
          <input type="text" value={formatValue(profile.age)} disabled />
        </div>
        <div className="form-group">
          <label>الطول</label>
          <input
            type="text"
            value={formatMeasurement(profile.heightCm, "سم")}
            disabled
          />
        </div>
        <div className="form-group">
          <label>الوزن</label>
          <input
            type="text"
            value={formatMeasurement(profile.weightKg, "كجم")}
            disabled
          />
        </div>
        <div className="form-group">
          <label>البريد الإلكتروني</label>
          <input type="email" value={formatValue(profile.email)} disabled />
        </div>
        <div className="form-group">
          <label>رقم الهاتف</label>
          <input type="tel" value={formatValue(profile.phone)} disabled />
        </div>
        <div className="form-group">
          <label>العنوان</label>
          <textarea value={formatValue(profile.address)} disabled />
        </div>
        <div className="form-group">
          <label>رقم المرشح</label>
          <input type="text" value={formatValue(profile.candidateNo)} disabled />
        </div>
        <div className="form-group">
          <label>الحالة</label>
          <input type="text" value={formatValue(profile.status)} disabled />
        </div>
        <div className="form-group">
          <label>سنة الدفعة</label>
          <input type="text" value={formatValue(profile.intakeYear)} disabled />
        </div>
      </div>
    </div>
  );
}

function GradesSection({ grades }) {
  if (!grades || grades.length === 0) {
    return (
      <div className="content-section">
        <h2>الاطلاع على الدرجات ونتائج الاختبارات</h2>
        <p>لا توجد درجات مسجلة حتى الآن.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>الاطلاع على الدرجات ونتائج الاختبارات</h2>
      <div className="grades-table">
        <table>
          <thead>
            <tr>
              <th>المادة</th>
              <th>الدرجة</th>
              <th>النسبة</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((item) => {
              const subject = item.assessmentName
                ? `${item.courseTitle} (${item.assessmentName})`
                : item.courseTitle;
              return (
                <tr key={`${item.courseCode}-${item.assessmentName}`}>
                  <td>{subject}</td>
                  <td>{formatValue(item.score)}</td>
                  <td>
                    {item.percentage !== null && item.percentage !== undefined
                      ? `${item.percentage}%`
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoursesSection({ courses }) {
  if (!courses || courses.length === 0) {
    return (
      <div className="content-section">
        <h2>المواد المسجلة والجدول الدراسي</h2>
        <p>لا توجد مواد مسجلة حتى الآن.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>المواد المسجلة والجدول الدراسي</h2>
      <div className="courses-grid">
        {courses.map((course) => (
          <div key={course.sectionId} className="course-card">
            <h3>{course.courseTitle}</h3>
            <p>
              <strong>الكود:</strong> {formatValue(course.courseCode)}
            </p>
            <p>
              <strong>الشعبة:</strong> {formatValue(course.sectionCode)}
            </p>
            <p>
              <strong>المحاضر:</strong>{" "}
              {formatValue(course.instructorName, "غير محدد")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceSection({ attendanceSummary, attendance }) {
  const total = attendanceSummary?.totalSessions ?? 0;
  const present = attendanceSummary?.presentSessions ?? 0;
  const absent = attendanceSummary?.absentSessions ?? 0;

  return (
    <div className="content-section">
      <h2>الحضور والغياب</h2>
      <div className="info-cards">
        <div className="info-card">
          <h3>📌 إجمالي الحصص</h3>
          <p>{total}</p>
        </div>
        <div className="info-card">
          <h3>✅ الحضور</h3>
          <p>{present}</p>
        </div>
        <div className="info-card">
          <h3>❌ الغياب</h3>
          <p>{absent}</p>
        </div>
      </div>

      <div className="mt-40">
        <h3>آخر الجلسات</h3>
        {attendance && attendance.length > 0 ? (
          <div className="grades-table">
            <table>
              <thead>
                <tr>
                  <th>المادة</th>
                  <th>التاريخ</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((row, index) => (
                  <tr
                    key={`${row.courseCode}-${row.sessionAt}-${index}`}
                  >
                    <td>{row.courseTitle}</td>
                    <td>{formatDateTime(row.sessionAt)}</td>
                    <td>{row.present ? "حاضر" : "غائب"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>لا توجد بيانات حضور حتى الآن.</p>
        )}
      </div>
    </div>
  );
}

function MedicalSection({ medical }) {
  if (!medical || medical.length === 0) {
    return (
      <div className="content-section">
        <h2>الملف الطبي</h2>
        <p>لا توجد بيانات طبية حالياً.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>الملف الطبي</h2>
      <div className="requests-history">
        {medical.map((item) => (
          <div key={item.id} className="request-item">
            <p>
              <strong>{item.examName}</strong>
            </p>
            <p>
              <strong>الحالة:</strong> {formatValue(item.status)}
            </p>
            <p>
              <strong>موعد الفحص:</strong> {formatDateTime(item.scheduledAt)}
            </p>
            <p>
              <strong>تاريخ التنفيذ:</strong> {formatDateTime(item.performedAt)}
            </p>
            <p>
              <strong>النتيجة:</strong> {formatValue(item.fitStatus, "غير متوفر")}
            </p>
            {item.summary && (
              <p>
                <strong>ملخص:</strong> {item.summary}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvisorSection({ advisor }) {
  if (!advisor) {
    return (
      <div className="content-section">
        <h2>المرشد الأكاديمي</h2>
        <p>لم يتم تعيين مرشد أكاديمي حتى الآن.</p>
      </div>
    );
  }

  return (
    <div className="content-section">
      <h2>معلومات المرشد الأكاديمي والتواصل معه</h2>
      <div className="advisor-card">
        <div className="advisor-info">
          <h3>{advisor.name}</h3>
          <p>
            <strong>القسم:</strong> {formatValue(advisor.department)}
          </p>
          <p>
            <strong>المنصب:</strong> {formatValue(advisor.positionTitle)}
          </p>
          <p>
            <strong>الرتبة:</strong> {formatValue(advisor.rankTitle)}
          </p>
        </div>
        <button className="contact-btn">إرسال رسالة</button>
      </div>
    </div>
  );
}

function ReportsSection() {
  return (
    <div className="content-section">
      <h2>تقارير الفصول الدراسية</h2>
      <div className="reports-list">
        <div className="report-item">
          <h3>📋 تقرير الفصل الأول 2025</h3>
          <p>تاريخ التقرير: 20 ديسمبر 2024</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
        <div className="report-item">
          <h3>📋 تقرير الفصل الثاني 2024</h3>
          <p>تاريخ التقرير: 25 مايو 2024</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
        <div className="report-item">
          <h3>📋 تقرير الفصل الأول 2024</h3>
          <p>تاريخ التقرير: 22 ديسمبر 2023</p>
          <button className="download-btn">تحميل التقرير</button>
        </div>
      </div>
    </div>
  );
}

function ComplaintsSection({ requests, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    requestType: "",
    title: "",
    body: "",
  });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const handleChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!form.requestType || !form.title) {
      setFormError("يرجى إدخال نوع الطلب والعنوان.");
      return;
    }

    const result = await onSubmit({
      requestType: form.requestType,
      title: form.title,
      body: form.body,
    });

    if (result.ok) {
      setFormSuccess("تم إرسال الطلب بنجاح.");
      setForm({ requestType: "", title: "", body: "" });
      return;
    }

    setFormError(result.error || "تعذر إرسال الطلب.");
  };

  return (
    <div className="content-section">
      <h2>رفع البلاغات والطلبات والمتابعة عليها</h2>
      <form className="complaints-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>نوع الطلب</label>
          <select value={form.requestType} onChange={handleChange("requestType")}>
            <option value="">اختر نوع الطلب</option>
            <option value="complaint">شكوى</option>
            <option value="admin_service">طلب معاملة إدارية</option>
            <option value="leave">طلب إجازة</option>
            <option value="grade_review">طلب تعديل درجة</option>
          </select>
        </div>
        <div className="form-group">
          <label>الموضوع</label>
          <input
            type="text"
            placeholder="أدخل موضوع الطلب"
            value={form.title}
            onChange={handleChange("title")}
          />
        </div>
        <div className="form-group">
          <label>التفاصيل</label>
          <textarea
            placeholder="اشرح تفاصيل طلبك..."
            value={form.body}
            onChange={handleChange("body")}
          />
        </div>
        {formError && <div className="error-message">{formError}</div>}
        {formSuccess && <div className="success-message">{formSuccess}</div>}
        <button className="submit-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "جارٍ الإرسال..." : "إرسال الطلب"}
        </button>
      </form>

      <h3 className="mt-40">الطلبات السابقة</h3>
      <div className="requests-history">
        {requests && requests.length > 0 ? (
          requests.map((request) => (
            <div key={request.id} className="request-item">
              <p>
                <strong>الموضوع:</strong> {request.title}
              </p>
              <p>
                <strong>الحالة:</strong>{" "}
                <span
                  className={`status ${
                    statusClasses[request.status] || "pending"
                  }`}
                >
                  {statusLabels[request.status] || request.status}
                </span>
              </p>
              <p>
                <strong>التاريخ:</strong> {formatDate(request.submittedAt)}
              </p>
            </div>
          ))
        ) : (
          <p>لا توجد طلبات سابقة.</p>
        )}
      </div>
    </div>
  );
}

function MoodleSection() {
  return (
    <div className="content-section">
      <h2>الوصول إلى نظام التعليم الإلكتروني (Moodle)</h2>
      <div className="moodle-section">
        <div className="moodle-info">
          <h3>منصة التعليم الإلكتروني</h3>
          <p>
            يمكنك الوصول إلى المحاضرات والمواد الدراسية والاختبارات الإلكترونية
            من خلال نظام Moodle
          </p>
          <div className="moodle-details">
            <p>
              <strong>الرابط:</strong> https://moodle.college.edu.sa
            </p>
            <p>
              <strong>اسم المستخدم:</strong> madhhar@college.edu.sa
            </p>
            <p>
              <strong>كلمة المرور:</strong> نفس كلمة مرور البوابة
            </p>
          </div>
        </div>
        <a
          href="https://moodle.college.edu"
          target="_blank"
          rel="noopener noreferrer"
          className="moodle-btn"
        >
          الذهاب إلى Moodle
        </a>
      </div>
    </div>
  );
}

function getRedirectPathForRoles(roles) {
  if (roles.includes("admin")) return "/admin-portal";
  if (roles.includes("instructor")) return "/instructor-portal";
  if (roles.includes("uploader")) return "/upload-portal";
  return null;
}
