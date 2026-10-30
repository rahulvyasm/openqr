import { defineConfig } from "@playwright/test";

// README screenshots, kept separate from the visual regression suite.
const port = 3210;
export default defineConfig({
  testDir: "scripts",
  testMatch: "docs-screenshots.spec.js",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-GB",
    ...(process.env.VISUAL_CHANNEL ?? (process.platform === "win32" ? "msedge" : "")
      ? { channel: process.env.VISUAL_CHANNEL ?? "msedge" }
      : {}),
  },
  webServer: {
    command: "node visual/serve.js",
    url: `http://127.0.0.1:${port}/health/ready`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VISUAL_PORT: String(port) },
  },
});
