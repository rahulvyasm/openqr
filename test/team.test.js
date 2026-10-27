import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, urlCode } from "./helpers.js";
import { issueRecovery } from "../server/auth.js";
import { digest } from "../server/security.js";
import { DatabaseSync } from "node:sqlite";
import { scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join as joinPath, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

function client(base) {
  let cookie = "";
  return async (path, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:5173",
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  };
}
async function invite(owner, email, role = "editor") {
  const r = await owner("/api/invitations", {
    method: "POST",
    body: { email, role },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const v = await r.json();
  return { ...v, token: new URL(v.url).hash.slice("#invite=".length) };
}
async function join(base, invitation, name = "Teammate") {
  const call = client(base);
  const r = await call("/api/auth/invite/accept", {
    method: "POST",
    body: {
      token: invitation.token,
      name,
      password: "teammate-secure-password",
    },
  });
  assert.equal(r.status, 200, await r.clone().text());
  return call;
}
async function code(owner) {
  const r = await owner("/api/codes", { method: "POST", body: urlCode() });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
test("invited editors share workspace resources and retain them after a creator is removed", async (t) => {
  const { request: owner, setup, base, db } = await fixture(t);
  await setup();
  const before = await code(owner),
    link = await invite(owner, "editor@example.com"),
    editor = await join(base, link, "The Editor");
  assert.notEqual(
    db.prepare("SELECT token FROM invitations WHERE id=?").get(link.id).token,
    link.token,
  );
  const status = await (await editor("/api/auth/status")).json();
  assert.equal(status.workspace.role, "editor");
  assert.equal((await (await editor("/api/codes")).json())[0].id, before.id);
  const added = await code(editor);
  assert.equal((await (await owner("/api/codes")).json()).length, 2);
  await owner(`/api/team/${status.user.id}`, { method: "DELETE" });
  assert.equal((await editor("/api/codes")).status, 403);
  assert.equal((await (await owner("/api/codes")).json()).length, 2);
  assert.equal((await owner(`/r/${added.slug}`)).status, 302);
});
test("viewers can read and export but cannot mutate any shared resource", async (t) => {
  const { request: owner, setup, base } = await fixture(t);
  await setup();
  const saved = await code(owner),
    viewer = await join(
      base,
      await invite(owner, "viewer@example.com", "viewer"),
    );
  for (const path of [
    "/api/codes",
    "/api/folders",
    "/api/templates",
    "/api/analytics",
    "/api/team",
    `/api/codes/${saved.id}/download?format=svg`,
  ])
    assert.equal((await viewer(path)).status, 200, path);
  assert.equal(
    (
      await viewer("/api/codes/export", {
        method: "POST",
        body: { ids: [saved.id], format: "svg" },
      })
    ).status,
    200,
  );
  for (const [path, method, body] of [
    ["/api/codes", "POST", urlCode()],
    ["/api/codes/bulk", "POST", { codes: [urlCode()] }],
    ["/api/codes/batch", "POST", { ids: [saved.id], action: "delete" }],
    [`/api/codes/${saved.id}`, "PUT", urlCode()],
    [`/api/codes/${saved.id}`, "DELETE", undefined],
    [`/api/codes/${saved.id}/duplicate`, "POST", {}],
    ["/api/folders", "POST", { name: "Forbidden" }],
    ["/api/templates", "POST", { name: "Forbidden" }],
    [
      "/api/invitations",
      "POST",
      { email: "other@example.com", role: "viewer" },
    ],
    ["/api/workspace", "PATCH", { name: "Forbidden" }],
  ])
    assert.equal((await viewer(path, { method, body })).status, 403, path);
  assert.equal((await viewer("/api/audit")).status, 403);
  assert.equal((await viewer("/api/invitations")).status, 403);
});
test("workspace switching isolates every resource and supports repeated folder/design names", async (t) => {
  const { request: owner, setup } = await fixture(t);
  await setup();
  const original = (await (await owner("/api/auth/status")).json()).workspace
      .id,
    saved = await code(owner);
  const firstFolder = await (
    await owner("/api/folders", { method: "POST", body: { name: "Marketing" } })
  ).json();
  await owner("/api/templates", { method: "POST", body: { name: "Brand" } });
  await owner(`/r/${saved.slug}`);
  const created = await owner("/api/workspaces", {
    method: "POST",
    body: { name: "Another workspace" },
  });
  assert.equal(created.status, 201);
  const other = await created.json();
  assert.notEqual(other.id, original);
  for (const path of ["/api/codes", "/api/folders", "/api/templates"])
    assert.deepEqual(await (await owner(path)).json(), []);
  assert.equal((await (await owner("/api/analytics")).json()).total, 0);
  for (const path of [
    `/api/codes/${saved.id}/download`,
    `/api/codes/${saved.id}/duplicate`,
  ])
    assert.equal(
      (
        await owner(path, {
          method: path.endsWith("duplicate") ? "POST" : "GET",
          body: path.endsWith("duplicate") ? {} : undefined,
        })
      ).status,
      404,
    );
  assert.equal(
    (
      await owner("/api/codes/export", {
        method: "POST",
        body: { ids: [saved.id] },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await owner("/api/codes", {
        method: "POST",
        body: urlCode({ folderId: firstFolder.id }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner("/api/folders", {
        method: "POST",
        body: { name: "Marketing" },
      })
    ).status,
    201,
  );
  assert.equal(
    (await owner("/api/templates", { method: "POST", body: { name: "Brand" } }))
      .status,
    201,
  );
  await owner(`/api/workspaces/${original}/select`, {
    method: "POST",
    body: {},
  });
  assert.equal((await (await owner("/api/codes")).json())[0].id, saved.id);
  assert.equal(
    (
      await owner("/api/workspaces/unknown/select", {
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
});
test("invitation expiry, revocation, renewal, reuse and competing acceptance are enforced", async (t) => {
  const { request: owner, setup, base, db } = await fixture(t);
  await setup();
  const expired = await invite(owner, "expired@example.com");
  db.prepare("UPDATE invitations SET expires=? WHERE id=?").run(
    Date.now() - 1,
    expired.id,
  );
  const anonymous = client(base);
  assert.equal(
    (
      await anonymous("/api/auth/invite/inspect", {
        method: "POST",
        body: { token: expired.token },
      })
    ).status,
    410,
  );
  const revoked = await invite(owner, "revoked@example.com");
  await owner(`/api/invitations/${revoked.id}`, { method: "DELETE" });
  assert.equal(
    (
      await anonymous("/api/auth/invite/accept", {
        method: "POST",
        body: {
          token: revoked.token,
          name: "Someone",
          password: "a-secure-invite-password",
        },
      })
    ).status,
    410,
  );
  const old = await invite(owner, "renew@example.com");
  const renewed = await (
    await owner(`/api/invitations/${old.id}/renew`, {
      method: "POST",
      body: {},
    })
  ).json();
  const token = new URL(renewed.url).hash.slice("#invite=".length);
  assert.equal(
    (
      await anonymous("/api/auth/invite/inspect", {
        method: "POST",
        body: { token: old.token },
      })
    ).status,
    410,
  );
  const body = {
    token,
    name: "Racing join",
    password: "a-secure-invite-password",
  };
  const results = await Promise.all([
    client(base)("/api/auth/invite/accept", { method: "POST", body }),
    client(base)("/api/auth/invite/accept", { method: "POST", body }),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 410).length, 1);
  assert.equal(
    (await anonymous("/api/auth/invite/accept", { method: "POST", body }))
      .status,
    410,
  );
});
test("existing accounts must authenticate as the invited email before joining another workspace", async (t) => {
  const { request: owner, setup, base } = await fixture(t);
  await setup();
  const editor = await join(base, await invite(owner, "existing@example.com"));
  const first = (await (await owner("/api/auth/status")).json()).workspace.id;
  await owner("/api/workspaces", {
    method: "POST",
    body: { name: "Second workspace" },
  });
  const invitation = await invite(owner, "existing@example.com");
  assert.equal(
    (
      await client(base)("/api/auth/invite/accept", {
        method: "POST",
        body: {
          token: invitation.token,
          name: "Impostor",
          password: "any-valid-length-password",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner("/api/auth/invite/accept", {
        method: "POST",
        body: { token: invitation.token },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await editor("/api/auth/invite/accept", {
        method: "POST",
        body: { token: invitation.token },
      })
    ).status,
    200,
  );
  const status = await (await editor("/api/auth/status")).json();
  assert.equal(status.workspaces.length, 2);
  assert.notEqual(status.workspace.id, first);
});
test("admins cannot escalate themselves or manage owners/admins; demotion revokes pending grants", async (t) => {
  const { request: owner, setup, base } = await fixture(t);
  await setup();
  const ownerId = (await (await owner("/api/auth/status")).json()).user.id;
  const admin = await join(
      base,
      await invite(owner, "admin@example.com", "admin"),
    ),
    adminStatus = await (await admin("/api/auth/status")).json();
  assert.equal(
    (
      await admin("/api/invitations", {
        method: "POST",
        body: { email: "escalate@example.com", role: "admin" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await admin(`/api/team/${ownerId}`, { method: "DELETE" })).status,
    403,
  );
  assert.equal(
    (
      await admin(`/api/team/${adminStatus.user.id}`, {
        method: "PATCH",
        body: { role: "admin" },
      })
    ).status,
    403,
  );
  const pending = await invite(admin, "pending@example.com", "viewer");
  await owner(`/api/team/${adminStatus.user.id}`, {
    method: "PATCH",
    body: { role: "editor" },
  });
  assert.equal(
    (
      await client(base)("/api/auth/invite/inspect", {
        method: "POST",
        body: { token: pending.token },
      })
    ).status,
    410,
  );
  assert.equal((await admin("/api/invitations")).status, 403);
  assert.equal(
    (await owner(`/api/team/${ownerId}`, { method: "DELETE" })).status,
    403,
  );
});
test("role changes take effect for existing cookies and owners transfer only after password verification", async (t) => {
  const { request: owner, setup, base } = await fixture(t);
  await setup();
  const editor = await join(base, await invite(owner, "new-owner@example.com")),
    person = (await (await editor("/api/auth/status")).json()).user;
  await owner(`/api/team/${person.id}`, {
    method: "PATCH",
    body: { role: "viewer" },
  });
  assert.equal(
    (await editor("/api/codes", { method: "POST", body: urlCode() })).status,
    403,
  );
  assert.equal(
    (
      await owner("/api/workspace/transfer", {
        method: "POST",
        body: { userId: person.id, password: "wrong-password" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner("/api/workspace/transfer", {
        method: "POST",
        body: { userId: person.id, password: "a-secure-test-password" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await editor("/api/auth/status")).json()).workspace.role,
    "owner",
  );
  assert.equal(
    (await (await owner("/api/auth/status")).json()).workspace.role,
    "admin",
  );
  const members = await (await editor("/api/team")).json();
  assert.equal(members.filter((m) => m.role === "owner").length, 1);
});
test("profile updates, session revocation and password changes preserve account boundaries", async (t) => {
  const { request: owner, setup, base } = await fixture(t);
  await setup();
  const other = client(base);
  await other("/api/auth/login", {
    method: "POST",
    body: { email: "owner@example.com", password: "a-secure-test-password" },
  });
  let sessions = await (await owner("/api/auth/sessions")).json();
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s) => s.current).length, 1);
  assert.ok(sessions.every((s) => /^[a-f0-9]{64}$/.test(s.id)));
  await owner("/api/auth/sessions/revoke-others", { method: "POST", body: {} });
  assert.equal((await other("/api/codes")).status, 401);
  assert.equal((await owner("/api/codes")).status, 200);
  await owner("/api/auth/profile", {
    method: "PATCH",
    body: { name: "A new name" },
  });
  assert.equal(
    (await (await owner("/api/auth/status")).json()).user.name,
    "A new name",
  );
  await other("/api/auth/login", {
    method: "POST",
    body: { email: "owner@example.com", password: "a-secure-test-password" },
  });
  assert.equal(
    (
      await owner("/api/auth/password", {
        method: "POST",
        body: {
          currentPassword: "incorrect-password",
          newPassword: "a-brand-new-password",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner("/api/auth/password", {
        method: "POST",
        body: {
          currentPassword: "a-secure-test-password",
          newPassword: "a-brand-new-password",
        },
      })
    ).status,
    200,
  );
  assert.equal((await other("/api/codes")).status, 401);
  assert.equal((await owner("/api/codes")).status, 200);
  assert.equal((await (await owner("/api/auth/sessions")).json()).length, 1);
  assert.equal(
    (
      await client(base)("/api/auth/login", {
        method: "POST",
        body: {
          email: "owner@example.com",
          password: "a-secure-test-password",
        },
      })
    ).status,
    401,
  );
});
test("operator recovery tokens expire, are hashed, rotate, work once and revoke all sessions", async (t) => {
  const { request: owner, setup, base, db } = await fixture(t);
  await setup();
  const first = issueRecovery(db, "owner@example.com", "http://localhost:5173"),
    firstToken = new URL(first).hash.slice("#reset=".length);
  assert.equal(
    db.prepare("SELECT token FROM password_resets").get().token,
    digest(firstToken),
  );
  const next = issueRecovery(db, "owner@example.com", "http://localhost:5173"),
    token = new URL(next).hash.slice("#reset=".length),
    anon = client(base);
  assert.equal(
    (
      await anon("/api/auth/reset", {
        method: "POST",
        body: { token: firstToken, password: "a-recovered-password" },
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await anon("/api/auth/reset", {
        method: "POST",
        body: { token, password: "a-recovered-password" },
      })
    ).status,
    200,
  );
  assert.equal((await owner("/api/codes")).status, 401);
  assert.equal((await anon("/api/codes")).status, 401);
  assert.equal(
    (
      await anon("/api/auth/reset", {
        method: "POST",
        body: { token, password: "another-recovered-password" },
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await anon("/api/auth/login", {
        method: "POST",
        body: { email: "owner@example.com", password: "a-recovered-password" },
      })
    ).status,
    200,
  );
  const expired = new URL(
    issueRecovery(db, "owner@example.com", "http://localhost:5173"),
  ).hash.slice("#reset=".length);
  db.prepare("UPDATE password_resets SET expires=?").run(Date.now() - 1);
  assert.equal(
    (
      await anon("/api/auth/reset", {
        method: "POST",
        body: { token: expired, password: "some-recovered-password" },
      })
    ).status,
    410,
  );
});
test("security audit is scoped to managers and contains no invitation, recovery or password secrets", async (t) => {
  const { request: owner, setup, db } = await fixture(t);
  await setup();
  const inv = await invite(owner, "audit@example.com"),
    recovery = new URL(
      issueRecovery(db, "owner@example.com", "http://localhost:5173"),
    ).hash.slice("#reset=".length),
    events = await (await owner("/api/audit")).json();
  assert.ok(events.some((e) => e.event === "invitation.created"));
  assert.ok(events.some((e) => e.event === "account.recovery_issued"));
  assert.ok(!JSON.stringify(events).includes(inv.token));
  assert.ok(!JSON.stringify(events).includes(recovery));
  assert.ok(!JSON.stringify(events).includes("a-secure-test-password"));
  await owner("/api/workspaces", {
    method: "POST",
    body: { name: "Separate audit" },
  });
  const separate = await (await owner("/api/audit")).json();
  assert.equal(separate.length, 1);
  assert.equal(separate[0].event, "workspace.created");
});

test("v0.2 migration preserves folder references, saved designs, old sessions and old password hashes", async (t) => {
  const dir = mkdtempSync(joinPath(tmpdir(), "openqr-v2-")),
    path = joinPath(dir, "legacy.sqlite"),
    rawToken = "legacy-raw-session-token",
    salt = "legacy-salt",
    hash = scryptSync("legacy-secure-password", salt, 64).toString("hex"),
    now = new Date().toISOString();
  const old = new DatabaseSync(path);
  old.exec(
    `PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL); CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL); CREATE TABLE folders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,UNIQUE(user_id,name)); CREATE TABLE codes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,dynamic INTEGER NOT NULL,data TEXT NOT NULL,folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,color TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,design TEXT NOT NULL DEFAULT '{}',campaign TEXT NOT NULL DEFAULT '{}'); CREATE TABLE scans(id INTEGER PRIMARY KEY,code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,scanned_at TEXT NOT NULL,visitor TEXT NOT NULL,device TEXT NOT NULL,browser TEXT NOT NULL DEFAULT 'Unknown',os TEXT NOT NULL DEFAULT 'Unknown',referrer TEXT NOT NULL DEFAULT 'Unknown'); CREATE TABLE templates(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,color TEXT NOT NULL,design TEXT NOT NULL,UNIQUE(user_id,name)); PRAGMA user_version=2;`,
  );
  old
    .prepare("INSERT INTO users VALUES (?,?,?,?,?)")
    .run("legacy-owner", "legacy@example.com", "Legacy Owner", salt, hash);
  old
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(digest(rawToken), "legacy-owner", Date.now() + 86400000);
  old
    .prepare("INSERT INTO folders VALUES (?,?,?)")
    .run("legacy-folder", "legacy-owner", "Marketing");
  old
    .prepare("INSERT INTO templates VALUES (?,?,?,?,?)")
    .run("legacy-design", "legacy-owner", "Brand", "#163f32", "{}");
  old
    .prepare("INSERT INTO codes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "legacy-code",
      "legacy-owner",
      "already-printed",
      "Legacy",
      "url",
      1,
      '{"url":"https://example.com/old"}',
      "legacy-folder",
      "#163f32",
      1,
      now,
      "{}",
      "{}",
    );
  old
    .prepare(
      "INSERT INTO scans (code_id,scanned_at,visitor,device) VALUES (?,?,?,?)",
    )
    .run("legacy-code", now, "hashed", "Mobile");
  old.close();
  const { request, db } = await fixture(t, path);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const headers = { cookie: `openqr_session=${rawToken}` };
  const status = await (await request("/api/auth/status", { headers })).json();
  assert.equal(status.workspace.role, "owner");
  assert.equal(status.user.email, "legacy@example.com");
  assert.equal(
    (await (await request("/api/codes", { headers })).json())[0].folderId,
    "legacy-folder",
  );
  assert.equal(
    (await (await request("/api/templates", { headers })).json())[0].name,
    "Brand",
  );
  assert.equal(
    (await (await request("/api/analytics", { headers })).json()).total,
    1,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    (await request("/r/already-printed")).headers.get("location"),
    "https://example.com/old",
  );
  assert.equal(
    (
      await request("/api/auth/login", {
        method: "POST",
        body: {
          email: "legacy@example.com",
          password: "legacy-secure-password",
        },
      })
    ).status,
    200,
  );
  await request("/api/folders/legacy-folder", { method: "DELETE" });
  assert.equal((await (await request("/api/codes")).json())[0].folderId, null);
});

test("operator recovery command creates a one-time reset without exposing account credentials", async (t) => {
  const dir = mkdtempSync(joinPath(tmpdir(), "openqr-cli-"));
  const { setup, db } = await fixture(t, joinPath(dir, "openqr.sqlite"));
  await setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = execFileSync(
    process.execPath,
    [resolve("server/manage.js"), "--email", "owner@example.com"],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PUBLIC_URL: "http://localhost:5173",
      },
      encoding: "utf8",
    },
  );
  const match = output.match(/#reset=([a-f0-9]{64})/);
  assert.ok(match);
  assert.equal(
    db.prepare("SELECT token FROM password_resets").get().token,
    digest(match[1]),
  );
  assert.ok(!output.includes("a-secure-test-password"));
  assert.match(output, /30 minutes/);
});
