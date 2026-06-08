import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In Docker the backend is reachable via the compose service name
// (e.g. http://backend:8000). On a host dev machine it's localhost:8000.
// Override with VITE_API_PROXY_TARGET in .env / docker-compose to point elsewhere.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
