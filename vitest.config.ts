import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Slow tests (the real Transcriber) run only with `npm run test:slow`.
    exclude: process.env.SLOW_TESTS ? [] : ["test/**/*.slow.test.ts"],
    // The first run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
  },
});
