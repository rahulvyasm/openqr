import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, urlCode } from "./helpers.js";
import { setOperator, operatorRole } from "../server/operator.js";
import { createEntitlements } from "../server/plans.js";

const password = "a-secure-test-password";
async function setup(t) {
  const app = await fixture(t, ":memory:", { hosting: { enabled: true } });
  await app.setup();
  const owner = app.db.prepare("SELECT * FROM users").get();
  const workspace = app.db.prepare("SELECT * FROM workspaces").get();
  const grant = (tier, extra = {}) =>
    app.request(`/api/operator/accounts/${owner.id}/access`, {
      method: "POST",
      body: { tier, password, reason: "Personal account access", ...extra },
    });
  return { ...app, owner, workspace, grant };
}

test("only a live Super Admin can grant account access; passwords and reasons are required", async (t) => {
  const { db, owner, grant, request } = await setup(t);
  assert.equal((await grant("unlimited")).status, 403);
  for (const role of ["support", "operations", "analyst", "billing"]) {
    setOperator(db, owner.id, true, role);
    assert.equal((await grant("unlimited")).status, 403, role);
  }
  setOperator(db, owner.id, true, "super_admin");
  assert.equal((await grant("unlimited", { password: "wrong" })).status, 403);
  assert.equal((await grant("unlimited", { reason: "" })).status, 400);
  assert.equal((await grant("unlimited", { reason: "abcd" })).status, 400);
  assert.equal((await grant("invented")).status, 400);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM config WHERE key LIKE 'account-access:%'",
      )
      .get().n,
    0,
  );
  // Ordinary account updates cannot set entitlements or staff roles.
  await request("/api/auth/profile", {
    method: "PATCH",
    body: {
      name: "Changed",
      tier: "unlimited",
      operatorRole: "super_admin",
    },
  });
  assert.equal(
    (await (await request("/api/billing")).json()).current.id,
    "free",
  );
});

test("account grants apply to current and future owned workspaces, revoke immediately, and keep a staff audit", async (t) => {
  const { db, owner, workspace, grant, request } = await setup(t);
  setOperator(db, owner.id, true);
  for (const tier of ["plus", "pro", "unlimited"]) {
    assert.equal((await grant(tier)).status, 200);
    assert.equal(
      (await (await request("/api/billing")).json()).current.id,
      tier,
    );
  }
  const entitlements = createEntitlements(db, { quota: 1 }, { enabled: true });
  assert.equal(entitlements.plan(workspace.id).codes, null);
  assert.equal(entitlements.plan(workspace.id).members, null);
  assert.equal(
    entitlements.plan(workspace.id).storageBytes,
    Number.MAX_SAFE_INTEGER,
  );
  // Unlimited also removes the workspace-count product cap.
  for (let i = 0; i < 4; i++)
    assert.equal(
      (
        await request("/api/workspaces", {
          method: "POST",
          body: { name: `Personal ${i}` },
        })
      ).status,
      201,
    );
  const all = db
    .prepare("SELECT id FROM workspaces WHERE owner_id=?")
    .all(owner.id);
  for (const w of all) assert.equal(entitlements.plan(w.id).id, "unlimited");
  const batch = await request("/api/codes/bulk", {
    method: "POST",
    body: {
      codes: Array.from({ length: 26 }, (_, i) =>
        urlCode({ name: `Personal code ${i}` }),
      ),
    },
  });
  assert.equal(batch.status, 201);
  const code = (await batch.json())[0];
  // Revoking the account grant instantly restores the normal resource checks.
  assert.equal((await grant("inherit")).status, 200);
  assert.equal(
    (await request("/api/codes", { method: "POST", body: urlCode() })).status,
    402,
  );
  assert.equal(
    (
      await request("/api/workspaces", {
        method: "POST",
        body: { name: "Too many" },
      })
    ).status,
    402,
  );
  assert.equal(
    (await request(`/r/${code.slug}`, { authenticated: false })).status,
    302,
  );
  assert.equal((await (await request("/api/codes")).json()).length, 26);
  const events = db
    .prepare(
      "SELECT * FROM staff_audit WHERE target_id=? AND action LIKE 'account.access_%'",
    )
    .all(owner.id);
  assert.equal(events.length, 4);
  assert.ok(
    events.every(
      (e) => e.reason === "Personal account access" && e.actor_id === owner.id,
    ),
  );
  assert.doesNotMatch(JSON.stringify(events), /a-secure-test-password/);
});

test("grants follow ownership, never memberships, and never grant staff permissions", async (t) => {
  const { db, owner, workspace, grant, request } = await setup(t);
  setOperator(db, owner.id, true);
  assert.equal((await grant("unlimited")).status, 200);
  const other = randomUUID();
  db.prepare(
    "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
  ).run(other, "other@example.com", "Other", owner.salt, owner.password);
  const w2 = randomUUID();
  db.prepare(
    "INSERT INTO workspaces(id,name,owner_id,created_at) VALUES (?,?,?,?)",
  ).run(w2, "Other workspace", other, new Date().toISOString());
  db.prepare(
    "INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)",
  ).run(w2, owner.id, "admin", new Date().toISOString());
  const entitlements = createEntitlements(db, { quota: 1 }, { enabled: true });
  assert.equal(entitlements.plan(w2).id, "free");
  db.prepare("UPDATE workspaces SET owner_id=? WHERE id=?").run(
    other,
    workspace.id,
  );
  assert.equal(entitlements.plan(workspace.id).id, "free");
  assert.equal(
    (
      await request(`/api/operator/accounts/${other}/access`, {
        method: "POST",
        body: {
          tier: "pro",
          password,
          reason: "Early access invitation",
        },
      })
    ).status,
    200,
  );
  assert.equal(entitlements.plan(workspace.id).id, "pro");
  assert.equal(operatorRole(db, other), null);
});

test("account override prevents workspace-plan bypass, legacy grants migrate, and public prices remain hidden", async (t) => {
  const { db, owner, workspace, grant, request } = await setup(t);
  setOperator(db, owner.id, true);
  // Existing subscriptions from 1.0 retain their access.
  for (const [old, current] of [
    ["creator", "plus"],
    ["business", "pro"],
  ]) {
    db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES (?,?)").run(
      `subscription:${workspace.id}`,
      JSON.stringify({ tier: old, status: "active" }),
    );
    assert.equal(
      (await (await request("/api/billing")).json()).current.id,
      current,
    );
  }
  assert.equal((await grant("free")).status, 200);
  assert.equal(
    (
      await request(`/api/operator/workspaces/${workspace.id}/plan`, {
        method: "POST",
        body: { tier: "pro", password },
      })
    ).status,
    409,
  );
  assert.equal(
    (await (await request("/api/billing")).json()).current.id,
    "free",
  );
  assert.equal((await grant("inherit")).status, 200);
  assert.equal(
    (await (await request("/api/billing")).json()).current.id,
    "pro",
  );
  const plans = (await (await request("/api/billing")).json()).plans;
  assert.deepEqual(
    plans.map((p) => p.id),
    ["free", "plus", "pro"],
  );
  assert.ok(plans.every((p) => p.monthlyINR === null));
  assert.equal(plans.find((p) => p.id === "plus").available, false);
  const list = await (
    await request("/api/operator/plans?q=Test%20Owner")
  ).json();
  assert.equal(list.total, 1);
  assert.equal(list.canGrantAccountAccess, true);
  assert.equal(list.rows[0].ownerId, owner.id);
  setOperator(db, owner.id, true, "billing");
  assert.equal(
    (await (await request("/api/operator/plans")).json()).canGrantAccountAccess,
    false,
  );
});

test("the access write rolls back when the audit fails", async (t) => {
  const { db, owner, grant } = await setup(t);
  setOperator(db, owner.id, true);
  db.exec(
    "CREATE TRIGGER reject_grant_audit BEFORE INSERT ON staff_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  );
  assert.equal((await grant("unlimited")).status, 500);
  assert.equal(
    db
      .prepare("SELECT value FROM config WHERE key=?")
      .get(`account-access:${owner.id}`),
    undefined,
  );
});
