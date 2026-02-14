import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./InstructorPortal.css";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const STORAGE_TOKEN_KEY = "xmx_portal_token";
const STORAGE_ROLES_KEY = "xmx_portal_roles";

const emptyState = {
  profile: null,
  summary: null,
  courses: [],
  students: [],
  grades: [],
  requests: [],
  messages: [],
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

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "0";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "0";
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
    const error = new Error(data.message || "Unexpected error.");
    error.status = response.status;
    throw error;
  }

  return data;
}

export default function InstructorPortal() {
  const navigate = useNavigate();
  const [data, setData] = useState(emptyState);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gradeState, setGradeState] = useState({
    sections: [],
    assessments: [],
    sectionId: "",
    assessmentId: "",
    rows: [],
    edits: {},
    loading: false,
    error: "",
    message: "",
  });
  const [messageForm, setMessageForm] = useState({
    candidateId: "",
    topic: "",
    body: "",
    history: [],
    loading: false,
    loadingHistory: false,
    error: "",
    message: "",
  });
  const [requestState, setRequestState] = useState({
    rows: [],
    actions: [],
    total: 0,
    requestId: "",
    search: "",
    filterStatus: "",
    filterType: "",
    status: "in_review",
    note: "",
    comment: "",
    loading: false,
    error: "",
    message: "",
  });
  const [attendanceState, setAttendanceState] = useState({
    summary: { total: 0, present: 0, absent: 0 },
    sections: [],
    roster: [],
    sectionId: "",
    from: "",
    to: "",
    entryRows: [],
    sessionAt: "",
    topic: "",
    loading: false,
    error: "",
    message: "",
  });

  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  const roles = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_ROLES_KEY) || "[]");
    } catch {
      return [];
    }
  }, []);

  const loadOverview = async () => {
    const payload = await apiRequest("/instructor/overview", { token });
    setData({ ...emptyState, ...payload });
  };

  const loadSections = async () => {
    const payload = await apiRequest("/instructor/sections", { token });
    setGradeState((prev) => ({
      ...prev,
      sections: payload.rows || [],
      sectionId: prev.sectionId || payload.rows?.[0]?.id || "",
    }));
    setAttendanceState((prev) => ({
      ...prev,
      sections: payload.rows || [],
      sectionId: prev.sectionId || payload.rows?.[0]?.id || "",
    }));
  };

  const loadWorkflowRequests = async (customFilters = null) => {
    const source = customFilters || requestState;
    setRequestState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = new URLSearchParams();
      if (source.search) query.set("search", source.search);
      if (source.filterStatus) query.set("status", source.filterStatus);
      if (source.filterType) query.set("request_type", source.filterType);
      query.set("limit", "200");
      const payload = await apiRequest(`/instructor/workflow/requests?${query.toString()}`, {
        token,
      });
      setRequestState((prev) => {
        const rows = payload.rows || [];
        const requestId =
          (prev.requestId && rows.some((item) => item.id === prev.requestId)
            ? prev.requestId
            : rows[0]?.id) || "";
        const selected = rows.find((item) => item.id === requestId);
        const mappedStatus =
          selected?.status === "approved"
            ? "approved"
            : selected?.status === "rejected"
              ? "rejected"
              : "in_review";
        return {
          ...prev,
          rows,
          total: Number(payload.total || rows.length),
          requestId,
          status: mappedStatus,
          loading: false,
        };
      });
    } catch (loadError) {
      setRequestState((prev) => ({ ...prev, loading: false, error: loadError.message }));
    }
  };

  const loadRequestActions = async (requestId) => {
    if (!requestId) {
      setRequestState((prev) => ({ ...prev, actions: [] }));
      return;
    }
    const payload = await apiRequest(`/instructor/workflow/requests/${requestId}/actions`, {
      token,
    });
    setRequestState((prev) => ({ ...prev, actions: payload.rows || [] }));
  };

  const loadMessagesHistory = async (candidateId = "") => {
    const query = candidateId ? `?candidate_id=${candidateId}` : "";
    const payload = await apiRequest(`/instructor/messages/list${query}`, { token });
    setMessageForm((prev) => ({
      ...prev,
      history: payload.rows || [],
      loadingHistory: false,
    }));
  };

  const loadAttendanceSummary = async (customState = null) => {
    const source = customState || attendanceState;
    setAttendanceState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = new URLSearchParams();
      if (source.sectionId) query.set("section_id", source.sectionId);
      if (source.from) query.set("from", source.from);
      if (source.to) query.set("to", source.to);
      const payload = await apiRequest(`/instructor/attendance/summary?${query.toString()}`, {
        token,
      });
      setAttendanceState((prev) => ({
        ...prev,
        summary: payload.summary || { total: 0, present: 0, absent: 0 },
        roster: payload.roster || [],
        sections: payload.sections || prev.sections,
        loading: false,
      }));
    } catch (loadError) {
      setAttendanceState((prev) => ({ ...prev, loading: false, error: loadError.message }));
    }
  };

  useEffect(() => {
    if (!token) {
      setError("الرجاء تسجيل الدخول أولاً.");
      setLoading(false);
      return;
    }

    Promise.all([
      loadOverview(),
      loadSections(),
      loadWorkflowRequests(),
      loadMessagesHistory(),
      loadAttendanceSummary(),
    ])
      .then(() => setError(""))
      .catch((loadError) => {
        if (loadError.status === 403) {
          setError("هذا الحساب لا يملك صلاحيات المحاضر.");
        } else {
          setError(loadError.message);
        }
      })
      .finally(() => setLoading(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!gradeState.sectionId) {
      setGradeState((prev) => ({ ...prev, assessments: [], assessmentId: "", rows: [] }));
      return;
    }

    apiRequest(`/instructor/assessments?section_id=${gradeState.sectionId}`, { token })
      .then((payload) => {
        setGradeState((prev) => ({
          ...prev,
          assessments: payload.rows || [],
          assessmentId: prev.assessmentId || payload.rows?.[0]?.id || "",
        }));
      })
      .catch(() => {
        setGradeState((prev) => ({ ...prev, assessments: [], assessmentId: "", rows: [] }));
      });
  }, [gradeState.sectionId, token]);

  useEffect(() => {
    if (!gradeState.sectionId || !gradeState.assessmentId) {
      setGradeState((prev) => ({ ...prev, rows: [], edits: {} }));
      return;
    }

    setGradeState((prev) => ({ ...prev, loading: true, error: "" }));
    apiRequest(
      `/instructor/grades?section_id=${gradeState.sectionId}&assessment_id=${gradeState.assessmentId}`,
      { token }
    )
      .then((payload) => {
        setGradeState((prev) => ({
          ...prev,
          rows: payload.rows || [],
          loading: false,
          edits: {},
        }));
      })
      .catch((fetchError) => {
        setGradeState((prev) => ({
          ...prev,
          loading: false,
          error: fetchError.message,
        }));
      });
  }, [gradeState.sectionId, gradeState.assessmentId, token]);

  useEffect(() => {
    if (!requestState.requestId || !token) {
      setRequestState((prev) => ({ ...prev, actions: [] }));
      return;
    }
    loadRequestActions(requestState.requestId).catch((loadError) => {
      setRequestState((prev) => ({ ...prev, error: loadError.message }));
    });
  }, [requestState.requestId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return;
    setMessageForm((prev) => ({ ...prev, loadingHistory: true }));
    loadMessagesHistory(messageForm.candidateId).catch((loadError) => {
      setMessageForm((prev) => ({ ...prev, loadingHistory: false, error: loadError.message }));
    });
  }, [messageForm.candidateId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_ROLES_KEY);
    navigate("/student-portal");
  };

  const handleSaveGrades = async () => {
    setGradeState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const grades = gradeState.rows.map((row) => ({
        candidateId: row.candidate_id,
        score:
          gradeState.edits[row.candidate_id] !== undefined
            ? gradeState.edits[row.candidate_id]
            : row.score,
      }));

      const payload = await apiRequest("/instructor/grades", {
        method: "POST",
        token,
        body: {
          sectionId: gradeState.sectionId,
          assessmentId: gradeState.assessmentId,
          grades,
        },
      });
      setGradeState((prev) => ({
        ...prev,
        loading: false,
        message: `تم حفظ الدرجات. عدد السجلات: ${payload.updated || 0}`,
      }));
      await loadOverview();
    } catch (saveError) {
      setGradeState((prev) => ({
        ...prev,
        loading: false,
        error: saveError.message,
      }));
    }
  };

  const handleUpdateRequestStatus = async (event) => {
    event.preventDefault();
    if (!requestState.requestId) return;
    setRequestState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest(`/instructor/workflow/requests/${requestState.requestId}/status`, {
        method: "PUT",
        token,
        body: {
          status:
            requestState.status === "approve"
              ? "approved"
              : requestState.status === "reject"
                ? "rejected"
                : requestState.status,
          note: requestState.note || null,
        },
      });
      setRequestState((prev) => ({
        ...prev,
        loading: false,
        message: "تم تحديث حالة الطلب.",
        note: "",
      }));
      await Promise.all([
        loadOverview(),
        loadWorkflowRequests(),
        loadRequestActions(requestState.requestId),
      ]);
    } catch (requestError) {
      setRequestState((prev) => ({
        ...prev,
        loading: false,
        error: requestError.message,
      }));
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!messageForm.candidateId || !messageForm.body) return;
    setMessageForm((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest("/instructor/messages", {
        method: "POST",
        token,
        body: {
          candidateId: messageForm.candidateId,
          topic: messageForm.topic || null,
          body: messageForm.body,
        },
      });
      setMessageForm((prev) => ({
        ...prev,
        loading: false,
        message: "تم إرسال الرسالة.",
        topic: "",
        body: "",
      }));
      await Promise.all([loadOverview(), loadMessagesHistory(messageForm.candidateId)]);
    } catch (messageError) {
      setMessageForm((prev) => ({
        ...prev,
        loading: false,
        error: messageError.message,
      }));
    }
  };

  const handleAddRequestComment = async (event) => {
    event.preventDefault();
    if (!requestState.requestId || !requestState.comment.trim()) return;
    setRequestState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest(`/instructor/workflow/requests/${requestState.requestId}/comment`, {
        method: "POST",
        token,
        body: { note: requestState.comment },
      });
      setRequestState((prev) => ({
        ...prev,
        loading: false,
        message: "تمت إضافة التعليق.",
        comment: "",
      }));
      await loadRequestActions(requestState.requestId);
    } catch (commentError) {
      setRequestState((prev) => ({
        ...prev,
        loading: false,
        error: commentError.message,
      }));
    }
  };

  const loadAttendanceEntryRows = async () => {
    if (!attendanceState.sectionId) return;
    setAttendanceState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const payload = await apiRequest(`/instructor/sections/${attendanceState.sectionId}/students`, {
        token,
      });
      setAttendanceState((prev) => ({
        ...prev,
        entryRows: (payload.rows || []).map((row) => ({
          candidateId: row.candidate_id,
          candidateNo: row.candidate_no,
          fullName: `${row.first_name} ${row.last_name}`.trim(),
          present: true,
          note: "",
        })),
        loading: false,
      }));
    } catch (loadError) {
      setAttendanceState((prev) => ({ ...prev, loading: false, error: loadError.message }));
    }
  };

  const handleSaveAttendance = async () => {
    if (!attendanceState.sectionId || attendanceState.entryRows.length === 0) return;
    setAttendanceState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const payload = await apiRequest("/instructor/attendance/records", {
        method: "POST",
        token,
        body: {
          sectionId: attendanceState.sectionId,
          sessionAt: attendanceState.sessionAt || undefined,
          topic: attendanceState.topic || undefined,
          records: attendanceState.entryRows.map((row) => ({
            candidateId: row.candidateId,
            present: row.present,
            note: row.note || null,
          })),
        },
      });
      setAttendanceState((prev) => ({
        ...prev,
        loading: false,
        message: `تم حفظ الحضور. عدد السجلات: ${payload.updated || 0}`,
        entryRows: [],
        sessionAt: "",
        topic: "",
      }));
      await Promise.all([loadOverview(), loadAttendanceSummary()]);
    } catch (saveError) {
      setAttendanceState((prev) => ({ ...prev, loading: false, error: saveError.message }));
    }
  };

  return (
    <div className="instructor-portal">
      <header className="instructor-header">
        <div>
          <h1>بوابة المحاضر</h1>
          <p>متابعة أداء الطلبة وإدارة الدرجات والطلبات والرسائل.</p>
        </div>
        <div className="instructor-actions">
          <span className="instructor-role">الأدوار: {roles.length ? roles.join("، ") : "غير محدد"}</span>
          <button onClick={handleLogout}>تسجيل الخروج</button>
        </div>
      </header>

      <div className="instructor-layout">
        <aside className="instructor-sidebar">
          <nav>
            {[
              { id: "dashboard", label: "لوحة التحكم" },
              { id: "courses", label: "المواد والشعب" },
              { id: "students", label: "الطلبة" },
              { id: "grades", label: "إدخال الدرجات" },
              { id: "attendance", label: "الحضور" },
              { id: "messages", label: "الرسائل" },
              { id: "requests", label: "الطلبات والشكاوى" },
            ].map((item) => (
              <button
                key={item.id}
                className={activeSection === item.id ? "active" : ""}
                onClick={() => setActiveSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="instructor-content">
          {loading && <div className="state">جاري تحميل البيانات...</div>}
          {error && !loading && <div className="state error">{error}</div>}

          {!loading && !error && activeSection === "dashboard" && (
            <>
              <section className="instructor-hero">
                <div>
                  <h2>لوحة متابعة المحاضر</h2>
                  <p>عرض شامل للمواد، الطلبة، الرسائل، والطلبات.</p>
                </div>
                {data.profile && (
                  <div className="instructor-profile">
                    <h3>{data.profile.fullName}</h3>
                    <p>{data.profile.rankTitle || "رتبة غير محددة"}</p>
                    <p>{data.profile.positionTitle || "منصب غير محدد"}</p>
                    <span>{data.profile.department || "قسم غير محدد"}</span>
                  </div>
                )}
              </section>

              <section className="instructor-metrics">
                <MetricCard title="عدد الشعب" value={data.summary?.totalSections || 0} />
                <MetricCard title="عدد الطلبة" value={data.summary?.totalStudents || 0} />
                <MetricCard title="طلبات معلقة" value={data.summary?.pendingRequests || 0} />
                <MetricCard title="متوسط الدرجات" value={data.summary?.averageScore || "-"} />
                <MetricCard title="الحضور المسجل" value={formatNumber(attendanceState.summary.present)} />
                <MetricCard title="الغياب المسجل" value={formatNumber(attendanceState.summary.absent)} />
              </section>
            </>
          )}

          {!loading && !error && activeSection === "courses" && (
            <SectionTable
              title="المواد والشعب"
              columns={["المادة", "الشعبة", "الفصل", "عدد الطلبة"]}
              rows={data.courses.map((course) => [
                `${course.code} - ${course.title}`,
                course.section_code,
                course.term_name,
                course.enrollment_count,
              ])}
            />
          )}

          {!loading && !error && activeSection === "students" && (
            <SectionTable
              title="قائمة الطلبة"
              columns={["رقم المرشح", "الاسم", "الحالة"]}
              rows={data.students.map((student) => [
                student.candidate_no,
                `${student.first_name} ${student.last_name}`,
                student.status,
              ])}
            />
          )}

          {!loading && !error && activeSection === "grades" && (
            <div className="section-table">
              <h2>إدخال الدرجات</h2>
              <div className="instructor-metrics">
                <select
                  className="instructor-select"
                  value={gradeState.sectionId}
                  onChange={(event) =>
                    setGradeState((prev) => ({
                      ...prev,
                      sectionId: event.target.value,
                      assessmentId: "",
                    }))
                  }
                >
                  <option value="">اختر الشعبة</option>
                  {gradeState.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.course_code} - {section.course_title} ({section.section_code})
                    </option>
                  ))}
                </select>
                <select
                  className="instructor-select"
                  value={gradeState.assessmentId}
                  onChange={(event) =>
                    setGradeState((prev) => ({
                      ...prev,
                      assessmentId: event.target.value,
                    }))
                  }
                >
                  <option value="">اختر التقييم</option>
                  {gradeState.assessments.map((assessment) => (
                    <option key={assessment.id} value={assessment.id}>
                      {assessment.name} - Max {assessment.max_score}
                    </option>
                  ))}
                </select>
                <button onClick={handleSaveGrades} disabled={gradeState.loading}>
                  حفظ الدرجات
                </button>
              </div>
              {gradeState.error && <div className="state error">{gradeState.error}</div>}
              {gradeState.message && <div className="state">{gradeState.message}</div>}
              <table>
                <thead>
                  <tr>
                    <th>رقم المرشح</th>
                    <th>الاسم</th>
                    <th>الدرجة</th>
                    <th>الحد الأعلى</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeState.rows.length === 0 && (
                    <tr>
                      <td colSpan="4">لا توجد بيانات.</td>
                    </tr>
                  )}
                  {gradeState.rows.map((row) => (
                    <tr key={row.candidate_id}>
                      <td>{row.candidate_no}</td>
                      <td>
                        {row.first_name} {row.last_name}
                      </td>
                      <td>
                        <input
                          className="instructor-input"
                          type="number"
                          min="0"
                          step="0.01"
                          max={row.max_score}
                          value={
                            gradeState.edits[row.candidate_id] !== undefined
                              ? gradeState.edits[row.candidate_id]
                              : row.score ?? ""
                          }
                          onChange={(event) =>
                            setGradeState((prev) => ({
                              ...prev,
                              edits: {
                                ...prev.edits,
                                [row.candidate_id]: event.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>{row.max_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && activeSection === "attendance" && (
            <div className="section-list">
              <h2>متابعة الحضور للشعب المرتبطة</h2>
              <div className="instructor-metrics">
                <select
                  className="instructor-select"
                  value={attendanceState.sectionId}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, sectionId: event.target.value }))
                  }
                >
                  <option value="">كل الشعب</option>
                  {attendanceState.sections.map((section) => (
                    <option key={`att-sec-${section.id}`} value={section.id}>
                      {section.course_code} - {section.section_code}
                    </option>
                  ))}
                </select>
                <input
                  className="instructor-input"
                  type="date"
                  value={attendanceState.from}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, from: event.target.value }))
                  }
                />
                <input
                  className="instructor-input"
                  type="date"
                  value={attendanceState.to}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, to: event.target.value }))
                  }
                />
                <button onClick={() => loadAttendanceSummary()} disabled={attendanceState.loading}>
                  {attendanceState.loading ? "..." : "تحديث"}
                </button>
              </div>
              {attendanceState.error && <div className="state error">{attendanceState.error}</div>}
              {attendanceState.message && <div className="state">{attendanceState.message}</div>}
              <div className="instructor-metrics">
                <MetricCard title="الإجمالي" value={formatNumber(attendanceState.summary.total)} />
                <MetricCard title="الحضور" value={formatNumber(attendanceState.summary.present)} />
                <MetricCard title="الغياب" value={formatNumber(attendanceState.summary.absent)} />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>رقم المرشح</th>
                    <th>الاسم</th>
                    <th>الحضور</th>
                    <th>الغياب</th>
                    <th>النسبة</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceState.roster.length === 0 ? (
                    <tr><td colSpan={5}>لا توجد بيانات.</td></tr>
                  ) : (
                    attendanceState.roster.map((row) => (
                      <tr key={`att-roster-${row.candidate_id}`}>
                        <td>{row.candidate_no}</td>
                        <td>{row.first_name} {row.last_name}</td>
                        <td>{formatNumber(row.present_sessions)}</td>
                        <td>{formatNumber(row.absent_sessions)}</td>
                        <td>{formatNumber(row.attendance_rate)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <h3>إدخال جلسة حضور</h3>
              <div className="instructor-metrics">
                <select
                  className="instructor-select"
                  value={attendanceState.sectionId}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, sectionId: event.target.value }))
                  }
                >
                  <option value="">اختر الشعبة</option>
                  {attendanceState.sections.map((section) => (
                    <option key={`entry-sec-${section.id}`} value={section.id}>
                      {section.course_code} - {section.section_code}
                    </option>
                  ))}
                </select>
                <input
                  className="instructor-input"
                  type="datetime-local"
                  value={attendanceState.sessionAt}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, sessionAt: event.target.value }))
                  }
                />
                <input
                  className="instructor-input"
                  placeholder="موضوع الجلسة"
                  value={attendanceState.topic}
                  onChange={(event) =>
                    setAttendanceState((prev) => ({ ...prev, topic: event.target.value }))
                  }
                />
                <button onClick={loadAttendanceEntryRows} disabled={!attendanceState.sectionId || attendanceState.loading}>
                  تحميل الكشف
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>رقم المرشح</th>
                    <th>الاسم</th>
                    <th>حاضر</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceState.entryRows.length === 0 ? (
                    <tr><td colSpan={4}>لا توجد بيانات إدخال.</td></tr>
                  ) : (
                    attendanceState.entryRows.map((row) => (
                      <tr key={`att-entry-${row.candidateId}`}>
                        <td>{row.candidateNo}</td>
                        <td>{row.fullName}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(row.present)}
                            onChange={(event) =>
                              setAttendanceState((prev) => ({
                                ...prev,
                                entryRows: prev.entryRows.map((item) =>
                                  item.candidateId === row.candidateId
                                    ? { ...item, present: event.target.checked }
                                    : item
                                ),
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="instructor-input"
                            value={row.note}
                            onChange={(event) =>
                              setAttendanceState((prev) => ({
                                ...prev,
                                entryRows: prev.entryRows.map((item) =>
                                  item.candidateId === row.candidateId
                                    ? { ...item, note: event.target.value }
                                    : item
                                ),
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <button onClick={handleSaveAttendance} disabled={attendanceState.loading || attendanceState.entryRows.length === 0}>
                حفظ جلسة الحضور
              </button>
            </div>
          )}

          {!loading && !error && activeSection === "messages" && (
            <div className="section-list">
              <h2>الرسائل</h2>
              <form className="instructor-form" onSubmit={handleSendMessage}>
                <select
                  className="instructor-select"
                  value={messageForm.candidateId}
                  onChange={(event) =>
                    setMessageForm((prev) => ({ ...prev, candidateId: event.target.value }))
                  }
                  required
                >
                  <option value="">اختر الطالب</option>
                  {data.students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.candidate_no} - {student.first_name} {student.last_name}
                    </option>
                  ))}
                </select>
                <input
                  className="instructor-input"
                  type="text"
                  placeholder="موضوع الرسالة"
                  value={messageForm.topic}
                  onChange={(event) =>
                    setMessageForm((prev) => ({ ...prev, topic: event.target.value }))
                  }
                />
                <textarea
                  className="instructor-input"
                  placeholder="نص الرسالة"
                  value={messageForm.body}
                  onChange={(event) =>
                    setMessageForm((prev) => ({ ...prev, body: event.target.value }))
                  }
                  required
                />
                <button type="submit" disabled={messageForm.loading}>
                  إرسال الرسالة
                </button>
              </form>
              {messageForm.error && <div className="state error">{messageForm.error}</div>}
              {messageForm.message && <div className="state">{messageForm.message}</div>}
              {messageForm.loadingHistory && <div className="state">جاري تحميل المحادثات...</div>}

              {!messageForm.loadingHistory && messageForm.history.length === 0 && <p className="empty">لا توجد بيانات.</p>}
              {messageForm.history.map((msg) => (
                <div key={msg.id} className="list-card">
                  <div>
                    <h4>{msg.sender_username || "مستخدم"}</h4>
                    <p>{msg.body}</p>
                    <small>{msg.candidate_no} - {msg.first_name} {msg.last_name}</small>
                  </div>
                  <span>{formatDateTime(msg.sent_at)}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && activeSection === "requests" && (
            <div className="section-list">
              <h2>الطلبات والشكاوى</h2>
              <div className="instructor-metrics">
                <input
                  className="instructor-input"
                  placeholder="بحث"
                  value={requestState.search}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, search: event.target.value }))
                  }
                />
                <select
                  className="instructor-select"
                  value={requestState.filterStatus}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, filterStatus: event.target.value }))
                  }
                >
                  <option value="">كل الحالات</option>
                  <option value="submitted">submitted</option>
                  <option value="in_review">in_review</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                </select>
                <input
                  className="instructor-input"
                  placeholder="نوع الطلب"
                  value={requestState.filterType}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, filterType: event.target.value }))
                  }
                />
                <button onClick={() => loadWorkflowRequests()} disabled={requestState.loading}>
                  {requestState.loading ? "..." : "تحديث"}
                </button>
              </div>
              <p>عدد الطلبات: {formatNumber(requestState.total)}</p>
              <form className="instructor-form" onSubmit={handleUpdateRequestStatus}>
                <select
                  className="instructor-select"
                  value={requestState.requestId}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, requestId: event.target.value }))
                  }
                  required
                >
                  <option value="">اختر الطلب</option>
                  {requestState.rows.map((req) => (
                    <option key={req.id} value={req.id}>
                      {req.title} - {req.candidate_no}
                    </option>
                  ))}
                </select>
                <select
                  className="instructor-select"
                  value={requestState.status}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, status: event.target.value }))
                  }
                >
                  <option value="in_review">in_review</option>
                  <option value="approve">approve</option>
                  <option value="reject">reject</option>
                  <option value="escalate">escalate</option>
                </select>
                <input
                  className="instructor-input"
                  type="text"
                  placeholder="ملاحظة إجرائية"
                  value={requestState.note}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, note: event.target.value }))
                  }
                />
                <button type="submit" disabled={requestState.loading}>
                  تحديث حالة الطلب
                </button>
              </form>
              <form className="instructor-form" onSubmit={handleAddRequestComment}>
                <input
                  className="instructor-input"
                  type="text"
                  placeholder="تعليق إضافي"
                  value={requestState.comment}
                  onChange={(event) =>
                    setRequestState((prev) => ({ ...prev, comment: event.target.value }))
                  }
                />
                <button type="submit" disabled={requestState.loading || !requestState.requestId}>
                  إضافة تعليق
                </button>
              </form>
              {requestState.error && <div className="state error">{requestState.error}</div>}
              {requestState.message && <div className="state">{requestState.message}</div>}

              {requestState.rows.length === 0 && <p className="empty">لا توجد بيانات.</p>}
              {requestState.rows.map((req) => (
                <div key={req.id} className="list-card">
                  <div>
                    <h4>{req.title}</h4>
                    <p>
                      {req.first_name} {req.last_name} - {req.status} - {req.priority || "-"}
                    </p>
                  </div>
                  <span>{formatDate(req.submitted_at)}</span>
                </div>
              ))}
              <div className="info-card">
                <h3>سجل الإجراءات</h3>
                <div className="info-list">
                  {requestState.actions.length === 0 ? (
                    <p className="empty">لا يوجد سجل.</p>
                  ) : (
                    requestState.actions.map((action) => (
                      <div key={action.id} className="info-row">
                        <span>{action.action}</span>
                        <strong>
                          {action.acted_by_username || "-"} - {formatDateTime(action.acted_at)}
                          {action.note ? ` - ${action.note}` : ""}
                        </strong>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function MetricCard({ title, value }) {
  return (
    <div className="metric-card">
      <span>{title}</span>
      <h3>{value}</h3>
    </div>
  );
}

function SectionTable({ title, columns, rows }) {
  return (
    <div className="section-table">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty">لا توجد بيانات.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${index}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
