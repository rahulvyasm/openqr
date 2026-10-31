import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, urlCode } from "./helpers.js";
import { setOperator } from "../server/operator.js";

async function hosted(t) {
  const app = await fixture(t, ":memory:", {
    hosting: { enabled: true, creatorINR: 499, businessINR: 1499 },
  });
  await app.setup();
  return app;
}
async function setPlan(app, tier, status = "active") {
  const workspace = app.db
    .prepare("SELECT id FROM workspaces ORDER BY rowid LIMIT 1")
    .get();
  return app.request(`/api/operator/workspaces/${workspace.id}/plan`, {
    method: "POST",
    body: { tier, status, password: "a-secure-test-password" },
  });
}

test("hosted code caps are atomic across creation, duplication and bulk imports while existing links keep working", async (t) => {
  const app = await hosted(t),
    { request, db } = app;
  const summary = await (await request("/api/billing")).json();
  assert.equal(summary.currency, "INR");
  assert.equal(summary.current.codes, 25);
  assert.equal(summary.checkoutAvailable, false);
  assert.equal(
    summary.plans.find((plan) => plan.id === "plus").monthlyINR,
    null,
  );
  const batch = await request("/api/codes/bulk", {
    method: "POST",
    body: {
      codes: Array.from({ length: 24 }, (_, i) =>
        urlCode({ name: `Code ${i}` }),
      ),
    },
  });
  assert.equal(batch.status, 201);
  const codes = await batch.json();
  assert.equal(
    (
      await request("/api/codes/bulk", {
        method: "POST",
        body: { codes: [urlCode(), urlCode()] },
      })
    ).status,
    402,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM codes").get().n, 24);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE event='code.created'")
      .get().n,
    24,
  );
  assert.equal(
    (
      await request(`/api/codes/${codes[0].id}/duplicate`, {
        method: "POST",
        body: {},
      })
    ).status,
    201,
  );
  assert.equal(
    (await request("/api/codes", { method: "POST", body: urlCode() })).status,
    402,
  );
  assert.equal(
    (
      await request(`/api/codes/${codes[0].id}`, {
        method: "PUT",
        body: { ...codes[0], data: { url: "https://example.com/updated" } },
      })
    ).status,
    200,
  );
  const live = await request("/r/" + codes[0].slug, { authenticated: false });
  assert.equal(live.status, 302);
  assert.equal(live.headers.get("location"), "https://example.com/updated");
  assert.equal(
    (await request(`/api/codes/${codes[0].id}/download?format=svg`)).status,
    200,
  );
});

test("only authorized company billing staff can provision manual tiers, and cancellation preserves printed links", async (t) => {
  const app = await hosted(t),
    { request, db } = app,
    owner = db.prepare("SELECT id FROM users").get();
  assert.equal((await setPlan(app, "creator")).status, 403);
  setOperator(db, owner.id, true, "support");
  assert.equal((await setPlan(app, "creator")).status, 403);
  setOperator(db, owner.id, true, "billing");
  assert.equal((await request("/api/operator/plans")).status, 200);
  assert.equal((await setPlan(app, "creator")).status, 200);
  const summary = await (await request("/api/billing")).json();
  assert.equal(summary.current.codes, 1000);
  assert.equal(summary.current.source, "manual");
  assert.equal(
    (await (await request("/api/storage")).json()).limitBytes,
    5 * 1024 ** 3,
  );
  const batch = await request("/api/codes/bulk", {
    method: "POST",
    body: {
      codes: Array.from({ length: 26 }, (_, i) =>
        urlCode({ name: `Paid capacity ${i}` }),
      ),
    },
  });
  assert.equal(batch.status, 201);
  const codes = await batch.json();
  assert.equal((await setPlan(app, "creator", "canceled")).status, 200);
  assert.equal(
    (await (await request("/api/billing")).json()).current.id,
    "free",
  );
  assert.equal(
    (await request("/api/codes", { method: "POST", body: urlCode() })).status,
    402,
  );
  assert.equal(
    (await request("/r/" + codes[0].slug, { authenticated: false })).status,
    302,
  );
  assert.equal((await (await request("/api/codes")).json()).length, 26);
  const rows = await (await request("/api/audit")).json();
  assert.ok(
    rows.some(
      (row) =>
        row.event === "workspace.plan_changed" && row.details.to === "free",
    ),
  );
  assert.doesNotMatch(JSON.stringify(rows), /a-secure-test-password/);
});

test("team seats count pending invitations and are rechecked during acceptance after a downgrade", async (t) => {
  const app = await hosted(t),
    { request, db, base } = app;
  setOperator(db, db.prepare("SELECT id FROM users").get().id, true);
  assert.equal((await setPlan(app, "business")).status, 200);
  const invitations = [];
  for (let i = 0; i < 3; i++) {
    const response = await request("/api/invitations", {
      method: "POST",
      body: { email: `seat${i}@example.com`, role: "viewer" },
    });
    assert.equal(response.status, 201);
    invitations.push(await response.json());
  }
  assert.equal((await setPlan(app, "free")).status, 200);
  assert.equal(
    (
      await request("/api/invitations", {
        method: "POST",
        body: { email: "excess@example.com", role: "editor" },
      })
    ).status,
    402,
  );
  for (let i = 0; i < 3; i++) {
    const response = await fetch(base + "/api/auth/invite/accept", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: new URL(invitations[i].url).hash.slice(8),
        name: `Seat ${i}`,
        password: "seat-test-password",
      }),
    });
    assert.equal(response.status, i < 2 ? 200 : 402);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM members").get().n, 3);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM users WHERE email='seat2@example.com'")
      .get().n,
    0,
  );
});

test("hosted storage limits follow the current tier and self-hosted QR and team counts remain uncapped", async (t) => {
  const app = await hosted(t),
    { request, db } = app;
  const workspace = db.prepare("SELECT id FROM workspaces").get(),
    user = db.prepare("SELECT id FROM users").get();
  const sample = await readFile(
    new URL("./fixtures/sample.mp3", import.meta.url),
  );
  db.prepare(
    "INSERT INTO assets(id,workspace_id,user_id,name,kind,mime,size,storage_key,sha256,pages,created_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "quota-fixture",
    workspace.id,
    user.id,
    "Quota fixture",
    "pdf",
    "application/pdf",
    100 * 1024 ** 2 - sample.length + 1,
    "00000000-0000-0000-0000-000000000000.pdf",
    "fixture",
    1,
    new Date().toISOString(),
    "{}",
  );
  const upload = () =>
    request("/api/assets", {
      method: "POST",
      raw: sample,
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "Test.mp3",
      },
    });
  assert.equal((await upload()).status, 413);
  setOperator(db, user.id, true);
  assert.equal((await setPlan(app, "creator")).status, 200);
  assert.equal((await upload()).status, 201);
  const local = await fixture(t);
  await local.setup();
  const summary = await (await local.request("/api/billing")).json();
  assert.equal(summary.current.id, "selfhost");
  assert.equal(summary.current.codes, null);
  assert.equal(summary.current.members, null);
  assert.equal(
    summary.plans.find((plan) => plan.id === "plus").monthlyINR,
    null,
  );
  assert.equal(
    (
      await local.request("/api/codes/bulk", {
        method: "POST",
        body: {
          codes: Array.from({ length: 26 }, (_, i) =>
            urlCode({ name: `Self-hosted ${i}` }),
          ),
        },
      })
    ).status,
    201,
  );
});

test("hosted workspace creation is bounded independently from plan limits", async (t) => {
  const { request, db } = await hosted(t);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request("/api/workspaces", {
          method: "POST",
          body: { name: `Workspace ${i}` },
        })
      ).status,
      201,
    );
  assert.equal(
    (
      await request("/api/workspaces", {
        method: "POST",
        body: { name: "Excess workspace" },
      })
    ).status,
    402,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM workspaces").get().n, 3);
});
