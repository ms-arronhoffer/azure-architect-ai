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
    build: {
      rollupOptions: {
        output: {
          // Split large, rarely-changing vendor code out of the app bundle so
          // the browser can cache it independently and the initial download
          // shrinks. Heavy export/format libraries (docx, xlsx, jspdf, jszip)
          // and the markdown/syntax-highlighter stack are isolated so they are
          // only fetched once a panel that needs them is opened.
          manualChunks: {
            "react-vendor": ["react", "react-dom"],
            "fluent-vendor": ["@fluentui/react-components", "@fluentui/react-icons"],
            "export-vendor": ["docx", "xlsx", "jspdf", "jspdf-autotable", "jszip"],
            "markdown-vendor": ["react-markdown", "remark-gfm", "react-syntax-highlighter"],
          },
        },
      },
    },
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
