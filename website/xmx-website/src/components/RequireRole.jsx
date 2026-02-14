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
  const initState = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      return { loading: false, roles: [] };
    }

    const storedRoles = localStorage.getItem(ROLES_KEY);
    if (storedRoles) {
      try {
        const roles = JSON.parse(storedRoles);
        return { loading: false, roles: Array.isArray(roles) ? roles : [] };
      } catch {
        localStorage.removeItem(ROLES_KEY);
      }
    }

    return { loading: true, roles: [] };
  };

  const [state, setState] = useState(initState);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !state.loading) {
      return;
    }

    let active = true;

    fetchRoles(token)
      .then((roles) => {
        if (!active) return;
        localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
        setState({ loading: false, roles });
      })
      .catch(() => {
        if (!active) return;
        setState({ loading: false, roles: [] });
      });

    return () => {
      active = false;
    };
  }, [state.loading]);

  const isAllowed = allowedRoles.some((role) => state.roles.includes(role));

  if (state.loading) {
    return (
      <div style={{ padding: "60px", textAlign: "center" }}>
        جارٍ التحقق من الصلاحيات...
      </div>
    );
  }

  if (!isAllowed) {
    return <Navigate to="/student-portal" replace />;
  }

  return children;
}
