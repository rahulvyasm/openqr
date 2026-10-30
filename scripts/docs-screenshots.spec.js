// Regenerates the README screenshots from a fresh, throwaway installation.
// Run with: npm run docs:screenshots
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:3210";
const headers = { origin };
const owner = {
  name: "Maya Rao",
  email: "maya@example.com",
  password: "a-secure-demo-password",
};
const out = (name) => resolve("docs", name);
const shot = { type: "jpeg", quality: 86 };

const blocks = [
  { id: "head1", type: "heading", text: "Meet the Aero kettle", subtext: "Everything you need, in one place." },
  { id: "item1", type: "item", title: "Your kettle" },
  { id: "text1", type: "text", text: "Fill to the line, press the button and enjoy. Descale every three months." },
  { id: "btn01", type: "button", label: "Read the setup guide", url: "https://example.com/guide" },
  {
    id: "form1",
    type: "form",
    title: "Register your warranty",
    intro: "Register once and we keep your purchase on file.",
    submitLabel: "Register",
    successMessage: "You are registered.",
    fields: [
      { id: "q1", label: "Your name", type: "text", required: true, options: [] },
      { id: "q2", label: "Email", type: "email", required: true, options: [] },
    ],
  },
  {
    id: "form2",
    type: "form",
    title: "Report a problem",
    intro: "",
    submitLabel: "Send report",
    successMessage: "Report received.",
    fields: [
      { id: "q1", label: "Serial number", type: "serial", required: false, options: [] },
      { id: "q2", label: "What happened?", type: "textarea", required: true, options: [] },
    ],
  },
];

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", colorScheme: "dark" });

test("landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".landing")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.locator(".l-close").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: out("landing.jpg"), ...shot });
});

test("create demo content", async ({ page }) => {
  const api = page.request;
  expect((await api.post("/api/auth/setup", { headers, data: owner })).status()).toBe(201);
  const make = async (data) => {
    const res = await api.post("/api/codes", { headers, data });
    expect(res.status()).toBe(201);
    return res.json();
  };
  const kettle = await make({
    name: "Aero kettle",
    type: "experience",
    dynamic: true,
    slug: "aero-kettle",
    color: "#163f32",
    data: { title: "Meet the Aero kettle", blocks: JSON.stringify(blocks) },
  });
  await make({ name: "Summer menu", type: "url", dynamic: true, data: { url: "https://example.com/menu" } });
  await make({
    name: "Studio North links",
    type: "links",
    dynamic: true,
    data: {
      title: "Studio North",
      description: "Design and print in Pune.",
      links: JSON.stringify([
        { title: "Portfolio", url: "https://example.com/work" },
        { title: "Book a call", url: "https://example.com/call" },
      ]),
    },
  });
  await make({ name: "Guest Wi-Fi", type: "wifi", dynamic: false, data: { ssid: "Studio-Guest", password: "welcome123", security: "WPA" } });
  await make({ name: "Launch event", type: "event", dynamic: false, data: { title: "Launch party", startsAt: "2027-03-12T17:00:00.000Z", endsAt: "2027-03-12T20:00:00.000Z", location: "Pune" } });
  const items = await api.post(`/api/codes/${kettle.id}/experience/items`, {
    headers,
    data: {
      items: [
        { name: "Aero #001", serial: "SN-0001", warrantyUntil: "2099-12-31" },
        { name: "Aero #002", serial: "SN-0002", warrantyUntil: "2099-12-31" },
      ],
    },
  });
  const [one] = await items.json();
  await api.post(`/api/codes/${kettle.id}/experience/items/${one.id}/service`, {
    headers,
    data: { date: "2026-02-10", note: "Replaced the filter" },
  });
  // A few scans so charts and counts are not empty.
  const codes = await (await api.get("/api/codes")).json();
  for (const code of codes.filter((c) => c.dynamic))
    for (let n = 0; n < 4 + (code.name.length % 5); n++) await fetch(`${origin}/r/${code.slug}`, { headers: { "user-agent": n % 3 ? "Mozilla/5.0 (iPhone) Mobile Safari" : "Mozilla/5.0 (Windows) Chrome" } });
  execFileSync(process.execPath, ["server/operator-cli.js", "grant", "--email", owner.email], {
    env: { ...process.env, DATA_DIR: resolve(".visual-data") },
  });
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post("/api/auth/login", {
      headers,
      data: { email: owner.email, password: owner.password },
    });
    expect(res.status()).toBe(200);
  });

  test("dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.goto("/");
    await page.getByRole("button", { name: /QR workspace/ }).click();
    await expect(page.getByText("Aero kettle").first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: out("dashboard.jpg"), ...shot });
  });

  test("designer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /QR workspace/ }).click();
    await page.locator(".launch-strip button", { hasText: "A website" }).click();
    await page.locator("input[placeholder*='summer']").fill("Summer menu");
    await page.locator(".editor-steps button").nth(1).click();
    await page.waitForTimeout(800);
    await page.locator("dialog.modal[open]").screenshot({ path: out("designer.jpg"), ...shot });
  });

  test("experience studio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /QR workspace/ }).click();
    await page.getByRole("button", { name: "Actions for Aero kettle" }).click();
    await page.getByRole("button", { name: "Experience Studio" }).click();
    await expect(page.frameLocator(".xs-phone iframe").getByText("Meet the Aero kettle")).toBeVisible();
    await page.locator(".xs-toggle", { hasText: "Register your warranty" }).click();
    await page.waitForTimeout(600);
    await page.locator("dialog.modal[open]").screenshot({ path: out("studio.jpg"), ...shot });
  });

  test("team", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Workspace settings/ }).click();
    await page.getByRole("button", { name: /^Team/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: out("team.jpg"), ...shot });
  });

  test("control room", async ({ page }) => {
    await page.goto("/control-room");
    await expect(page.getByText(/control room/i).first()).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: out("control-room.jpg"), ...shot });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("public pages", async ({ page }) => {
    await page.goto("/r/aero-kettle");
    await expect(page.getByRole("heading", { name: "Meet the Aero kettle" })).toBeVisible();
    await page.screenshot({ path: out("experience-mobile.jpg"), fullPage: false, ...shot });
    await page.request.post("/api/auth/login", { headers, data: { email: owner.email, password: owner.password } });
    const codes = await (await page.request.get("/api/codes")).json();
    const item = codes.find((c) => c.name === "Aero #001");
    await page.goto(`/r/${item.slug}`);
    await expect(page.getByText("SN-0001").first()).toBeVisible();
    await page.screenshot({ path: out("item-mobile.jpg"), fullPage: false, ...shot });
  });
});
