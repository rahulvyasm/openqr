import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, urlCode } from "./helpers.js";
import { isOperator, setOperator } from "../server/operator.js";
import { randomUUID } from "node:crypto";

test("company departments enforce distinct permissions and customer sign-ins cannot claim staff access", async (t) => {
  const { request, setup, db, base } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT * FROM users").get();
  setOperator(db, owner.id, true);
  async function account(role) {
    const id = randomUUID(),
      email = `${role}@example.com`;
    db.prepare(
      "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
    ).run(id, email, role, owner.salt, owner.password);
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: "a-secure-test-password",
        operator: true,
        operatorRole: "super_admin",
      }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      id,
      email,
      call: async (path, body) =>
        fetch(base + path, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "http://localhost:5173",
            cookie,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
    };
  }
  const customer = await account("customer");
  assert.equal(
    (await (await customer.call("/api/auth/status")).json()).operator,
    false,
  );
  assert.equal((await customer.call("/api/operator/overview")).status, 403);
  for (const role of ["operations", "support", "billing", "analyst"]) {
    const staff = await account(role);
    setOperator(db, staff.id, true, role);
    const overview = await (await staff.call("/api/operator/overview")).json();
    assert.equal(overview.access.role, role);
    assert.equal(
      (await staff.call("/api/operator/users")).status,
      role === "support" ? 200 : 403,
    );
    assert.equal(
      (await staff.call("/api/operator/workspaces")).status,
      role === "analyst" ? 403 : 200,
    );
    assert.equal((await staff.call("/api/operator/staff")).status, 403);
    assert.equal(
      (await staff.call("/api/operator/backups", {})).status,
      role === "operations" ? 503 : 403,
    );
    assert.equal(
      (
        await staff.call("/api/operator/staff", {
          email: staff.email,
          role: "super_admin",
          password: "a-secure-test-password",
        })
      ).status,
      403,
    );
    if (role !== "operations") assert.equal(overview.operations, null);
    if (role === "analyst") assert.deepEqual(overview.events, []);
    assert.deepEqual(overview.operatorEvents, []);
  }
  assert.equal(
    (
      await request("/api/operator/staff", {
        method: "POST",
        body: {
          email: "owner@example.com",
          role: "support",
          password: "a-secure-test-password",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/operator/staff", {
        method: "POST",
        body: { email: customer.email, role: "support", password: "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/operator/staff", {
        method: "POST",
        body: {
          email: customer.email,
          role: "support",
          password: "a-secure-test-password",
        },
      })
    ).status,
    200,
  );
  assert.equal((await customer.call("/api/operator/users")).status, 200);
  assert.equal(
    (
      await request(`/api/operator/staff/${customer.id}`, {
        method: "DELETE",
        body: { password: "a-secure-test-password" },
      })
    ).status,
    200,
  );
  assert.equal((await customer.call("/api/operator/overview")).status, 403);
});

test("workspace owners do not inherit platform access; explicit grants and revocation take effect immediately", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT id FROM users").get();
  assert.equal(
    (await (await request("/api/auth/status")).json()).operator,
    false,
  );
  for (const path of [
    "/api/operator/overview",
    "/api/operator/users",
    "/api/operator/workspaces",
  ]) {
    assert.equal((await request(path, { authenticated: false })).status, 401);
    assert.equal((await request(path)).status, 403);
  }
  assert.equal(
    (
      await request("/api/invitations", {
        method: "POST",
        body: { email: "operator@example.com", role: "operator" },
      })
    ).status,
    400,
  );
  setOperator(db, owner.id, true);
  assert.equal(
    (await (await request("/api/auth/status")).json()).operator,
    true,
  );
  const code = await (
    await request("/api/codes", {
      method: "POST",
      body: urlCode({ name: "Operator metrics" }),
    })
  ).json();
  await request("/r/" + code.slug, { authenticated: false });
  await request("/api/workspaces", {
    method: "POST",
    body: { name: "Second workspace" },
  });
  const response = await request("/api/operator/overview");
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.totals.workspaces, 2);
  assert.equal(overview.totals.users, 1);
  assert.equal(overview.totals.codes, 1);
  assert.equal(overview.totals.scans, 1);
  assert.equal(overview.totals.scans24h, 1);
  assert.equal(
    overview.hourly.reduce((sum, h) => sum + h.scans, 0),
    1,
  );
  assert.ok(
    overview.events.some(
      (event) =>
        event.event === "code.created" && event.name === "Operator metrics",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(overview),
    /"password"|"salt"|"token"|"storage_key"/,
  );
  const users = await (
    await request("/api/operator/users?q=owner%40example.com")
  ).json();
  assert.equal(users.rows.length, 1);
  assert.equal(users.rows[0].operator, true);
  assert.doesNotMatch(
    JSON.stringify(users),
    /a-secure-test-password|"salt"|"password"|"token"/,
  );
  const workspaces = await (
    await request("/api/operator/workspaces?q=Second")
  ).json();
  assert.equal(workspaces.rows.length, 1);
  assert.equal(workspaces.total, 1);
  assert.equal(
    (
      await request("/api/operator/backups", {
        method: "POST",
        body: {},
        origin: "https://other.example",
      })
    ).status,
    403,
  );
  setOperator(db, owner.id, false);
  assert.equal((await request("/api/operator/overview")).status, 403);
  assert.equal(
    (await (await request("/api/auth/status")).json()).operator,
    false,
  );
});

test("operator session management requires password confirmation and revokes only the selected account", async (t) => {
  const { request, setup, base, db } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT id FROM users").get();
  setOperator(db, owner.id, true);
  const invitation = await (
    await request("/api/invitations", {
      method: "POST",
      body: { email: "editor@example.com", role: "editor" },
    })
  ).json();
  const accepted = await fetch(base + "/api/auth/invite/accept", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token: new URL(invitation.url).hash.slice(8),
      name: "Editor",
      password: "editor-test-password",
    }),
  });
  assert.equal(accepted.status, 200);
  const headers = { cookie: accepted.headers.get("set-cookie").split(";")[0] };
  const editor = db
    .prepare("SELECT id FROM users WHERE email='editor@example.com'")
    .get();
  assert.equal(
    (await fetch(base + "/api/operator/overview", { headers })).status,
    403,
  );
  const path = `/api/operator/users/${editor.id}/revoke-sessions`;
  assert.equal(
    (
      await request(path, {
        method: "POST",
        body: { password: "wrong-password" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/api/codes", { headers })).status, 200);
  const response = await request(path, {
    method: "POST",
    body: { password: "a-secure-test-password" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revoked, 1);
  assert.equal((await fetch(base + "/api/codes", { headers })).status, 401);
  assert.equal((await request("/api/operator/overview")).status, 200);
  assert.equal(
    (
      await request(`/api/operator/users/${owner.id}/revoke-sessions`, {
        method: "POST",
        body: { password: "a-secure-test-password" },
      })
    ).status,
    400,
  );
  const events = (await (await request("/api/operator/overview")).json())
    .operatorEvents;
  assert.ok(
    events.some(
      (event) =>
        event.event === "operator.sessions_revoked" && event.count === 1,
    ),
  );
  assert.doesNotMatch(JSON.stringify(events), /a-secure-test-password/);
});

test("the operator CLI manages separate platform grants and console backups record a real archive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openqr-operator-"));
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  const { request, setup, db } = await fixture(
    { after: (fn) => cleanups.push(fn) },
    join(root, "openqr.sqlite"),
  );
  await setup();
  const owner = db.prepare("SELECT id FROM users").get();
  const run = promisify(execFile);
  const cli = resolve("server/operator-cli.js");
  const env = {
    ...process.env,
    DATA_DIR: root,
    DOTENV_CONFIG_PATH: join(root, "absent.env"),
  };
  await run(process.execPath, [cli, "grant", "--email", "owner@example.com"], {
    env,
    cwd: root,
  });
  assert.equal(isOperator(db, owner.id), true);
  const backup = await request("/api/operator/backups", {
    method: "POST",
    body: {},
  });
  assert.equal(backup.status, 200);
  assert.ok(
    (await readdir(join(root, "backups"))).some((name) =>
      name.endsWith(".tar.gz"),
    ),
  );
  const snapshot = await (await request("/api/operator/overview")).json();
  assert.equal(snapshot.operations.backup.state, "succeeded");
  assert.ok(
    snapshot.operatorEvents.some(
      (event) => event.event === "operator.backup_created",
    ),
  );
  await run(process.execPath, [cli, "revoke", "--email", "owner@example.com"], {
    env,
    cwd: root,
  });
  assert.equal((await request("/api/operator/overview")).status, 403);
});
