import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { handle, admin, regular, gateway, seed } from "./test-fixture.js";
import { SITE } from "./api.js";
seed();
const app = express();
app.use(["/api", "/r"], express.raw({ type: () => true, limit: "20mb" }));
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/") && !req.path.startsWith("/r/"))
    return next();
  try {
    const headers = new Headers(req.headers);
    headers.set("x-openqr-gateway", gateway);
    headers.set("x-openqr-site", SITE);
    headers.set("x-openqr-ip", "local-browser");
    if (headers.get("origin") === origin) headers.set("origin", SITE);
    const response = await handle(
      new Request("https://function.test/openqr-api" + req.originalUrl, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      }),
    );
    res.status(response.status);
    for (const [k, v] of response.headers)
      if (k !== "set-cookie") res.setHeader(k, v);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Local test failed." });
  }
});
app.use(express.static(resolve("dist-hosted")));
app.get("/{*path}", (req, res) =>
  res.sendFile(resolve("dist-hosted/index.html")),
);
const server = createServer(app).listen(0, "127.0.0.1");
await once(server, "listening");
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator(".l-nav button").click();
  await page
    .getByRole("button", { name: "New here? Create a Free account" })
    .waitFor();
  await page
    .getByRole("button", { name: "New here? Create a Free account" })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("New beta member");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("beta-member@example.com");
  await page.getByLabel("Password", { exact: true }).fill("new-password-123");
  await page
    .getByRole("button", { name: "Create your workspace", exact: true })
    .click();
  await page
    .getByText("Check your email to confirm your account, then sign in.")
    .waitFor();
  await page.getByLabel("Email address", { exact: true }).fill(admin.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: /Control room/ }).waitFor();
  await page.getByRole("button", { name: "Plans & usage" }).click();
  await page.getByRole("heading", { name: "Unlimited", exact: true }).waitFor();
  await page.getByRole("button", { name: /QR workspace/ }).click();
  await page.locator(".launch-strip button", { hasText: "A website" }).click();
  await page.getByPlaceholder(/summer/i).fill("Hosted browser code");
  await page
    .locator("dialog[open] input[type=url]")
    .fill("https://example.com/browser");
  await page.locator(".editor-steps button").nth(2).click();
  await page.getByRole("button", { name: /Create QR code/ }).click();
  await page.locator(".code-row", { hasText: "Hosted browser code" }).waitFor();
  await page.getByRole("button", { name: /Control room/ }).click();
  await page.getByRole("button", { name: "Billing", exact: true }).click();
  await page
    .getByRole("button", { name: "Account access", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Account plan")
    .selectOption("plus");
  await page.getByLabel("Reason for this change").fill("Hosted beta test");
  await page
    .getByLabel("Your company account password")
    .fill("test-password-123");
  await page.getByRole("button", { name: "Save account access" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "Hosted browser check passed: signup verification, login, Unlimited, QR creation and admin grants.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
