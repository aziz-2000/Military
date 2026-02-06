import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./UploadPortal.css";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const STORAGE_TOKEN_KEY = "xmx_portal_token";
const STORAGE_ROLES_KEY = "xmx_portal_roles";

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
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || "Unexpected error.");
    error.status = response.status;
    throw error;
  }

  if (isBlob) {
    return response.blob();
  }

  return response.json().catch(() => ({}));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64] = result.split(",");
      resolve(base64 || "");
    };
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

export default function UploadPortal() {
  const navigate = useNavigate();
  const token = localStorage.getItem(STORAGE_TOKEN_KEY);
  const roles = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_ROLES_KEY) || "[]");
    } catch {
      return [];
    }
  }, []);

  const [filesState, setFilesState] = useState({
    rows: [],
    loading: true,
    error: "",
    search: "",
    entityType: "",
  });
  const [uploadForm, setUploadForm] = useState({
    file: null,
    entityType: "",
    entityId: "",
    visibility: "private",
    note: "",
  });
  const [formState, setFormState] = useState({
    loading: false,
    error: "",
    message: "",
  });

  const loadFiles = async () => {
    if (!token) return;
    setFilesState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const params = new URLSearchParams();
      if (filesState.search) params.set("search", filesState.search);
      if (filesState.entityType) params.set("entity_type", filesState.entityType);
      params.set("limit", "100");
      const payload = await apiRequest(`/upload/files?${params.toString()}`, { token });
      setFilesState((prev) => ({
        ...prev,
        rows: payload.rows || [],
        loading: false,
      }));
    } catch (error) {
      setFilesState((prev) => ({
        ...prev,
        loading: false,
        error: error.message,
      }));
    }
  };

  useEffect(() => {
    if (!token) {
      setFilesState((prev) => ({
        ...prev,
        loading: false,
        error: "Please login first.",
      }));
      return;
    }
    loadFiles();
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_ROLES_KEY);
    navigate("/student-portal");
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!uploadForm.file) {
      setFormState((prev) => ({ ...prev, error: "Please select a file." }));
      return;
    }

    setFormState({ loading: true, error: "", message: "" });
    try {
      const contentBase64 = await fileToBase64(uploadForm.file);
      await apiRequest("/upload/files", {
        method: "POST",
        token,
        body: {
          originalName: uploadForm.file.name,
          mimeType: uploadForm.file.type || "application/octet-stream",
          visibility: uploadForm.visibility,
          entityType: uploadForm.entityType || null,
          entityId: uploadForm.entityId || null,
          note: uploadForm.note || null,
          contentBase64,
        },
      });
      setFormState({
        loading: false,
        error: "",
        message: "File uploaded successfully.",
      });
      setUploadForm({
        file: null,
        entityType: "",
        entityId: "",
        visibility: "private",
        note: "",
      });
      loadFiles();
    } catch (error) {
      setFormState({
        loading: false,
        error: error.message,
        message: "",
      });
    }
  };

  const handleDownload = async (fileId, originalName) => {
    try {
      const blob = await apiRequest(`/upload/files/${fileId}/download`, {
        token,
        isBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = originalName || "file";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFormState((prev) => ({
        ...prev,
        error: error.message,
      }));
    }
  };

  return (
    <div className="upload-portal">
      <header className="upload-header">
        <div>
          <h1>بوابة رفع البيانات</h1>
          <p>رفع الملفات وربطها بالكيانات الرسمية مع حفظ الأثر المرجعي.</p>
        </div>
        <div className="upload-actions">
          <span className="upload-role">Roles: {roles.join(", ") || "-"}</span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <section className="upload-card">
        <h2>رفع ملف جديد</h2>
        <form className="upload-form" onSubmit={handleUpload}>
          <input
            className="upload-input"
            type="file"
            onChange={(event) =>
              setUploadForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))
            }
            required
          />
          <input
            className="upload-input"
            type="text"
            placeholder="Entity Type (candidate/request/exam)"
            value={uploadForm.entityType}
            onChange={(event) =>
              setUploadForm((prev) => ({ ...prev, entityType: event.target.value }))
            }
          />
          <input
            className="upload-input"
            type="text"
            placeholder="Entity ID (UUID)"
            value={uploadForm.entityId}
            onChange={(event) =>
              setUploadForm((prev) => ({ ...prev, entityId: event.target.value }))
            }
          />
          <select
            className="upload-select"
            value={uploadForm.visibility}
            onChange={(event) =>
              setUploadForm((prev) => ({ ...prev, visibility: event.target.value }))
            }
          >
            <option value="private">private</option>
            <option value="department">department</option>
            <option value="role_based">role_based</option>
            <option value="public">public</option>
          </select>
          <input
            className="upload-input"
            type="text"
            placeholder="Note"
            value={uploadForm.note}
            onChange={(event) => setUploadForm((prev) => ({ ...prev, note: event.target.value }))}
          />
          <button className="upload-button" type="submit" disabled={formState.loading}>
            {formState.loading ? "Uploading..." : "Upload File"}
          </button>
        </form>
        {formState.error && <div className="upload-state error">{formState.error}</div>}
        {formState.message && <div className="upload-state">{formState.message}</div>}
      </section>

      <section className="upload-card">
        <h2>سجل الملفات</h2>
        <div className="upload-filters">
          <input
            className="upload-input"
            type="text"
            placeholder="Search by filename"
            value={filesState.search}
            onChange={(event) =>
              setFilesState((prev) => ({ ...prev, search: event.target.value }))
            }
          />
          <input
            className="upload-input"
            type="text"
            placeholder="Entity type"
            value={filesState.entityType}
            onChange={(event) =>
              setFilesState((prev) => ({ ...prev, entityType: event.target.value }))
            }
          />
          <button className="upload-button secondary" onClick={loadFiles}>
            Refresh
          </button>
        </div>

        {filesState.loading && <div className="upload-state">Loading files...</div>}
        {filesState.error && <div className="upload-state error">{filesState.error}</div>}
        {!filesState.loading && !filesState.error && (
          <div className="upload-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Entity</th>
                  <th>Size</th>
                  <th>Visibility</th>
                  <th>Uploaded At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filesState.rows.length === 0 && (
                  <tr>
                    <td colSpan="6">No files found.</td>
                  </tr>
                )}
                {filesState.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.original_name}</td>
                    <td>
                      {row.entity_type || "-"} {row.entity_id || ""}
                    </td>
                    <td>{row.size_bytes || 0}</td>
                    <td>{row.visibility}</td>
                    <td>{row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : "-"}</td>
                    <td>
                      <button
                        className="upload-button secondary"
                        onClick={() => handleDownload(row.id, row.original_name)}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
