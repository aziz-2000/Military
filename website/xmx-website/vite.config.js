import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const fallbackPort = env.PORT || "4300";
  const configuredBase = (env.VITE_API_BASE || "").trim();

  let proxyTarget = (env.VITE_API_PROXY_TARGET || "").trim();
  if (!proxyTarget) {
    if (configuredBase.startsWith("http://") || configuredBase.startsWith("https://")) {
      proxyTarget = new URL(configuredBase).origin;
    } else {
      proxyTarget = `http://localhost:${fallbackPort}`;
    }
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
