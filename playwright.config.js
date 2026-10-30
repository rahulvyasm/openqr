import { defineConfig } from "@playwright/test";

// Visual regression for the public experience pages and Experience Studio.
// Run `npm run test:visual`. Baselines are per operating system, so refresh them
// with `npm run test:visual:update` on the machine you check from.
const port = 3210;
export default defineConfig({
  testDir: "visual",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.015, animations: "disabled" },
  },
  use: {
    // Windows baselines come from the installed Edge. Set VISUAL_CHANNEL (msedge, chrome)
    // to choose another installed browser; elsewhere Playwright's own Chromium is used.
    ...((process.env.VISUAL_CHANNEL ?? (process.platform === "win32" ? "msedge" : ""))
      ? {
          channel:
            process.env.VISUAL_CHANNEL ??
            (process.platform === "win32" ? "msedge" : undefined),
        }
      : {}),
    baseURL: `http://127.0.0.1:${port}`,
    reducedMotion: "reduce",
    colorScheme: "dark",
    locale: "en-GB",
    timezoneId: "UTC",
  },
  webServer: {
    command: `node visual/serve.js`,
    url: `http://127.0.0.1:${port}/health/ready`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VISUAL_PORT: String(port) },
  },
});
