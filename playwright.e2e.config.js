import { defineConfig } from "@playwright/test";

// Behavior tests for the free generator and the interactive demo (the static lite site).
// Run `npm run test:e2e`; it builds the site first and serves the build.
const port = 4280;
const channel = process.env.VISUAL_CHANNEL ?? (process.platform === "win32" ? "msedge" : "");
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    reducedMotion: "reduce",
    acceptDownloads: true,
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview -c vite.lite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
