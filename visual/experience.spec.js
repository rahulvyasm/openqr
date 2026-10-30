import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3210";
const headers = { origin };
const owner = {
  name: "Visual Owner",
  email: "visual@example.com",
  password: "a-secure-test-password",
};
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
      { id: "q3", label: "Rating", type: "rating", required: false, options: [] },
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

// Must run before setup: it is the first thing a new owner sees.
test("landing page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(".landing")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveScreenshot("landing.png");
});

test("prepare content", async ({ page }) => {
  const api = page.request;
  expect((await api.post("/api/auth/setup", { headers, data: owner })).status()).toBe(201);
  const made = await api.post("/api/codes", {
    headers,
    data: {
      name: "Aero kettle",
      type: "experience",
      dynamic: true,
      slug: "visual-aero",
      data: { title: "Meet the Aero kettle", blocks: JSON.stringify(blocks) },
    },
  });
  expect(made.status()).toBe(201);
  const code = await made.json();
  const items = await api.post(`/api/codes/${code.id}/experience/items`, {
    headers,
    data: {
      items: [
        { name: "Aero #001", serial: "SN-0001", warrantyUntil: "2099-12-31" },
        { name: "Aero #002", serial: "SN-0002", warrantyUntil: "2001-01-31" },
      ],
    },
  });
  expect(items.status()).toBe(201);
  const [one] = await items.json();
  await api.post(`/api/codes/${code.id}/experience/items/${one.id}/service`, {
    headers,
    data: { date: "2026-02-10", note: "Replaced the filter" },
  });
  await api.put(`/api/codes/${code.id}/experience/settings`, {
    headers,
    data: { timeZone: "UTC" },
  });
});

test.describe("public pages on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("experience page", async ({ page }) => {
    await page.goto("/r/visual-aero");
    await expect(page.getByRole("heading", { name: "Meet the Aero kettle" })).toBeVisible();
    await expect(page).toHaveScreenshot("experience-page.png", { fullPage: true });
  });
});

test.describe("studio", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post("/api/auth/login", {
      headers,
      data: { email: owner.email, password: owner.password },
    });
    expect(res.status()).toBe(200);
    await page.goto("/");
    await page.getByRole("button", { name: /QR workspace/ }).click();
    await page.getByRole("button", { name: "Actions for Aero kettle" }).click();
    await page.getByRole("button", { name: "Experience Studio" }).click();
    await expect(page.locator("dialog.modal[open] .xs")).toBeVisible();
    await expect(
      page.frameLocator(".xs-phone iframe").getByText("Meet the Aero kettle"),
    ).toBeVisible();
  });

  const studio = (page) => page.locator("dialog.modal[open]");

  test("build tab", async ({ page }) => {
    await expect(studio(page)).toHaveScreenshot("studio-build.png");
  });

  test("a block open for editing", async ({ page }) => {
    await page.locator(".xs-toggle", { hasText: "Register your warranty" }).click();
    await expect(studio(page)).toHaveScreenshot("studio-form-block.png");
  });

  test("items tab", async ({ page }) => {
    await page.getByRole("tab", { name: "Items" }).click();
    await page
      .locator(".xs-items > li", { hasText: "Aero #001" })
      .locator(".xs-toggle")
      .click();
    await expect(page.locator(".xs-service li")).toHaveCount(1);
    await expect(studio(page)).toHaveScreenshot("studio-items.png", {
      mask: [page.locator('.xs-service-add input[type="date"]')],
    });
  });

  test("results explain actions per scan without a conversion percentage", async ({ page }) => {
    await page.getByRole("tab", { name: "Results" }).click();
    const metric = studio(page).locator(".xs-metrics > div").filter({ hasText: "Actions per scan" });
    await expect(metric.locator("strong")).toHaveText("0.00");
    await expect(studio(page).getByText(/includes repeat taps/)).toBeVisible();
    await expect(studio(page).getByText("Action rate", { exact: true })).toHaveCount(0);
  });
});

test.describe("item page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the item's own details", async ({ page }) => {
    await page.request.post("/api/auth/login", {
      headers,
      data: { email: owner.email, password: owner.password },
    });
    const codes = await (await page.request.get("/api/codes")).json();
    const item = codes.find((c) => c.name === "Aero #001");
    await page.goto(`/r/${item.slug}`);
    await expect(page.getByText("SN-0001")).toBeVisible();
    await expect(page.getByText("Replaced the filter")).toBeVisible();
    await expect(page).toHaveScreenshot("item-page.png", { fullPage: true });
  });
});
