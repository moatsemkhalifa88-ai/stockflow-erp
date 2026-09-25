import { defineConfig } from "vitest/config";

// Tests against a real PostgreSQL server (DATABASE_URL). Run with `npm run test:live`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
