import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5199",
    // ローカル/CIともにGoogle Chromeを使う(CIは `npx playwright install --with-deps chrome`)
    channel: "chrome",
  },
  webServer: [
    {
      command: "node e2e/mock-api.mjs",
      port: 8788,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev:cloud -- --port 5199 --strictPort",
      port: 5199,
      reuseExistingServer: false,
    },
  ],
});
