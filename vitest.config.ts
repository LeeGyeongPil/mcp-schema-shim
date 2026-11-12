import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pin the screen language to English; the language tests set their own environment explicitly.
    setupFiles: ["test/setup/lang.ts"],
    // End-to-end tests start real MCP servers as child processes.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
