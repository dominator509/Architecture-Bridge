import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3001";

function getPort() {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export default defineConfig(({ command }) => {
  const port = command === "serve" ? getPort() : undefined;
  const basePath = process.env.BASE_PATH ?? "/";

  return {
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    ...(port === undefined ? {} : { port }),
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
          });
        },
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    ...(port === undefined ? {} : { port }),
    host: "0.0.0.0",
    allowedHosts: true,
  },
  };
});
