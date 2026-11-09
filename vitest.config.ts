import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // End-to-end tests start real MCP servers as child processes.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
