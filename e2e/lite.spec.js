import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Any script error or failed request fails the test: these pages have no server to blame.
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && page.errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && page.errors.push(`${r.status()} ${r.url()}`));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

test.describe("free generator", () => {
  test("a website code downloads as PNG and as SVG", async ({ page }) => {
    await page.goto("/");
    const download = page.getByRole("button", { name: /Download PNG/ });
    await expect(download).toBeDisabled();
    await page.getByLabel("Website address").fill("https://openqr.riolet.si");
    await expect(download).toBeEnabled();
    const [png] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(png.suggestedFilename()).toBe("openqr-url.png");
    const bytes = await readFile(await png.path());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // a real PNG
    expect(bytes.length).toBeGreaterThan(2000);

    await page.getByRole("button", { name: "SVG" }).click();
    const [svg] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download SVG/ }).click()]);
    expect(svg.suggestedFilename()).toBe("openqr-url.svg");
    expect(await readFile(await svg.path(), "utf8")).toContain("<svg");
  });

  test("every type needs its required details before it can be downloaded", async ({ page }) => {
    await page.goto("/");
    for (const [type, fill] of [
      ["Wi-Fi", () => page.getByLabel("Network name").fill("Guest")],
      ["Phone", () => page.getByLabel("Phone number").fill("+91 98765 43210")],
      ["Contact card", () => page.getByLabel("Full name").fill("Maya Rao")],
      ["Location", async () => {
        await page.getByLabel("Latitude").fill("18.5204");
        await page.getByLabel("Longitude").fill("73.8567");
      }],
    ]) {
      await page.getByRole("tab", { name: type }).click();
      const download = page.getByRole("button", { name: /Download/ });
      await expect(download).toBeDisabled();
      await fill();
      await expect(download).toBeEnabled();
    }
  });

  test("styling controls change the code and the nothing-uploaded promise holds", async ({ page }) => {
    const outgoing = [];
    page.on("request", (r) => r.method() !== "GET" && outgoing.push(r.url()));
    await page.goto("/");
    await page.getByLabel("Website address").fill("https://example.com");
    const before = await page.locator(".lite-paper img").getAttribute("src");
    await page.getByRole("button", { name: /Style it/ }).click();
    await page.getByRole("button", { name: /Dots/ }).click();
    await expect(page.locator(".lite-paper img")).not.toHaveAttribute("src", before);
    await page.getByRole("button", { name: "Download PNG" }).click();
    expect(outgoing).toEqual([]);
  });

  test("see full potential opens the demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /See full potential/ }).first().click();
    await expect(page).toHaveURL(/\/demo\/?$/);
    await expect(page.locator(".sidebar")).toBeVisible();
  });
});

test.describe("interactive demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/");
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.getByText("LIVE DEMO")).toBeVisible();
  });

  test("shows a populated workspace with analytics", async ({ page }) => {
    await expect(page.locator(".code-row").first()).toBeVisible();
    await expect(page.getByText("Aero kettle").first()).toBeVisible();
    await page.locator(".nav-item", { hasText: "Analytics" }).click();
    await expect(page.locator(".scan-line").first()).toBeVisible();
  });

  test("a new code can be created and downloaded", async ({ page }) => {
    await page.locator(".launch-strip button", { hasText: "A website" }).click();
    await page.getByPlaceholder(/summer/i).fill("Demo menu");
    await page.locator("dialog[open] input[type=url]").fill("https://example.com/demo");
    await page.locator(".editor-steps button").nth(2).click();
    await page.getByRole("button", { name: /Create QR code/ }).click();
    const row = page.locator(".code-row", { hasText: "Demo menu" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Download/ }).click();
    const link = page.locator("dialog[open] a", { hasText: /Download/ });
    const [file] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(file.suggestedFilename()).toMatch(/^openqr-.+\.png$/);
  });

  test("Experience Studio edits, publishes and shows the visitor page", async ({ page }) => {
    await page.getByRole("button", { name: "Actions for Aero kettle" }).click();
    await page.getByRole("button", { name: "Experience Studio" }).click();
    await expect(page.frameLocator(".xs-phone iframe").getByText("Meet the Aero kettle")).toBeVisible();
    await page.locator(".xs-editor > label input").fill("Meet the Aero kettle v2");
    await page.getByRole("button", { name: /Publish/ }).click();
    await expect(page.locator(".xs-status")).toHaveText("Live");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("Version 2")).toBeVisible();
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByText("Aero #001").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Actions for Aero kettle" }).click();
    await page.getByRole("link", { name: /Open destination/ }).click();
    await expect(page.frameLocator("#demo-page iframe").getByRole("heading", { name: "Meet the Aero kettle" })).toBeVisible();
  });

  test("things that need a real server say so instead of failing", async ({ page }) => {
    await page.locator(".nav-item", { hasText: "Workspace settings" }).click();
    await page.getByRole("button", { name: /^My account/ }).click();
    await expect(page.getByText("Your name")).toBeVisible();
  });
});
