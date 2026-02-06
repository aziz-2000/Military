import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const TOKEN_KEY = "xmx_portal_token";
const ROLES_KEY = "xmx_portal_roles";

async function fetchRoles(token) {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Unauthorized");
  }

  const data = await response.json();
  return data?.user?.roles || [];
}

export default function RequireRole({ allowedRoles, children }) {
  const [state, setState] = useState({
    loading: true,
    allowed: false,
  });

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ loading: false, allowed: false });
      return;
    }

    const storedRoles = localStorage.getItem(ROLES_KEY);
    if (storedRoles) {
      try {
        const roles = JSON.parse(storedRoles);
        const allowed = allowedRoles.some((role) => roles.includes(role));
        setState({ loading: false, allowed });
        return;
      } catch {
        localStorage.removeItem(ROLES_KEY);
      }
    }

    fetchRoles(token)
      .then((roles) => {
        localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
        const allowed = allowedRoles.some((role) => roles.includes(role));
        setState({ loading: false, allowed });
      })
      .catch(() => {
        setState({ loading: false, allowed: false });
      });
  }, [allowedRoles]);

  if (state.loading) {
    return (
      <div style={{ padding: "60px", textAlign: "center" }}>
        جارٍ التحقق من الصلاحيات...
      </div>
    );
  }

  if (!state.allowed) {
    return <Navigate to="/student-portal" replace />;
  }

  return children;
}
