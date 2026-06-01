import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

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
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    ...(port === undefined ? {} : { port }),
    host: "0.0.0.0",
    allowedHosts: true,
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
