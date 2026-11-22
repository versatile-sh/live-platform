import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": process.env.LIVE_HTTP ?? "http://127.0.0.1:8080",
      "/ws": { target: process.env.LIVE_SIGNAL?.replace(/\/ws$/, "") ?? "ws://127.0.0.1:8081", ws: true },
    },
  },
  build: {
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.live.test.ts"],
  },
});
