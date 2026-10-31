import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../server/app.js";
import { setOperator } from "../server/operator.js";

test.describe("super-admin account grants", () => {
  test.describe.configure({ mode: "serial" });
  let instance, server, origin, ownerId;
  const password = "a-secure-test-password";
  test.beforeAll(async () => {
    // A separate in-memory instance keeps these tests independent of screenshot fixtures.
    server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    instance = createApp({
      dbPath: ":memory:",
      publicUrl: origin,
      hosting: { enabled: true },
    });
    server.on("request", instance.app);
    const made = await fetch(`${origin}/api/auth/setup`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Admin Owner",
        email: "admin@example.com",
        password,
      }),
    });
    expect(made.status).toBe(201);
    ownerId = instance.db.prepare("SELECT id FROM users").get().id;
    setOperator(instance.db, ownerId, true, "super_admin");
  });
  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    instance?.db.close();
    await instance?.storage.dispose();
  });

  test("grant unlimited to the owner and revoke it through the control room", async ({
    page,
  }, testInfo) => {
    await page.request.post(`${origin}/api/auth/login`, {
      headers: { origin },
      data: { email: "admin@example.com", password },
    });
    await page.goto(`${origin}/control-room`);
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await page
      .getByRole("button", { name: "Account access", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Admin Owner");
    await dialog.getByLabel("Account plan").selectOption("unlimited");
    await dialog
      .getByLabel("Reason for this change")
      .fill("Personal account for the service owner");
    await dialog.screenshot({ path: testInfo.outputPath("account-grant.png") });
    await dialog.getByLabel("Your company account password").fill(password);
    await dialog.getByRole("button", { name: "Save account access" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page
        .locator(".operator-table-wrap tbody tr")
        .filter({ hasText: "Admin Owner" }),
    ).toContainText("Unlimited");
    await page.getByRole("button", { name: "Plans & usage" }).click();
    await expect(
      page.getByRole("heading", { name: "Unlimited", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".plan-grid")).toContainText("Plus");
    await expect(page.locator(".plan-grid")).toContainText("Pro");
    await expect(
      page.locator(".plan-grid .plan-price").filter({ hasText: "Coming soon" }),
    ).toHaveCount(2);
    await expect(page.locator(".plan-grid")).not.toContainText("₹");
    await page.getByRole("button", { name: /Control room/ }).click();
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await page
      .getByRole("button", { name: "Account access", exact: true })
      .first()
      .click();
    await dialog.getByLabel("Account plan").selectOption("inherit");
    await dialog
      .getByLabel("Reason for this change")
      .fill("Restore normal free access");
    await dialog.getByLabel("Your company account password").fill(password);
    await dialog.getByRole("button", { name: "Save account access" }).click();
    await expect(dialog).not.toBeVisible();
    const saved = instance.db
      .prepare("SELECT value FROM config WHERE key=?")
      .get(`account-access:${ownerId}`);
    expect(saved).toBeUndefined();
  });
});
