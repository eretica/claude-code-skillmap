import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/ はPlaywright管轄なのでvitestからは除外する
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
