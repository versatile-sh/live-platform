import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    globalSetup: ["./tests/live-server.ts"],
    testTimeout: 30000,
  },
});
