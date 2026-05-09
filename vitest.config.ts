import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    globalSetup: ["src/test/globalSetup.ts"],
    include: ["src/test/**/*.test.ts"],
  },
});
