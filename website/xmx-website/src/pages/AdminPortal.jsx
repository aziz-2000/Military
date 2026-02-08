import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./AdminPortal.css";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const STORAGE_TOKEN_KEY = "xmx_portal_token";
const STORAGE_ROLES_KEY = "xmx_portal_roles";

const NAV_ITEMS = [
  { key: "dashboard", label: "لوحة القيادة" },
  { key: "candidates", label: "إدارة المرشحين" },
  { key: "workflow", label: "سير الإجراءات" },
  { key: "cohorts", label: "إدارة الدورات والفصائل" },
  { key: "academics", label: "الدرجات الأكاديمية" },
  { key: "medical", label: "الملف الطبي" },
  { key: "attendance", label: "الحضور والغياب" },
  { key: "reports", label: "التقارير والملخصات" },
  { key: "security", label: "الصلاحيات والأدوار" },
];

const TRACK_OPTIONS = ["تأسيسية", "تقدمية"];
const BACKGROUND_OPTIONS = ["جامعي", "عسكري سابق", "مدني"];

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    const normalized = String(value).trim();
    if (!normalized.length) return;
    query.set(key, normalized);
  });
  return query.toString();
}

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

function parseRoles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_ROLES_KEY) || "[]");
  } catch {
    return [];
  }
}

function emptyCandidateForm() {
  return {
    id: "",
    username: "",
    email: "",
    phone: "",
    password: "",
    firstName: "",
    lastName: "",
    gender: "male",
    birthDate: "",
    address: "",
    nationalId: "",
    heightCm: "",
    weightKg: "",
    candidateNo: "",
    status: "enrolled",
    intakeYear: "",
    cohortId: "",
    platoonId: "",
    background: "",
    militaryNo: "",
    sportsNo: "",
  };
}

async function apiRequest(path, { method = "GET", token, body, isBlob = false } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || "حدث خطأ غير متوقع.");
    error.status = response.status;
    throw error;
  }

  if (isBlob) return response.blob();
  return response.json().catch(() => ({}));
}

export default function AdminPortal() {
  const navigate = useNavigate();
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  const roles = useMemo(() => parseRoles(), []);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [boot, setBoot] = useState({ loading: true, error: "" });

  const [filters, setFilters] = useState({ cohorts: [], platoons: [], statuses: [] });
  const [overview, setOverview] = useState(null);
  const [leadership, setLeadership] = useState({
    summary: null,
    topAbsences: [],
    alerts: [],
    weekly: null,
    loading: false,
    error: "",
  });
  const [leadershipFilters, setLeadershipFilters] = useState({ cohortId: "", from: "", to: "" });

  const [candidateFilters, setCandidateFilters] = useState({ search: "", cohortId: "", platoonId: "", status: "" });
  const [candidateState, setCandidateState] = useState({ rows: [], total: 0, loading: false, error: "", message: "" });
  const [candidateForm, setCandidateForm] = useState(() => emptyCandidateForm());
  const [candidateOptions, setCandidateOptions] = useState([]);

  const [cohortRows, setCohortRows] = useState([]);
  const [platoonRows, setPlatoonRows] = useState([]);
  const [cohortForm, setCohortForm] = useState({ cohortNo: "", name: "", track: "تأسيسية", startYear: "" });
  const [platoonForm, setPlatoonForm] = useState({ cohortId: "", platoonNo: "", name: "" });

  const [terms, setTerms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [sections, setSections] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [gradeRows, setGradeRows] = useState([]);
  const [gradeEdits, setGradeEdits] = useState({});
  const [academics, setAcademics] = useState({
    termId: "",
    courseId: "",
    sectionId: "",
    assessmentId: "",
    loading: false,
    error: "",
    message: "",
  });

  const [attendanceFilters, setAttendanceFilters] = useState({ cohortId: "", platoonId: "", from: "", to: "" });
  const [attendance, setAttendance] = useState({
    summary: { total: 0, present: 0, absent: 0 },
    daily: [],
    roster: [],
    sections: [],
    rows: [],
    sectionId: "",
    sessionAt: "",
    topic: "",
    loading: false,
    error: "",
    message: "",
  });

  const [medicalFilters, setMedicalFilters] = useState({
    search: "",
    cohortId: "",
    platoonId: "",
    examTypeId: "",
    status: "",
    fitStatus: "",
    from: "",
    to: "",
  });
  const [medicalOptions, setMedicalOptions] = useState({ examTypes: [], statuses: [], fitStatuses: [] });
  const [medical, setMedical] = useState({
    summary: { total: 0, scheduled: 0, completed: 0, fit: 0, unfit: 0 },
    rows: [],
    total: 0,
    examForm: { candidateId: "", examTypeId: "", scheduledAt: "", status: "scheduled" },
    resultForm: { examId: "", status: "completed", performedAt: "", fitStatus: "fit", summary: "" },
    noteForm: { candidateId: "", note: "" },
    loading: false,
    error: "",
    message: "",
  });

  const [reportFilters, setReportFilters] = useState({ cohortId: "", platoonId: "", from: "", to: "", termId: "", courseId: "" });
  const [reports, setReports] = useState({ summary: null, advanced: null, saved: [], loading: false, error: "", message: "" });
  const [saveReportForm, setSaveReportForm] = useState({ name: "", description: "", reportType: "executive" });

  const [workflowFilters, setWorkflowFilters] = useState({
    search: "",
    status: "",
    requestType: "",
    priority: "",
    cohortId: "",
    platoonId: "",
    assignedTo: "",
  });
  const [workflowOptions, setWorkflowOptions] = useState({
    statuses: [],
    priorities: [],
    requestTypes: [],
    assignees: [],
  });
  const [workflow, setWorkflow] = useState({
    rows: [],
    total: 0,
    selectedRequestId: "",
    actions: [],
    loading: false,
    error: "",
    message: "",
  });
  const [workflowDecisionForm, setWorkflowDecisionForm] = useState({
    decision: "in_review",
    requiredApprovals: "",
    note: "",
  });
  const [workflowAssignForm, setWorkflowAssignForm] = useState({
    assignedTo: "",
    priority: "normal",
    dueAt: "",
    note: "",
  });
  const [workflowComment, setWorkflowComment] = useState("");

  const [security, setSecurity] = useState({
    roles: [],
    permissions: [],
    rolePermissions: [],
    users: [],
    ranks: [],
    rankPolicies: [],
    selectedRoleId: "",
    selectedUserId: "",
    selectedRankId: "",
    roleDraft: [],
    userDraft: [],
    rankDraft: [],
    loading: false,
    error: "",
    message: "",
  });

  function logout() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_ROLES_KEY);
    navigate("/student-portal");
  }

  function getPlatoonsByCohort(cohortId) {
    if (!cohortId) return filters.platoons;
    return filters.platoons.filter((row) => row.cohort_id === cohortId);
  }

  async function loadOverview() {
    const payload = await apiRequest("/admin/overview", { token });
    setOverview(payload);
  }

  async function loadFilters() {
    const payload = await apiRequest("/admin/filters", { token });
    setFilters({
      cohorts: payload.cohorts || [],
      platoons: payload.platoons || [],
      statuses: payload.statuses || [],
    });
  }

  async function loadCandidateOptions() {
    const payload = await apiRequest("/admin/candidates?limit=200", { token });
    setCandidateOptions(payload.rows || []);
  }

  async function loadLeadership(customFilters) {
    const source = customFilters || leadershipFilters;
    setLeadership((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const query = buildQuery({
        cohort_id: source.cohortId || undefined,
        from: source.from || undefined,
        to: source.to || undefined,
      });
      const payload = await apiRequest(`/admin/leadership/overview${query ? `?${query}` : ""}`, {
        token,
      });
      setLeadership({
        summary: payload.summary || null,
        topAbsences: payload.topAbsences || [],
        alerts: payload.alerts || [],
        weekly: payload.weekly || null,
        loading: false,
        error: "",
      });
    } catch (error) {
      setLeadership((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadCandidates(customFilters) {
    const source = customFilters || candidateFilters;
    setCandidateState((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = buildQuery({
        search: source.search || undefined,
        cohort_id: source.cohortId || undefined,
        platoon_id: source.platoonId || undefined,
        status: source.status || undefined,
        limit: 150,
      });
      const payload = await apiRequest(`/admin/candidates?${query}`, { token });
      setCandidateState((prev) => ({
        ...prev,
        rows: payload.rows || [],
        total: Number(payload.total || 0),
        loading: false,
      }));
    } catch (error) {
      setCandidateState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadCohortsAndPlatoons() {
    const [cohortsPayload, platoonsPayload] = await Promise.all([
      apiRequest("/admin/cohorts", { token }),
      apiRequest("/admin/platoons", { token }),
    ]);
    setCohortRows(cohortsPayload.rows || []);
    setPlatoonRows(platoonsPayload.rows || []);
  }

  async function loadTerms() {
    const payload = await apiRequest("/admin/academics/terms", { token });
    const rows = payload.rows || [];
    setTerms(rows);
    setAcademics((prev) => ({
      ...prev,
      termId: prev.termId || rows[0]?.id || "",
    }));
  }

  async function loadCourses(termId) {
    if (!termId) {
      setCourses([]);
      return;
    }
    const payload = await apiRequest(`/admin/academics/courses?${buildQuery({ term_id: termId })}`, {
      token,
    });
    setCourses(payload.rows || []);
  }

  async function loadSections(termId, courseId) {
    if (!termId) {
      setSections([]);
      return;
    }
    const payload = await apiRequest(
      `/admin/academics/sections?${buildQuery({
        term_id: termId,
        course_id: courseId || undefined,
      })}`,
      { token }
    );
    setSections(payload.rows || []);
  }

  async function loadAssessments(sectionId) {
    if (!sectionId) {
      setAssessments([]);
      return;
    }
    const payload = await apiRequest(`/admin/academics/assessments?${buildQuery({ section_id: sectionId })}`, {
      token,
    });
    setAssessments(payload.rows || []);
  }

  async function loadGrades(sectionId, assessmentId) {
    if (!sectionId || !assessmentId) {
      setGradeRows([]);
      setGradeEdits({});
      return;
    }
    setAcademics((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const payload = await apiRequest(
        `/admin/academics/grades?${buildQuery({
          section_id: sectionId,
          assessment_id: assessmentId,
        })}`,
        { token }
      );
      setGradeRows(payload.rows || []);
      setGradeEdits({});
      setAcademics((prev) => ({ ...prev, loading: false }));
    } catch (error) {
      setAcademics((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadAttendance(customFilters) {
    const source = customFilters || attendanceFilters;
    setAttendance((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = buildQuery({
        cohort_id: source.cohortId || undefined,
        platoon_id: source.platoonId || undefined,
        from: source.from || undefined,
        to: source.to || undefined,
      });
      const [summaryPayload, rosterPayload, sectionsPayload] = await Promise.all([
        apiRequest(`/admin/attendance/summary${query ? `?${query}` : ""}`, { token }),
        apiRequest(`/admin/attendance/roster${query ? `?${query}` : ""}`, { token }),
        apiRequest(`/admin/attendance/sections${query ? `?${query}` : ""}`, { token }),
      ]);
      setAttendance((prev) => ({
        ...prev,
        summary: summaryPayload.summary || { total: 0, present: 0, absent: 0 },
        daily: summaryPayload.daily || [],
        roster: rosterPayload.rows || [],
        sections: sectionsPayload.rows || [],
        loading: false,
        error: "",
      }));
    } catch (error) {
      setAttendance((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadMedicalFilters() {
    const payload = await apiRequest("/admin/medical/filters", { token });
    setMedicalOptions({
      examTypes: payload.examTypes || [],
      statuses: payload.statuses || [],
      fitStatuses: payload.fitStatuses || [],
    });
  }

  async function loadMedical(customFilters) {
    const source = customFilters || medicalFilters;
    setMedical((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = buildQuery({
        search: source.search || undefined,
        cohort_id: source.cohortId || undefined,
        platoon_id: source.platoonId || undefined,
        exam_type_id: source.examTypeId || undefined,
        status: source.status || undefined,
        fit_status: source.fitStatus || undefined,
        from: source.from || undefined,
        to: source.to || undefined,
      });
      const [summaryPayload, examsPayload] = await Promise.all([
        apiRequest(`/admin/medical/summary${query ? `?${query}` : ""}`, { token }),
        apiRequest(`/admin/medical/exams${query ? `?${query}` : ""}`, { token }),
      ]);
      setMedical((prev) => ({
        ...prev,
        summary: summaryPayload.summary || { total: 0, scheduled: 0, completed: 0, fit: 0, unfit: 0 },
        rows: examsPayload.rows || [],
        total: Number(examsPayload.total || 0),
        loading: false,
      }));
    } catch (error) {
      setMedical((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadReports(customFilters) {
    const source = customFilters || reportFilters;
    setReports((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = buildQuery({
        cohort_id: source.cohortId || undefined,
        platoon_id: source.platoonId || undefined,
        from: source.from || undefined,
        to: source.to || undefined,
        term_id: source.termId || undefined,
        course_id: source.courseId || undefined,
      });
      const [summaryPayload, advancedPayload, savedPayload] = await Promise.all([
        apiRequest("/admin/reports/summary", { token }),
        apiRequest(`/admin/reports/advanced${query ? `?${query}` : ""}`, { token }),
        apiRequest("/admin/reports/saved", { token }),
      ]);
      setReports((prev) => ({
        ...prev,
        summary: summaryPayload,
        advanced: advancedPayload,
        saved: savedPayload.rows || [],
        loading: false,
      }));
    } catch (error) {
      setReports((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadWorkflowFilters() {
    const payload = await apiRequest("/admin/workflow/filters", { token });
    setWorkflowOptions({
      statuses: payload.statuses || [],
      priorities: payload.priorities || [],
      requestTypes: payload.requestTypes || [],
      assignees: payload.assignees || [],
    });
  }

  async function loadWorkflow(customFilters = null) {
    const source = customFilters || workflowFilters;
    setWorkflow((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const query = buildQuery({
        search: source.search || undefined,
        status: source.status || undefined,
        request_type: source.requestType || undefined,
        priority: source.priority || undefined,
        cohort_id: source.cohortId || undefined,
        platoon_id: source.platoonId || undefined,
        assigned_to: source.assignedTo || undefined,
        limit: 200,
      });
      const payload = await apiRequest(`/admin/workflow/requests${query ? `?${query}` : ""}`, {
        token,
      });
      setWorkflow((prev) => {
        const rows = payload.rows || [];
        const selectedRequestId =
          (prev.selectedRequestId && rows.some((row) => row.id === prev.selectedRequestId)
            ? prev.selectedRequestId
            : rows[0]?.id) || "";
        return {
          ...prev,
          rows,
          total: Number(payload.total || 0),
          selectedRequestId,
          loading: false,
          error: "",
          message: prev.message,
        };
      });
    } catch (error) {
      setWorkflow((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadWorkflowActions(requestId) {
    if (!requestId) {
      setWorkflow((prev) => ({ ...prev, actions: [] }));
      return;
    }
    try {
      const payload = await apiRequest(`/admin/workflow/requests/${requestId}/actions`, { token });
      setWorkflow((prev) => ({ ...prev, actions: payload.rows || [] }));
    } catch (error) {
      setWorkflow((prev) => ({ ...prev, error: error.message, actions: [] }));
    }
  }

  async function loadSecurity() {
    setSecurity((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const payload = await apiRequest("/admin/security/overview", { token });
      setSecurity((prev) => ({
        ...prev,
        roles: payload.roles || [],
        permissions: payload.permissions || [],
        rolePermissions: payload.rolePermissions || [],
        users: payload.users || [],
        ranks: payload.ranks || [],
        rankPolicies: payload.rankPolicies || [],
        selectedRoleId: prev.selectedRoleId || payload.roles?.[0]?.id || "",
        selectedUserId: prev.selectedUserId || payload.users?.[0]?.user_id || "",
        selectedRankId: prev.selectedRankId || payload.ranks?.[0]?.id || "",
        loading: false,
      }));
    } catch (error) {
      setSecurity((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    if (!token) {
      setBoot({ loading: false, error: "يرجى تسجيل الدخول أولاً." });
      return;
    }
    const bootstrap = async () => {
      setBoot({ loading: true, error: "" });
      try {
        await Promise.all([
          loadOverview(),
          loadFilters(),
          loadCandidateOptions(),
          loadCandidates(),
          loadCohortsAndPlatoons(),
          loadTerms(),
          loadLeadership(),
          loadAttendance(),
          loadMedicalFilters(),
          loadMedical(),
          loadReports(),
          loadWorkflowFilters(),
          loadWorkflow(),
        ]);
        setBoot({ loading: false, error: "" });
      } catch (error) {
        setBoot({
          loading: false,
          error: error.status === 401 || error.status === 403 ? "لا توجد صلاحية للوصول إلى بوابة الإدارة." : error.message,
        });
      }
    };
    bootstrap();
  }, [token]);

  useEffect(() => {
    if (!academics.termId || !token) return;
    loadCourses(academics.termId).catch((error) => setAcademics((prev) => ({ ...prev, error: error.message })));
  }, [academics.termId, token]);

  useEffect(() => {
    if (!academics.termId || !token) return;
    loadSections(academics.termId, academics.courseId).catch((error) => setAcademics((prev) => ({ ...prev, error: error.message })));
  }, [academics.termId, academics.courseId, token]);

  useEffect(() => {
    if (!academics.sectionId || !token) return;
    loadAssessments(academics.sectionId).catch((error) => setAcademics((prev) => ({ ...prev, error: error.message })));
  }, [academics.sectionId, token]);

  useEffect(() => {
    if (!academics.sectionId || !academics.assessmentId || !token) return;
    loadGrades(academics.sectionId, academics.assessmentId).catch((error) => setAcademics((prev) => ({ ...prev, error: error.message })));
  }, [academics.sectionId, academics.assessmentId, token]);

  useEffect(() => {
    if (!security.selectedRoleId) return;
    const draft = security.rolePermissions.filter((item) => item.role_id === security.selectedRoleId).map((item) => item.permission_id);
    setSecurity((prev) => ({ ...prev, roleDraft: draft }));
  }, [security.selectedRoleId, security.rolePermissions]);

  useEffect(() => {
    if (!security.selectedUserId) return;
    const user = security.users.find((item) => item.user_id === security.selectedUserId);
    setSecurity((prev) => ({ ...prev, userDraft: (user?.role_ids || []).map((value) => String(value)) }));
  }, [security.selectedUserId, security.users]);

  useEffect(() => {
    if (!security.selectedRankId) return;
    const draft = security.rankPolicies.filter((item) => item.rank_id === security.selectedRankId).map((item) => item.role_id);
    setSecurity((prev) => ({ ...prev, rankDraft: draft }));
  }, [security.selectedRankId, security.rankPolicies]);

  useEffect(() => {
    if (!workflow.selectedRequestId || !token) {
      setWorkflow((prev) => ({ ...prev, actions: [] }));
      return;
    }
    loadWorkflowActions(workflow.selectedRequestId).catch((error) => {
      setWorkflow((prev) => ({ ...prev, error: error.message }));
    });
  }, [workflow.selectedRequestId, token]);

  useEffect(() => {
    const selected = workflow.rows.find((row) => row.id === workflow.selectedRequestId);
    if (!selected) return;
    setWorkflowAssignForm((prev) => ({
      ...prev,
      assignedTo: selected.assigned_to || "",
      priority: selected.priority || "normal",
      dueAt: selected.due_at ? new Date(selected.due_at).toISOString().slice(0, 16) : "",
    }));
  }, [workflow.rows, workflow.selectedRequestId]);

  const candidatePlatoons = getPlatoonsByCohort(candidateFilters.cohortId);
  const candidateFormPlatoons = getPlatoonsByCohort(candidateForm.cohortId);
  const attendancePlatoons = getPlatoonsByCohort(attendanceFilters.cohortId);
  const medicalPlatoons = getPlatoonsByCohort(medicalFilters.cohortId);
  const reportPlatoons = getPlatoonsByCohort(reportFilters.cohortId);
  const workflowPlatoons = getPlatoonsByCohort(workflowFilters.cohortId);
  const selectedWorkflowRequest = workflow.rows.find((row) => row.id === workflow.selectedRequestId) || null;

  function toggleValue(value, values) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  async function saveCandidate(event) {
    event.preventDefault();
    setCandidateState((prev) => ({ ...prev, error: "", message: "", loading: true }));
    try {
      const payload = {
        username: candidateForm.username || undefined,
        email: candidateForm.email || undefined,
        phone: candidateForm.phone || undefined,
        password: candidateForm.password || undefined,
        firstName: candidateForm.firstName,
        lastName: candidateForm.lastName,
        gender: candidateForm.gender || undefined,
        birthDate: candidateForm.birthDate || undefined,
        address: candidateForm.address || undefined,
        nationalId: candidateForm.nationalId || undefined,
        heightCm: candidateForm.heightCm || undefined,
        weightKg: candidateForm.weightKg || undefined,
        candidateNo: candidateForm.candidateNo,
        status: candidateForm.status || undefined,
        intakeYear: candidateForm.intakeYear || undefined,
        cohortId: candidateForm.cohortId || undefined,
        platoonId: candidateForm.platoonId || undefined,
        background: candidateForm.background || undefined,
        militaryNo: candidateForm.militaryNo || undefined,
        sportsNo: candidateForm.sportsNo || undefined,
      };

      if (candidateForm.id) {
        await apiRequest(`/admin/candidates/${candidateForm.id}`, {
          method: "PUT",
          token,
          body: payload,
        });
        setCandidateState((prev) => ({ ...prev, message: "تم تحديث المرشح.", loading: false }));
      } else {
        const result = await apiRequest("/admin/candidates", {
          method: "POST",
          token,
          body: payload,
        });
        setCandidateState((prev) => ({
          ...prev,
          message: `تمت إضافة المرشح.${result.defaultPassword ? ` كلمة المرور الافتراضية: ${result.defaultPassword}` : ""}`,
          loading: false,
        }));
      }
      setCandidateForm(emptyCandidateForm());
      await Promise.all([loadCandidates(), loadCandidateOptions(), loadOverview()]);
    } catch (error) {
      setCandidateState((prev) => ({ ...prev, error: error.message, loading: false }));
    }
  }

  async function saveCandidateStatus(candidateId, status) {
    try {
      await apiRequest(`/admin/candidates/${candidateId}/status`, {
        method: "PATCH",
        token,
        body: { status },
      });
      await Promise.all([loadCandidates(), loadOverview()]);
    } catch (error) {
      setCandidateState((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveCohort(event) {
    event.preventDefault();
    try {
      await apiRequest("/admin/cohorts", {
        method: "POST",
        token,
        body: {
          cohortNo: cohortForm.cohortNo,
          name: cohortForm.name,
          track: cohortForm.track,
          startYear: cohortForm.startYear || undefined,
        },
      });
      setCohortForm({ cohortNo: "", name: "", track: "تأسيسية", startYear: "" });
      await Promise.all([loadFilters(), loadCohortsAndPlatoons()]);
    } catch (error) {
      setBoot((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function savePlatoon(event) {
    event.preventDefault();
    try {
      await apiRequest("/admin/platoons", {
        method: "POST",
        token,
        body: {
          cohortId: platoonForm.cohortId,
          platoonNo: platoonForm.platoonNo,
          name: platoonForm.name,
        },
      });
      setPlatoonForm((prev) => ({ ...prev, platoonNo: "", name: "" }));
      await Promise.all([loadFilters(), loadCohortsAndPlatoons()]);
    } catch (error) {
      setBoot((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveGrades() {
    if (!academics.assessmentId) return;
    setAcademics((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const grades = gradeRows.map((row) => ({
        candidateId: row.candidate_id,
        score: gradeEdits[row.candidate_id] !== undefined ? gradeEdits[row.candidate_id] : row.score,
      }));
      const result = await apiRequest("/admin/academics/grades", {
        method: "POST",
        token,
        body: { assessmentId: academics.assessmentId, grades },
      });
      setAcademics((prev) => ({
        ...prev,
        loading: false,
        message: `تم حفظ الدرجات. عدد السجلات: ${result.updated || 0}`,
      }));
      await Promise.all([loadGrades(academics.sectionId, academics.assessmentId), loadOverview()]);
    } catch (error) {
      setAcademics((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function loadAttendanceEntryRows() {
    if (!attendance.sectionId) return;
    setAttendance((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const assessmentsPayload = await apiRequest(
        `/admin/academics/assessments?${buildQuery({ section_id: attendance.sectionId })}`,
        { token }
      );
      let rows = [];
      if ((assessmentsPayload.rows || []).length > 0) {
        const firstAssessmentId = assessmentsPayload.rows[0].id;
        const gradesPayload = await apiRequest(
          `/admin/academics/grades?${buildQuery({
            section_id: attendance.sectionId,
            assessment_id: firstAssessmentId,
          })}`,
          { token }
        );
        rows = gradesPayload.rows || [];
      } else {
        const candidatesPayload = await apiRequest(
          `/admin/candidates?${buildQuery({
            cohort_id: attendanceFilters.cohortId || undefined,
            platoon_id: attendanceFilters.platoonId || undefined,
            limit: 150,
          })}`,
          { token }
        );
        rows = candidatesPayload.rows || [];
      }
      setAttendance((prev) => ({
        ...prev,
        rows: rows.map((row) => ({
          candidateId: row.candidate_id || row.id,
          candidateNo: row.candidate_no || "-",
          fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-",
          present: true,
          note: "",
        })),
        loading: false,
      }));
    } catch (error) {
      setAttendance((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function saveAttendanceSession() {
    if (!attendance.sectionId || attendance.rows.length === 0) return;
    setAttendance((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      const result = await apiRequest("/admin/attendance/records", {
        method: "POST",
        token,
        body: {
          sectionId: attendance.sectionId,
          sessionAt: attendance.sessionAt ? new Date(attendance.sessionAt).toISOString() : undefined,
          topic: attendance.topic || undefined,
          records: attendance.rows.map((row) => ({
            candidateId: row.candidateId,
            present: row.present,
            note: row.note || null,
          })),
        },
      });
      setAttendance((prev) => ({
        ...prev,
        loading: false,
        rows: [],
        sessionAt: "",
        topic: "",
        message: `تم حفظ جلسة الحضور. عدد السجلات: ${result.updated || 0}`,
      }));
      await Promise.all([loadAttendance(), loadOverview()]);
    } catch (error) {
      setAttendance((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function saveMedicalExam(event) {
    event.preventDefault();
    try {
      await apiRequest("/admin/medical/exams", {
        method: "POST",
        token,
        body: {
          candidateId: medical.examForm.candidateId,
          examTypeId: medical.examForm.examTypeId,
          scheduledAt: medical.examForm.scheduledAt ? new Date(medical.examForm.scheduledAt).toISOString() : undefined,
          status: medical.examForm.status || "scheduled",
        },
      });
      setMedical((prev) => ({
        ...prev,
        examForm: { ...prev.examForm, scheduledAt: "" },
        message: "تم إنشاء فحص طبي.",
      }));
      await Promise.all([loadMedical(), loadOverview()]);
    } catch (error) {
      setMedical((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveMedicalResult(event) {
    event.preventDefault();
    if (!medical.resultForm.examId) return;
    try {
      await apiRequest(`/admin/medical/exams/${medical.resultForm.examId}/result`, {
        method: "PUT",
        token,
        body: {
          status: medical.resultForm.status,
          performedAt: medical.resultForm.performedAt ? new Date(medical.resultForm.performedAt).toISOString() : undefined,
          fitStatus: medical.resultForm.fitStatus,
          summary: medical.resultForm.summary || undefined,
        },
      });
      setMedical((prev) => ({
        ...prev,
        resultForm: { ...prev.resultForm, performedAt: "", summary: "" },
        message: "تم تحديث نتيجة الفحص.",
      }));
      await Promise.all([loadMedical(), loadOverview()]);
    } catch (error) {
      setMedical((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveMedicalNote(event) {
    event.preventDefault();
    if (!medical.noteForm.candidateId || !medical.noteForm.note) return;
    try {
      await apiRequest("/admin/medical/notes", {
        method: "POST",
        token,
        body: {
          candidateId: medical.noteForm.candidateId,
          note: medical.noteForm.note,
        },
      });
      setMedical((prev) => ({
        ...prev,
        noteForm: { ...prev.noteForm, note: "" },
        message: "تم حفظ الملاحظة الطبية.",
      }));
    } catch (error) {
      setMedical((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveReport(event) {
    event.preventDefault();
    if (!saveReportForm.name) return;
    try {
      await apiRequest("/admin/reports/saved", {
        method: "POST",
        token,
        body: {
          name: saveReportForm.name,
          description: saveReportForm.description || undefined,
          reportType: saveReportForm.reportType,
          filters: reportFilters,
        },
      });
      setSaveReportForm({ name: "", description: "", reportType: "executive" });
      await loadReports();
    } catch (error) {
      setReports((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function deleteSavedReport(id) {
    try {
      await apiRequest(`/admin/reports/saved/${id}`, { method: "DELETE", token });
      await loadReports();
    } catch (error) {
      setReports((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function exportReport(type, format = "csv") {
    try {
      const query = buildQuery({
        cohort_id: reportFilters.cohortId || undefined,
        platoon_id: reportFilters.platoonId || undefined,
        from: reportFilters.from || undefined,
        to: reportFilters.to || undefined,
        term_id: reportFilters.termId || undefined,
        course_id: reportFilters.courseId || undefined,
      });
      const blob = await apiRequest(`/admin/reports/${type}.${format}?${query}`, { token, isBlob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${type}_report.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setReports((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveWorkflowDecision(event) {
    event.preventDefault();
    if (!workflow.selectedRequestId) return;
    setWorkflow((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest(`/admin/workflow/requests/${workflow.selectedRequestId}/decision`, {
        method: "PUT",
        token,
        body: {
          decision: workflowDecisionForm.decision,
          note: workflowDecisionForm.note || undefined,
          requiredApprovals: workflowDecisionForm.requiredApprovals || undefined,
        },
      });
      setWorkflowDecisionForm((prev) => ({ ...prev, note: "" }));
      setWorkflow((prev) => ({ ...prev, loading: false, message: "تم تنفيذ القرار بنجاح." }));
      await Promise.all([loadWorkflow(), loadWorkflowActions(workflow.selectedRequestId), loadOverview(), loadLeadership()]);
    } catch (error) {
      setWorkflow((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function saveWorkflowAssignment(event) {
    event.preventDefault();
    if (!workflow.selectedRequestId) return;
    setWorkflow((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest(`/admin/workflow/requests/${workflow.selectedRequestId}/assign`, {
        method: "PUT",
        token,
        body: {
          assignedTo: workflowAssignForm.assignedTo || null,
          priority: workflowAssignForm.priority,
          dueAt: workflowAssignForm.dueAt || null,
          note: workflowAssignForm.note || null,
        },
      });
      setWorkflowAssignForm((prev) => ({ ...prev, note: "" }));
      setWorkflow((prev) => ({ ...prev, loading: false, message: "تم تحديث التعيين." }));
      await Promise.all([loadWorkflow(), loadWorkflowActions(workflow.selectedRequestId)]);
    } catch (error) {
      setWorkflow((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function saveWorkflowComment(event) {
    event.preventDefault();
    if (!workflow.selectedRequestId || !workflowComment.trim()) return;
    setWorkflow((prev) => ({ ...prev, loading: true, error: "", message: "" }));
    try {
      await apiRequest(`/admin/workflow/requests/${workflow.selectedRequestId}/comment`, {
        method: "POST",
        token,
        body: { note: workflowComment },
      });
      setWorkflowComment("");
      setWorkflow((prev) => ({ ...prev, loading: false, message: "تم حفظ التعليق." }));
      await loadWorkflowActions(workflow.selectedRequestId);
    } catch (error) {
      setWorkflow((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  async function saveRolePermissions() {
    if (!security.selectedRoleId) return;
    try {
      await apiRequest(`/admin/security/role-permissions/${security.selectedRoleId}`, {
        method: "PUT",
        token,
        body: { permissionIds: security.roleDraft },
      });
      await loadSecurity();
    } catch (error) {
      setSecurity((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveUserRoles() {
    if (!security.selectedUserId) return;
    try {
      await apiRequest(`/admin/security/user-roles/${security.selectedUserId}`, {
        method: "PUT",
        token,
        body: { roleIds: security.userDraft },
      });
      await loadSecurity();
    } catch (error) {
      setSecurity((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function saveRankPolicies() {
    if (!security.selectedRankId) return;
    try {
      await apiRequest(`/admin/security/rank-policies/${security.selectedRankId}`, {
        method: "PUT",
        token,
        body: { roleIds: security.rankDraft },
      });
      await loadSecurity();
    } catch (error) {
      setSecurity((prev) => ({ ...prev, error: error.message }));
    }
  }

  async function applyRankPolicies() {
    try {
      await apiRequest("/admin/security/apply-rank-policies", {
        method: "POST",
        token,
      });
      await loadSecurity();
    } catch (error) {
      setSecurity((prev) => ({ ...prev, error: error.message }));
    }
  }

  if (boot.loading) {
    return (
      <div className="admin-portal">
        <div className="admin-state">جاري تحميل بوابة الإدارة...</div>
      </div>
    );
  }

  if (boot.error) {
    return (
      <div className="admin-portal">
        <div className="admin-state error">
          <p>{boot.error}</p>
          <button className="admin-button" onClick={logout}>
            العودة لتسجيل الدخول
          </button>
        </div>
      </div>
    );
  }

  const metrics = overview?.metrics || {};
  let activeContent = <div className="admin-state">سيتم تجهيز هذا القسم بعد قليل.</div>;

  if (activeTab === "dashboard") {
    activeContent = (
      <section className="admin-content">
        <div className="admin-hero">
          <div>
            <h2>لوحة القيادة</h2>
            <p>مؤشرات تنفيذية لحالة النظام والكلية.</p>
          </div>
          <div className="admin-profile-card">
            <h3>{overview?.profile?.fullName || "حساب إداري"}</h3>
            <p>{overview?.profile?.department || "-"}</p>
            <span>{overview?.profile?.rankTitle || "-"}</span>
          </div>
        </div>
        <div className="admin-section">
          <div className="admin-filters wide">
            <select
              className="admin-select"
              value={leadershipFilters.cohortId}
              onChange={(event) =>
                setLeadershipFilters((prev) => ({ ...prev, cohortId: event.target.value }))
              }
            >
              <option value="">كل الدورات</option>
              {filters.cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>
                  {cohort.cohort_no} - {cohort.name}
                </option>
              ))}
            </select>
            <input
              className="admin-input"
              type="date"
              value={leadershipFilters.from}
              onChange={(event) =>
                setLeadershipFilters((prev) => ({ ...prev, from: event.target.value }))
              }
            />
            <input
              className="admin-input"
              type="date"
              value={leadershipFilters.to}
              onChange={(event) =>
                setLeadershipFilters((prev) => ({ ...prev, to: event.target.value }))
              }
            />
            <button className="admin-button" onClick={() => loadLeadership()} disabled={leadership.loading}>
              {leadership.loading ? "..." : "تحديث"}
            </button>
          </div>
        </div>
        <div className="admin-metrics">
          <div className="metric-card"><span>إجمالي المرشحين</span><h3>{formatNumber(leadership.summary?.totalCandidates ?? metrics.totalCandidates)}</h3></div>
          <div className="metric-card"><span>الملتحقون</span><h3>{formatNumber(leadership.summary?.enrolledCandidates ?? metrics.enrolledCandidates)}</h3></div>
          <div className="metric-card"><span>معدل الحضور</span><h3>{formatNumber(leadership.summary?.attendanceRate ?? metrics.attendanceRate)}%</h3></div>
          <div className="metric-card"><span>متوسط الدرجات</span><h3>{formatNumber(leadership.summary?.averageGrade ?? metrics.averageGrade)}</h3></div>
          <div className="metric-card"><span>طلبات معلقة</span><h3>{formatNumber(leadership.summary?.pendingRequests ?? metrics.pendingRequests)}</h3></div>
          <div className="metric-card"><span>فحوصات مجدولة</span><h3>{formatNumber(leadership.summary?.medicalPending)}</h3></div>
        </div>
        <div className="info-card">
          <h3>أعلى الغياب</h3>
          <div className="info-list">
            {(leadership.topAbsences || []).length === 0 ? (
              <p className="empty">لا توجد بيانات.</p>
            ) : (
              leadership.topAbsences.map((item) => (
                <div className="info-row" key={`abs-${item.candidate_id}`}>
                  <span>{item.first_name} {item.last_name}</span>
                  <strong>{formatNumber(item.absent_sessions)} غياب</strong>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="admin-metrics">
          <div className="metric-card"><span>حضور آخر 7 أيام</span><h3>{formatNumber(leadership.weekly?.attendanceRate)}%</h3></div>
          <div className="metric-card"><span>متوسط الدرجات الأسبوعي</span><h3>{formatNumber(leadership.weekly?.averageGrade)}</h3></div>
          <div className="metric-card"><span>طلبات جديدة أسبوعياً</span><h3>{formatNumber(leadership.weekly?.newRequests)}</h3></div>
          <div className="metric-card"><span>حالات طبية حرجة أسبوعياً</span><h3>{formatNumber(leadership.weekly?.criticalMedical)}</h3></div>
        </div>
        <div className="info-card">
          <h3>التنبيهات التلقائية</h3>
          <div className="info-list">
            {(leadership.alerts || []).length === 0 ? (
              <p className="empty">لا توجد تنبيهات حرجة حالياً.</p>
            ) : (
              leadership.alerts.map((alertItem, index) => (
                <div className="info-row" key={`${alertItem.type}-${index}`}>
                  <span>{alertItem.title}</span>
                  <strong>{alertItem.description}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    );
  }

  if (activeTab === "candidates") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2>إدارة بيانات الضباط المرشحين</h2>
            <p>بحث وتصفية وتحديث السجلات.</p>
          </div>
          <div className="admin-section-summary">إجمالي النتائج: {formatNumber(candidateState.total)}</div>
        </div>

        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="بحث بالاسم أو الرقم العسكري"
            value={candidateFilters.search}
            onChange={(event) =>
              setCandidateFilters((prev) => ({ ...prev, search: event.target.value }))
            }
          />
          <select
            className="admin-select"
            value={candidateFilters.cohortId}
            onChange={(event) =>
              setCandidateFilters((prev) => ({
                ...prev,
                cohortId: event.target.value,
                platoonId: "",
              }))
            }
          >
            <option value="">كل الدورات</option>
            {filters.cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.cohort_no}
              </option>
            ))}
          </select>
          <select
            className="admin-select"
            value={candidateFilters.platoonId}
            onChange={(event) =>
              setCandidateFilters((prev) => ({ ...prev, platoonId: event.target.value }))
            }
          >
            <option value="">كل الفصائل</option>
            {candidatePlatoons.map((platoon) => (
              <option key={platoon.id} value={platoon.id}>
                فصيل {platoon.platoon_no}
              </option>
            ))}
          </select>
          <select
            className="admin-select"
            value={candidateFilters.status}
            onChange={(event) =>
              setCandidateFilters((prev) => ({ ...prev, status: event.target.value }))
            }
          >
            <option value="">كل الحالات</option>
            {filters.statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button className="admin-button" onClick={() => loadCandidates()} disabled={candidateState.loading}>
            {candidateState.loading ? "..." : "تحديث النتائج"}
          </button>
        </div>

        {candidateState.error ? <div className="admin-state error">{candidateState.error}</div> : null}
        {candidateState.message ? <div className="admin-state">{candidateState.message}</div> : null}

        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>رقم المرشح</th>
                <th>الاسم</th>
                <th>الدورة</th>
                <th>الفصيل</th>
                <th>الرقم العسكري</th>
                <th>الحالة</th>
                <th>تعديل</th>
              </tr>
            </thead>
            <tbody>
              {candidateState.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    لا توجد نتائج.
                  </td>
                </tr>
              ) : (
                candidateState.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.candidate_no}</td>
                    <td>{row.first_name} {row.last_name}</td>
                    <td>{row.cohort_no || "-"}</td>
                    <td>{row.platoon_no || "-"}</td>
                    <td>{row.military_no || "-"}</td>
                    <td>
                      <select className="admin-select" value={row.status} onChange={(event) => saveCandidateStatus(row.id, event.target.value)}>
                        {filters.statuses.map((status) => (
                          <option key={`${row.id}-${status}`} value={status}>{status}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="admin-button secondary"
                        onClick={() =>
                          setCandidateForm((prev) => ({
                            ...prev,
                            id: row.id,
                            username: row.username || "",
                            email: row.email || "",
                            phone: row.phone || "",
                            firstName: row.first_name || "",
                            lastName: row.last_name || "",
                            candidateNo: row.candidate_no || "",
                            status: row.status || "enrolled",
                            intakeYear: row.intake_year || "",
                            cohortId: row.cohort_id || "",
                            platoonId: row.platoon_id || "",
                            background: row.background || "",
                            militaryNo: row.military_no || "",
                            sportsNo: row.sports_no || "",
                            birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : "",
                            address: row.address || "",
                            nationalId: row.national_id || "",
                            heightCm: row.height_cm || "",
                            weightKg: row.weight_kg || "",
                            gender: row.gender || "male",
                            password: "",
                          }))
                        }
                      >
                        تعديل
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-card">
          <h3>{candidateForm.id ? "تعديل مرشح" : "إضافة مرشح جديد"}</h3>
          <form className="admin-form" onSubmit={saveCandidate}>
            <input className="admin-input" placeholder="اسم المستخدم" value={candidateForm.username} onChange={(event) => setCandidateForm((prev) => ({ ...prev, username: event.target.value }))} />
            <input className="admin-input" placeholder="البريد الإلكتروني" value={candidateForm.email} onChange={(event) => setCandidateForm((prev) => ({ ...prev, email: event.target.value }))} />
            <input className="admin-input" placeholder="الهاتف" value={candidateForm.phone} onChange={(event) => setCandidateForm((prev) => ({ ...prev, phone: event.target.value }))} />
            <input className="admin-input" placeholder={candidateForm.id ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"} value={candidateForm.password} onChange={(event) => setCandidateForm((prev) => ({ ...prev, password: event.target.value }))} />
            <input className="admin-input" placeholder="الاسم الأول" value={candidateForm.firstName} onChange={(event) => setCandidateForm((prev) => ({ ...prev, firstName: event.target.value }))} required />
            <input className="admin-input" placeholder="اسم العائلة" value={candidateForm.lastName} onChange={(event) => setCandidateForm((prev) => ({ ...prev, lastName: event.target.value }))} required />
            <input className="admin-input" placeholder="رقم المرشح" value={candidateForm.candidateNo} onChange={(event) => setCandidateForm((prev) => ({ ...prev, candidateNo: event.target.value }))} required />
            <select className="admin-select" value={candidateForm.cohortId} onChange={(event) => setCandidateForm((prev) => ({ ...prev, cohortId: event.target.value, platoonId: "" }))}>
              <option value="">اختر الدورة</option>
              {filters.cohorts.map((cohort) => (
                <option key={`cform-${cohort.id}`} value={cohort.id}>{cohort.cohort_no}</option>
              ))}
            </select>
            <select className="admin-select" value={candidateForm.platoonId} onChange={(event) => setCandidateForm((prev) => ({ ...prev, platoonId: event.target.value }))}>
              <option value="">اختر الفصيل</option>
              {candidateFormPlatoons.map((platoon) => (
                <option key={`pform-${platoon.id}`} value={platoon.id}>فصيل {platoon.platoon_no}</option>
              ))}
            </select>
            <select className="admin-select" value={candidateForm.background} onChange={(event) => setCandidateForm((prev) => ({ ...prev, background: event.target.value }))}>
              <option value="">الخلفية</option>
              {BACKGROUND_OPTIONS.map((background) => (
                <option key={background} value={background}>{background}</option>
              ))}
            </select>
            <input className="admin-input" placeholder="الرقم العسكري" value={candidateForm.militaryNo} onChange={(event) => setCandidateForm((prev) => ({ ...prev, militaryNo: event.target.value }))} />
            <input className="admin-input" placeholder="الرقم الرياضي" value={candidateForm.sportsNo} onChange={(event) => setCandidateForm((prev) => ({ ...prev, sportsNo: event.target.value }))} />
            <button className="admin-button" type="submit">{candidateForm.id ? "تحديث المرشح" : "إضافة مرشح"}</button>
            {candidateForm.id ? (
              <button type="button" className="admin-button secondary" onClick={() => setCandidateForm(emptyCandidateForm())}>
                إلغاء
              </button>
            ) : null}
          </form>
        </div>
      </section>
    );
  }

  if (activeTab === "workflow") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2>محرك سير الإجراءات</h2>
            <p>اعتماد متعدد المستويات مع سجل قرارات إلزامي.</p>
          </div>
          <div className="admin-section-summary">إجمالي الطلبات: {formatNumber(workflow.total)}</div>
        </div>
        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="بحث بالعنوان أو اسم المرشح"
            value={workflowFilters.search}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
          <select
            className="admin-select"
            value={workflowFilters.status}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, status: event.target.value }))}
          >
            <option value="">كل الحالات</option>
            {workflowOptions.statuses.map((statusValue) => (
              <option key={`w-status-${statusValue}`} value={statusValue}>{statusValue}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={workflowFilters.requestType}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, requestType: event.target.value }))}
          >
            <option value="">كل أنواع الطلبات</option>
            {workflowOptions.requestTypes.map((typeValue) => (
              <option key={`w-type-${typeValue}`} value={typeValue}>{typeValue}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={workflowFilters.priority}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, priority: event.target.value }))}
          >
            <option value="">كل الأولويات</option>
            {workflowOptions.priorities.map((priorityValue) => (
              <option key={`w-priority-${priorityValue}`} value={priorityValue}>{priorityValue}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={workflowFilters.cohortId}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, cohortId: event.target.value, platoonId: "" }))}
          >
            <option value="">كل الدورات</option>
            {filters.cohorts.map((cohort) => (
              <option key={`w-cohort-${cohort.id}`} value={cohort.id}>{cohort.cohort_no}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={workflowFilters.platoonId}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, platoonId: event.target.value }))}
          >
            <option value="">كل الفصائل</option>
            {workflowPlatoons.map((platoon) => (
              <option key={`w-platoon-${platoon.id}`} value={platoon.id}>فصيل {platoon.platoon_no}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={workflowFilters.assignedTo}
            onChange={(event) => setWorkflowFilters((prev) => ({ ...prev, assignedTo: event.target.value }))}
          >
            <option value="">كل المكلّفين</option>
            {workflowOptions.assignees.map((assignee) => (
              <option key={`w-assignee-${assignee.id}`} value={assignee.id}>{assignee.username}</option>
            ))}
          </select>
          <button className="admin-button" onClick={() => loadWorkflow()} disabled={workflow.loading}>
            {workflow.loading ? "..." : "تحديث"}
          </button>
        </div>

        {workflow.error ? <div className="admin-state error">{workflow.error}</div> : null}
        {workflow.message ? <div className="admin-state">{workflow.message}</div> : null}

        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>الطلب</th>
                <th>المرشح</th>
                <th>الحالة</th>
                <th>الأولوية</th>
                <th>الموافقات</th>
                <th>الاستحقاق</th>
                <th>المكلّف</th>
              </tr>
            </thead>
            <tbody>
              {workflow.rows.length === 0 ? (
                <tr><td colSpan={7} className="empty">لا توجد طلبات مطابقة.</td></tr>
              ) : (
                workflow.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        className="admin-button secondary"
                        onClick={() => setWorkflow((prev) => ({ ...prev, selectedRequestId: row.id, message: "" }))}
                      >
                        {row.title}
                      </button>
                    </td>
                    <td>{row.candidate_no} - {row.first_name} {row.last_name}</td>
                    <td>{row.status}</td>
                    <td>{row.priority}</td>
                    <td>{formatNumber(row.approval_count)} / {formatNumber(row.required_approvals)}</td>
                    <td>{formatDateTime(row.due_at)}</td>
                    <td>{row.assigned_username || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-grid admin-two-columns">
          <div className="admin-card">
            <h3>القرار</h3>
            {selectedWorkflowRequest ? (
              <div className="admin-filter-row">
                <strong>{selectedWorkflowRequest.title}</strong>
                <span>{selectedWorkflowRequest.request_type} - {selectedWorkflowRequest.status}</span>
                <span>{selectedWorkflowRequest.candidate_no} - {selectedWorkflowRequest.first_name} {selectedWorkflowRequest.last_name}</span>
              </div>
            ) : (
              <p className="empty">اختر طلباً من الجدول.</p>
            )}
            <form className="admin-form" onSubmit={saveWorkflowDecision}>
              <select
                className="admin-select"
                value={workflowDecisionForm.decision}
                onChange={(event) => setWorkflowDecisionForm((prev) => ({ ...prev, decision: event.target.value }))}
              >
                <option value="in_review">إعادة للمراجعة</option>
                <option value="approve">موافقة</option>
                <option value="reject">رفض</option>
                <option value="escalate">تصعيد</option>
              </select>
              <input
                className="admin-input"
                type="number"
                min="1"
                placeholder="عدد الموافقات المطلوبة (اختياري)"
                value={workflowDecisionForm.requiredApprovals}
                onChange={(event) => setWorkflowDecisionForm((prev) => ({ ...prev, requiredApprovals: event.target.value }))}
              />
              <input
                className="admin-input"
                placeholder="ملاحظة القرار"
                value={workflowDecisionForm.note}
                onChange={(event) => setWorkflowDecisionForm((prev) => ({ ...prev, note: event.target.value }))}
              />
              <button className="admin-button" type="submit" disabled={!workflow.selectedRequestId || workflow.loading}>
                تنفيذ القرار
              </button>
            </form>
          </div>

          <div className="admin-card">
            <h3>التعيين والتعليقات</h3>
            <form className="admin-form" onSubmit={saveWorkflowAssignment}>
              <select
                className="admin-select"
                value={workflowAssignForm.assignedTo}
                onChange={(event) => setWorkflowAssignForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
              >
                <option value="">بدون مكلّف</option>
                {workflowOptions.assignees.map((assignee) => (
                  <option key={`assign-${assignee.id}`} value={assignee.id}>{assignee.username}</option>
                ))}
              </select>
              <select
                className="admin-select"
                value={workflowAssignForm.priority}
                onChange={(event) => setWorkflowAssignForm((prev) => ({ ...prev, priority: event.target.value }))}
              >
                {workflowOptions.priorities.map((priorityValue) => (
                  <option key={`assign-priority-${priorityValue}`} value={priorityValue}>{priorityValue}</option>
                ))}
              </select>
              <input
                className="admin-input"
                type="datetime-local"
                value={workflowAssignForm.dueAt}
                onChange={(event) => setWorkflowAssignForm((prev) => ({ ...prev, dueAt: event.target.value }))}
              />
              <input
                className="admin-input"
                placeholder="ملاحظة التعيين"
                value={workflowAssignForm.note}
                onChange={(event) => setWorkflowAssignForm((prev) => ({ ...prev, note: event.target.value }))}
              />
              <button className="admin-button" type="submit" disabled={!workflow.selectedRequestId || workflow.loading}>
                حفظ التعيين
              </button>
            </form>
            <form className="admin-form" onSubmit={saveWorkflowComment}>
              <input
                className="admin-input"
                placeholder="تعليق إضافي"
                value={workflowComment}
                onChange={(event) => setWorkflowComment(event.target.value)}
              />
              <button className="admin-button secondary" type="submit" disabled={!workflow.selectedRequestId || workflow.loading}>
                إضافة تعليق
              </button>
            </form>
          </div>
        </div>

        <div className="admin-card">
          <h3>سجل القرارات</h3>
          <div className="info-list">
            {workflow.actions.length === 0 ? (
              <p className="empty">لا يوجد سجل إجراءات.</p>
            ) : (
              workflow.actions.map((action) => (
                <div className="info-row" key={action.id}>
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
      </section>
    );
  }

  if (activeTab === "cohorts") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>إدارة الدورات والفصائل</h2>
        </div>
        <div className="admin-grid admin-two-columns">
          <div className="admin-card">
            <h3>إضافة دورة</h3>
            <form className="admin-form" onSubmit={saveCohort}>
              <input className="admin-input" placeholder="رقم الدورة" value={cohortForm.cohortNo} onChange={(event) => setCohortForm((prev) => ({ ...prev, cohortNo: event.target.value }))} required />
              <input className="admin-input" placeholder="اسم الدورة" value={cohortForm.name} onChange={(event) => setCohortForm((prev) => ({ ...prev, name: event.target.value }))} required />
              <select className="admin-select" value={cohortForm.track} onChange={(event) => setCohortForm((prev) => ({ ...prev, track: event.target.value }))}>
                {TRACK_OPTIONS.map((track) => (
                  <option key={track} value={track}>{track}</option>
                ))}
              </select>
              <input className="admin-input" placeholder="سنة البداية" value={cohortForm.startYear} onChange={(event) => setCohortForm((prev) => ({ ...prev, startYear: event.target.value }))} />
              <button className="admin-button" type="submit">إضافة دورة</button>
            </form>

            <div className="admin-table compact">
              <table>
                <thead><tr><th>الرقم</th><th>الاسم</th><th>النوع</th><th>الفصائل</th><th>المرشحون</th></tr></thead>
                <tbody>
                  {cohortRows.length === 0 ? (
                    <tr><td colSpan={5} className="empty">لا توجد دورات.</td></tr>
                  ) : cohortRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.cohort_no}</td>
                      <td>{row.name}</td>
                      <td>{row.track}</td>
                      <td>{formatNumber(row.platoon_count)}</td>
                      <td>{formatNumber(row.candidate_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-card">
            <h3>إضافة فصيل</h3>
            <form className="admin-form" onSubmit={savePlatoon}>
              <select className="admin-select" value={platoonForm.cohortId} onChange={(event) => setPlatoonForm((prev) => ({ ...prev, cohortId: event.target.value }))} required>
                <option value="">اختر الدورة</option>
                {filters.cohorts.map((cohort) => (
                  <option key={`pl-${cohort.id}`} value={cohort.id}>{cohort.cohort_no}</option>
                ))}
              </select>
              <input className="admin-input" placeholder="رقم الفصيل" value={platoonForm.platoonNo} onChange={(event) => setPlatoonForm((prev) => ({ ...prev, platoonNo: event.target.value }))} required />
              <input className="admin-input" placeholder="اسم الفصيل" value={platoonForm.name} onChange={(event) => setPlatoonForm((prev) => ({ ...prev, name: event.target.value }))} required />
              <button className="admin-button" type="submit">إضافة فصيل</button>
            </form>

            <div className="admin-table compact">
              <table>
                <thead><tr><th>الدورة</th><th>الفصيل</th><th>الاسم</th><th>المرشحون</th></tr></thead>
                <tbody>
                  {platoonRows.length === 0 ? (
                    <tr><td colSpan={4} className="empty">لا توجد فصائل.</td></tr>
                  ) : platoonRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.cohort_no}</td>
                      <td>{row.platoon_no}</td>
                      <td>{row.name}</td>
                      <td>{formatNumber(row.candidate_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    );
  }
  if (activeTab === "academics") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>إدخال ومتابعة الدرجات الأكاديمية</h2>
          <button className="admin-button" onClick={saveGrades} disabled={academics.loading || !academics.assessmentId}>
            {academics.loading ? "..." : "حفظ الدرجات"}
          </button>
        </div>
        <div className="admin-filters wide">
          <select className="admin-select" value={academics.termId} onChange={(event) => setAcademics((prev) => ({ ...prev, termId: event.target.value, courseId: "", sectionId: "", assessmentId: "" }))}>
            <option value="">اختر الفصل</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
          <select className="admin-select" value={academics.courseId} onChange={(event) => setAcademics((prev) => ({ ...prev, courseId: event.target.value, sectionId: "", assessmentId: "" }))}>
            <option value="">كل المواد</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} - {course.title}
              </option>
            ))}
          </select>
          <select className="admin-select" value={academics.sectionId} onChange={(event) => setAcademics((prev) => ({ ...prev, sectionId: event.target.value, assessmentId: "" }))}>
            <option value="">اختر الشعبة</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.course_code} / {section.section_code}
              </option>
            ))}
          </select>
          <select className="admin-select" value={academics.assessmentId} onChange={(event) => setAcademics((prev) => ({ ...prev, assessmentId: event.target.value }))}>
            <option value="">اختر التقييم</option>
            {assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {assessment.name}
              </option>
            ))}
          </select>
        </div>
        {academics.error ? <div className="admin-state error">{academics.error}</div> : null}
        {academics.message ? <div className="admin-state">{academics.message}</div> : null}

        <div className="admin-table">
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
              {gradeRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    لا توجد بيانات درجات.
                  </td>
                </tr>
              ) : (
                gradeRows.map((row) => (
                  <tr key={row.candidate_id}>
                    <td>{row.candidate_no}</td>
                    <td>{row.first_name} {row.last_name}</td>
                    <td>
                      <input
                        className="admin-input grade-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={gradeEdits[row.candidate_id] !== undefined ? gradeEdits[row.candidate_id] : row.score ?? ""}
                        onChange={(event) =>
                          setGradeEdits((prev) => ({ ...prev, [row.candidate_id]: event.target.value }))
                        }
                      />
                    </td>
                    <td>{row.max_score}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  if (activeTab === "medical") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>الملف الطبي والتقارير الصحية</h2>
        </div>
        <div className="admin-filters wide">
          <input className="admin-input" placeholder="بحث بالاسم أو رقم المرشح" value={medicalFilters.search} onChange={(event) => setMedicalFilters((prev) => ({ ...prev, search: event.target.value }))} />
          <select className="admin-select" value={medicalFilters.cohortId} onChange={(event) => setMedicalFilters((prev) => ({ ...prev, cohortId: event.target.value, platoonId: "" }))}>
            <option value="">كل الدورات</option>
            {filters.cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>{cohort.cohort_no}</option>
            ))}
          </select>
          <select className="admin-select" value={medicalFilters.platoonId} onChange={(event) => setMedicalFilters((prev) => ({ ...prev, platoonId: event.target.value }))}>
            <option value="">كل الفصائل</option>
            {medicalPlatoons.map((platoon) => (
              <option key={platoon.id} value={platoon.id}>فصيل {platoon.platoon_no}</option>
            ))}
          </select>
          <select className="admin-select" value={medicalFilters.examTypeId} onChange={(event) => setMedicalFilters((prev) => ({ ...prev, examTypeId: event.target.value }))}>
            <option value="">كل أنواع الفحوصات</option>
            {medicalOptions.examTypes.map((examType) => (
              <option key={examType.id} value={examType.id}>{examType.name}</option>
            ))}
          </select>
          <button className="admin-button" onClick={() => loadMedical()} disabled={medical.loading}>
            {medical.loading ? "..." : "تحديث السجل"}
          </button>
        </div>

        {medical.error ? <div className="admin-state error">{medical.error}</div> : null}
        {medical.message ? <div className="admin-state">{medical.message}</div> : null}

        <div className="admin-metrics">
          <div className="metric-card"><span>الإجمالي</span><h3>{formatNumber(medical.summary.total)}</h3></div>
          <div className="metric-card"><span>مجدولة</span><h3>{formatNumber(medical.summary.scheduled)}</h3></div>
          <div className="metric-card"><span>مكتملة</span><h3>{formatNumber(medical.summary.completed)}</h3></div>
          <div className="metric-card"><span>لائق</span><h3>{formatNumber(medical.summary.fit)}</h3></div>
          <div className="metric-card"><span>غير لائق</span><h3>{formatNumber(medical.summary.unfit)}</h3></div>
        </div>

        <div className="admin-table">
          <table>
            <thead>
              <tr><th>المرشح</th><th>الفحص</th><th>الحالة</th><th>اللياقة</th><th>الملخص</th></tr>
            </thead>
            <tbody>
              {medical.rows.length === 0 ? (
                <tr><td colSpan={5} className="empty">لا توجد سجلات.</td></tr>
              ) : medical.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.candidate_no} - {row.first_name} {row.last_name}</td>
                  <td>{row.exam_name}</td>
                  <td>{row.status}</td>
                  <td>{row.fit_status || "-"}</td>
                  <td>{row.summary || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-grid admin-two-columns">
          <div className="admin-card">
            <h3>إضافة فحص طبي</h3>
            <form className="admin-form" onSubmit={saveMedicalExam}>
              <select className="admin-select" value={medical.examForm.candidateId} onChange={(event) => setMedical((prev) => ({ ...prev, examForm: { ...prev.examForm, candidateId: event.target.value } }))} required>
                <option value="">اختر المرشح</option>
                {candidateOptions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.candidate_no} - {candidate.first_name} {candidate.last_name}</option>
                ))}
              </select>
              <select className="admin-select" value={medical.examForm.examTypeId} onChange={(event) => setMedical((prev) => ({ ...prev, examForm: { ...prev.examForm, examTypeId: event.target.value } }))} required>
                <option value="">نوع الفحص</option>
                {medicalOptions.examTypes.map((examType) => (
                  <option key={examType.id} value={examType.id}>{examType.name}</option>
                ))}
              </select>
              <input className="admin-input" type="datetime-local" value={medical.examForm.scheduledAt} onChange={(event) => setMedical((prev) => ({ ...prev, examForm: { ...prev.examForm, scheduledAt: event.target.value } }))} />
              <button className="admin-button" type="submit">إضافة</button>
            </form>
          </div>

          <div className="admin-card">
            <h3>تحديث نتيجة الفحص</h3>
            <form className="admin-form" onSubmit={saveMedicalResult}>
              <select className="admin-select" value={medical.resultForm.examId} onChange={(event) => setMedical((prev) => ({ ...prev, resultForm: { ...prev.resultForm, examId: event.target.value } }))} required>
                <option value="">اختر الفحص</option>
                {medical.rows.map((row) => (
                  <option key={`mres-${row.id}`} value={row.id}>{row.candidate_no} - {row.exam_name}</option>
                ))}
              </select>
              <select className="admin-select" value={medical.resultForm.fitStatus} onChange={(event) => setMedical((prev) => ({ ...prev, resultForm: { ...prev.resultForm, fitStatus: event.target.value } }))}>
                {["fit", "unfit", "fit_with_limits"].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <input className="admin-input" placeholder="الملخص" value={medical.resultForm.summary} onChange={(event) => setMedical((prev) => ({ ...prev, resultForm: { ...prev.resultForm, summary: event.target.value } }))} />
              <button className="admin-button" type="submit">حفظ النتيجة</button>
            </form>
          </div>
        </div>

        <div className="admin-card">
          <h3>ملاحظة طبية</h3>
          <form className="admin-form" onSubmit={saveMedicalNote}>
            <select className="admin-select" value={medical.noteForm.candidateId} onChange={(event) => setMedical((prev) => ({ ...prev, noteForm: { ...prev.noteForm, candidateId: event.target.value } }))} required>
              <option value="">اختر المرشح</option>
              {candidateOptions.map((candidate) => (
                <option key={`mnote-${candidate.id}`} value={candidate.id}>{candidate.candidate_no} - {candidate.first_name} {candidate.last_name}</option>
              ))}
            </select>
            <input className="admin-input" placeholder="الملاحظة" value={medical.noteForm.note} onChange={(event) => setMedical((prev) => ({ ...prev, noteForm: { ...prev.noteForm, note: event.target.value } }))} required />
            <button className="admin-button" type="submit">حفظ</button>
          </form>
        </div>
      </section>
    );
  }
  if (activeTab === "attendance") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>الحضور والغياب والملخصات اليومية</h2>
        </div>
        <div className="admin-filters wide">
          <select className="admin-select" value={attendanceFilters.cohortId} onChange={(event) => setAttendanceFilters((prev) => ({ ...prev, cohortId: event.target.value, platoonId: "" }))}>
            <option value="">كل الدورات</option>
            {filters.cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>{cohort.cohort_no}</option>
            ))}
          </select>
          <select className="admin-select" value={attendanceFilters.platoonId} onChange={(event) => setAttendanceFilters((prev) => ({ ...prev, platoonId: event.target.value }))}>
            <option value="">كل الفصائل</option>
            {attendancePlatoons.map((platoon) => (
              <option key={platoon.id} value={platoon.id}>فصيل {platoon.platoon_no}</option>
            ))}
          </select>
          <input className="admin-input" type="date" value={attendanceFilters.from} onChange={(event) => setAttendanceFilters((prev) => ({ ...prev, from: event.target.value }))} />
          <input className="admin-input" type="date" value={attendanceFilters.to} onChange={(event) => setAttendanceFilters((prev) => ({ ...prev, to: event.target.value }))} />
          <button className="admin-button" onClick={() => loadAttendance()} disabled={attendance.loading}>
            {attendance.loading ? "..." : "تحديث الملخص"}
          </button>
        </div>

        {attendance.error ? <div className="admin-state error">{attendance.error}</div> : null}
        {attendance.message ? <div className="admin-state">{attendance.message}</div> : null}

        <div className="admin-metrics">
          <div className="metric-card"><span>الإجمالي</span><h3>{formatNumber(attendance.summary.total)}</h3></div>
          <div className="metric-card"><span>الحضور</span><h3>{formatNumber(attendance.summary.present)}</h3></div>
          <div className="metric-card"><span>الغياب</span><h3>{formatNumber(attendance.summary.absent)}</h3></div>
        </div>

        <div className="admin-table">
          <table>
            <thead><tr><th>رقم المرشح</th><th>الاسم</th><th>الدورة</th><th>الفصيل</th><th>الحضور</th><th>الغياب</th><th>النسبة</th></tr></thead>
            <tbody>
              {attendance.roster.length === 0 ? (
                <tr><td colSpan={7} className="empty">لا توجد بيانات.</td></tr>
              ) : attendance.roster.map((row) => (
                <tr key={`att-${row.candidate_id}`}>
                  <td>{row.candidate_no}</td>
                  <td>{row.first_name} {row.last_name}</td>
                  <td>{row.cohort_no || "-"}</td>
                  <td>{row.platoon_no || "-"}</td>
                  <td>{formatNumber(row.present_sessions)}</td>
                  <td>{formatNumber(row.absent_sessions)}</td>
                  <td>{formatNumber(row.attendance_rate)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-card">
          <h3>إدخال جلسة جديدة</h3>
          <div className="admin-filters wide">
            <select className="admin-select" value={attendance.sectionId} onChange={(event) => setAttendance((prev) => ({ ...prev, sectionId: event.target.value }))}>
              <option value="">اختر الشعبة</option>
              {attendance.sections.map((section) => (
                <option key={section.id} value={section.id}>{section.course_code} / {section.section_code}</option>
              ))}
            </select>
            <input className="admin-input" type="datetime-local" value={attendance.sessionAt} onChange={(event) => setAttendance((prev) => ({ ...prev, sessionAt: event.target.value }))} />
            <input className="admin-input" placeholder="موضوع الجلسة" value={attendance.topic} onChange={(event) => setAttendance((prev) => ({ ...prev, topic: event.target.value }))} />
            <button className="admin-button" onClick={loadAttendanceEntryRows} disabled={!attendance.sectionId || attendance.loading}>تحميل الكشف</button>
          </div>
          <div className="admin-table">
            <table>
              <thead><tr><th>رقم المرشح</th><th>الاسم</th><th>حضور</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {attendance.rows.length === 0 ? (
                  <tr><td colSpan={4} className="empty">لا توجد بيانات إدخال.</td></tr>
                ) : attendance.rows.map((row) => (
                  <tr key={`arow-${row.candidateId}`}>
                    <td>{row.candidateNo}</td>
                    <td>{row.fullName}</td>
                    <td>
                      <input type="checkbox" checked={Boolean(row.present)} onChange={(event) => setAttendance((prev) => ({ ...prev, rows: prev.rows.map((item) => item.candidateId === row.candidateId ? { ...item, present: event.target.checked } : item) }))} />
                    </td>
                    <td>
                      <input className="admin-input" value={row.note} onChange={(event) => setAttendance((prev) => ({ ...prev, rows: prev.rows.map((item) => item.candidateId === row.candidateId ? { ...item, note: event.target.value } : item) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="admin-button" onClick={saveAttendanceSession} disabled={attendance.loading || attendance.rows.length === 0}>
            حفظ الجلسة
          </button>
        </div>
      </section>
    );
  }
  if (activeTab === "reports") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>التقارير والملخصات</h2>
          <button className="admin-button" onClick={() => loadReports()} disabled={reports.loading}>
            {reports.loading ? "..." : "تحديث"}
          </button>
        </div>
        <div className="admin-filters wide">
          <select className="admin-select" value={reportFilters.cohortId} onChange={(event) => setReportFilters((prev) => ({ ...prev, cohortId: event.target.value, platoonId: "" }))}>
            <option value="">كل الدورات</option>
            {filters.cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>{cohort.cohort_no}</option>
            ))}
          </select>
          <select className="admin-select" value={reportFilters.platoonId} onChange={(event) => setReportFilters((prev) => ({ ...prev, platoonId: event.target.value }))}>
            <option value="">كل الفصائل</option>
            {reportPlatoons.map((platoon) => (
              <option key={platoon.id} value={platoon.id}>فصيل {platoon.platoon_no}</option>
            ))}
          </select>
          <input className="admin-input" type="date" value={reportFilters.from} onChange={(event) => setReportFilters((prev) => ({ ...prev, from: event.target.value }))} />
          <input className="admin-input" type="date" value={reportFilters.to} onChange={(event) => setReportFilters((prev) => ({ ...prev, to: event.target.value }))} />
        </div>
        {reports.error ? <div className="admin-state error">{reports.error}</div> : null}

        <div className="admin-metrics">
          <div className="metric-card"><span>إجمالي المرشحين</span><h3>{formatNumber(reports.advanced?.summary?.totalCandidates)}</h3></div>
          <div className="metric-card"><span>طلبات معلقة</span><h3>{formatNumber(reports.advanced?.summary?.pendingRequests)}</h3></div>
          <div className="metric-card"><span>معدل الحضور</span><h3>{formatNumber(reports.advanced?.summary?.attendanceRate)}%</h3></div>
          <div className="metric-card"><span>متوسط الدرجات</span><h3>{formatNumber(reports.advanced?.summary?.averageGrade)}</h3></div>
        </div>

        <div className="report-actions">
          <button className="admin-button secondary" onClick={() => exportReport("candidates", "csv")}>تصدير المرشحين CSV</button>
          <button className="admin-button secondary" onClick={() => exportReport("attendance", "csv")}>تصدير الحضور CSV</button>
          <button className="admin-button secondary" onClick={() => exportReport("grades", "csv")}>تصدير الدرجات CSV</button>
          <button className="admin-button secondary" onClick={() => exportReport("candidates", "pdf")}>تصدير المرشحين PDF</button>
          <button className="admin-button secondary" onClick={() => exportReport("attendance", "pdf")}>تصدير الحضور PDF</button>
          <button className="admin-button secondary" onClick={() => exportReport("grades", "pdf")}>تصدير الدرجات PDF</button>
        </div>

        <div className="admin-grid admin-two-columns">
          <div className="admin-card">
            <h3>حفظ التقرير</h3>
            <form className="admin-form" onSubmit={saveReport}>
              <input className="admin-input" placeholder="اسم التقرير" value={saveReportForm.name} onChange={(event) => setSaveReportForm((prev) => ({ ...prev, name: event.target.value }))} required />
              <input className="admin-input" placeholder="وصف التقرير" value={saveReportForm.description} onChange={(event) => setSaveReportForm((prev) => ({ ...prev, description: event.target.value }))} />
              <select className="admin-select" value={saveReportForm.reportType} onChange={(event) => setSaveReportForm((prev) => ({ ...prev, reportType: event.target.value }))}>
                <option value="executive">تنفيذي</option>
                <option value="operational">تشغيلي</option>
                <option value="academic">أكاديمي</option>
              </select>
              <button className="admin-button" type="submit">حفظ</button>
            </form>
          </div>

          <div className="admin-card">
            <h3>التقارير المحفوظة</h3>
            <div className="admin-table compact">
              <table>
                <thead><tr><th>الاسم</th><th>النوع</th><th>التاريخ</th><th>إجراء</th></tr></thead>
                <tbody>
                  {reports.saved.length === 0 ? (
                    <tr><td colSpan={4} className="empty">لا توجد تقارير.</td></tr>
                  ) : reports.saved.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.report_type}</td>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>
                        <button
                          className="admin-button secondary"
                          onClick={() => {
                            const saved = item.filters || {};
                            const mappedCohortId =
                              saved.cohortId ||
                              saved.cohort_id ||
                              (saved.cohortNo || saved.cohort_no
                                ? filters.cohorts.find(
                                    (cohort) =>
                                      Number(cohort.cohort_no) ===
                                      Number(saved.cohortNo || saved.cohort_no)
                                  )?.id
                                : "");
                            const mappedPlatoonId =
                              saved.platoonId ||
                              saved.platoon_id ||
                              (saved.platoonNo || saved.platoon_no
                                ? filters.platoons.find(
                                    (platoon) =>
                                      Number(platoon.platoon_no) ===
                                      Number(saved.platoonNo || saved.platoon_no)
                                  )?.id
                                : "");
                            const nextFilters = {
                              cohortId: mappedCohortId || "",
                              platoonId: mappedPlatoonId || "",
                              from: saved.from || saved.from_date || saved.dateFrom || "",
                              to: saved.to || saved.to_date || saved.dateTo || "",
                              termId: saved.termId || saved.term_id || "",
                              courseId: saved.courseId || saved.course_id || "",
                            };
                            setReportFilters(nextFilters);
                            loadReports(nextFilters);
                          }}
                        >
                          تطبيق
                        </button>{" "}
                        <button className="admin-button secondary" onClick={() => deleteSavedReport(item.id)}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    );
  }
  if (activeTab === "security") {
    activeContent = (
      <section className="admin-section">
        <div className="admin-section-header">
          <h2>الصلاحيات والأدوار</h2>
          <button className="admin-button" onClick={loadSecurity} disabled={security.loading}>
            {security.loading ? "..." : "تحديث"}
          </button>
        </div>
        {security.error ? <div className="admin-state error">{security.error}</div> : null}
        {security.message ? <div className="admin-state">{security.message}</div> : null}

        <div className="admin-grid admin-two-columns">
          <div className="admin-card">
            <h3>صلاحيات الدور</h3>
            <select className="admin-select" value={security.selectedRoleId} onChange={(event) => setSecurity((prev) => ({ ...prev, selectedRoleId: event.target.value }))}>
              <option value="">اختر الدور</option>
              {security.roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
            <div className="admin-pill-grid">
              {security.permissions.map((permission) => (
                <label className="admin-pill" key={permission.id}>
                  <input
                    type="checkbox"
                    checked={security.roleDraft.includes(permission.id)}
                    onChange={() =>
                      setSecurity((prev) => ({
                        ...prev,
                        roleDraft: toggleValue(permission.id, prev.roleDraft),
                      }))
                    }
                  />{" "}
                  {permission.code}
                </label>
              ))}
            </div>
            <button className="admin-button" onClick={saveRolePermissions}>حفظ صلاحيات الدور</button>
          </div>

          <div className="admin-card">
            <h3>أدوار المستخدم</h3>
            <select className="admin-select" value={security.selectedUserId} onChange={(event) => setSecurity((prev) => ({ ...prev, selectedUserId: event.target.value }))}>
              <option value="">اختر المستخدم</option>
              {security.users.map((user) => (
                <option key={user.user_id} value={user.user_id}>{user.username}</option>
              ))}
            </select>
            <div className="admin-pill-grid">
              {security.roles.map((role) => (
                <label className="admin-pill" key={`u-${role.id}`}>
                  <input
                    type="checkbox"
                    checked={security.userDraft.includes(role.id)}
                    onChange={() =>
                      setSecurity((prev) => ({
                        ...prev,
                        userDraft: toggleValue(role.id, prev.userDraft),
                      }))
                    }
                  />{" "}
                  {role.name}
                </label>
              ))}
            </div>
            <button className="admin-button" onClick={saveUserRoles}>حفظ أدوار المستخدم</button>
          </div>
        </div>

        <div className="admin-card">
          <h3>سياسات الرتب</h3>
          <div className="admin-filters wide">
            <select className="admin-select" value={security.selectedRankId} onChange={(event) => setSecurity((prev) => ({ ...prev, selectedRankId: event.target.value }))}>
              <option value="">اختر الرتبة</option>
              {security.ranks.map((rank) => (
                <option key={rank.id} value={rank.id}>{rank.name}</option>
              ))}
            </select>
            <button className="admin-button" onClick={saveRankPolicies}>حفظ سياسة الرتبة</button>
            <button className="admin-button secondary" onClick={applyRankPolicies}>تطبيق على الموظفين</button>
          </div>
          <div className="admin-pill-grid">
            {security.roles.map((role) => (
              <label className="admin-pill" key={`r-${role.id}`}>
                <input
                  type="checkbox"
                  checked={security.rankDraft.includes(role.id)}
                  onChange={() =>
                    setSecurity((prev) => ({
                      ...prev,
                      rankDraft: toggleValue(role.id, prev.rankDraft),
                    }))
                  }
                />{" "}
                {role.name}
              </label>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="admin-portal">
      <header className="admin-header">
        <div className="admin-header-content">
          <div>
            <h1>بوابة المسؤول</h1>
            <p>إدارة متكاملة للمرشحين والأكاديمية والصحة والانضباط.</p>
          </div>
          <div className="admin-header-actions">
            <span className="admin-role-pill">الأدوار: {roles.join(", ") || "-"}</span>
            <button className="admin-logout" onClick={logout}>
              تسجيل الخروج
            </button>
          </div>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav className="admin-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`admin-nav-item ${activeTab === item.key ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(item.key);
                  if (item.key === "security" && security.roles.length === 0) {
                    loadSecurity();
                  }
                  if (item.key === "workflow" && workflowOptions.statuses.length === 0) {
                    loadWorkflowFilters().catch((error) =>
                      setWorkflow((prev) => ({ ...prev, error: error.message }))
                    );
                  }
                  if (item.key === "workflow" && workflow.rows.length === 0) {
                    loadWorkflow().catch((error) =>
                      setWorkflow((prev) => ({ ...prev, error: error.message }))
                    );
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="admin-content">{activeContent}</main>
      </div>
    </div>
  );
}
