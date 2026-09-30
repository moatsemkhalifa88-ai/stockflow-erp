import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Tests are server code: resolve "server-only" the way the React server build does.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live tests hit a real database and only run via `npm run test:live`.
    exclude: ["tests/live/**", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
