import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./helpers.js";
import { createBackup } from "../server/backup.js";
import { readBackupStatus } from "../server/backup-status.js";

async function diskFixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "openqr-operations-"));
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  const app = await fixture(
    { after: (fn) => cleanups.push(fn) },
    join(root, "openqr.sqlite"),
    {
      backupPolicy: { intervalHours: 24, retention: 7 },
      ...options,
    },
  );
  await app.setup();
  return { ...app, root, directory: join(root, "backups") };
}

test("backup status persists local success, remote failure and recovery without exposing error details", async (t) => {
  const { request, db, storage, directory } = await diskFixture(t);
  const getStatus = async () => (await request("/api/backups/status")).json();
  assert.equal((await getStatus()).state, "never");
  const args = { db, storage, directory, publicUrl: "http://localhost:5173" };
  await createBackup(args);
  const initial = await getStatus();
  assert.equal(initial.state, "succeeded");
  assert.ok(initial.lastSuccessAt);
  assert.ok(initial.localCompletedAt);
  assert.equal(initial.remoteEnabled, false);
  assert.equal(initial.intervalHours, 24);
  assert.equal(initial.retention, 7);
  storage.backupStore = {
    uploadArchive: async () => {
      throw new Error("secret credential and private bucket/path");
    },
  };
  await assert.rejects(createBackup(args), /secret credential/);
  const failed = await getStatus();
  assert.equal(failed.state, "failed");
  assert.equal(failed.failureStage, "remote");
  assert.ok(failed.lastFailureAt);
  assert.ok(failed.localCompletedAt);
  assert.equal(failed.lastSuccessAt, initial.lastSuccessAt);
  assert.equal(failed.remoteCompletedAt, null);
  assert.equal(failed.remoteEnabled, true);
  assert.doesNotMatch(JSON.stringify(failed), /secret|credential|bucket|path/);
  assert.equal((await readBackupStatus(directory)).state, "failed");
  storage.backupStore = {
    uploadArchive: async () => {
      const inProgress = await getStatus();
      assert.equal(inProgress.state, "running");
      assert.ok(inProgress.localCompletedAt);
    },
  };
  await createBackup(args);
  const recovered = await getStatus();
  assert.equal(recovered.state, "succeeded");
  assert.equal(recovered.failureStage, null);
  assert.ok(recovered.remoteCompletedAt);
  assert.equal(recovered.lastFailureAt, failed.lastFailureAt);
  assert.equal(
    JSON.parse(await readFile(join(directory, "backup-status.json"), "utf8"))
      .state,
    "succeeded",
  );
});

test("snapshot failures are recorded and corrupt status is reported as unavailable", async (t) => {
  const { db, storage, request, directory } = await diskFixture(t);
  const backup = db.prepare("SELECT id FROM users").get();
  const workspace = db.prepare("SELECT id FROM workspaces").get();
  // A missing media file represents a real incomplete storage installation.
  db.prepare(
    "INSERT INTO assets (id,workspace_id,user_id,name,kind,mime,size,storage_key,sha256,pages,created_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "missing",
    workspace.id,
    backup.id,
    "Missing.pdf",
    "pdf",
    "application/pdf",
    10,
    "00000000-0000-0000-0000-000000000000.pdf",
    "missing",
    1,
    new Date().toISOString(),
    "{}",
  );
  await assert.rejects(
    createBackup({
      db,
      storage,
      directory,
      publicUrl: "http://localhost:5173",
    }),
  );
  const status = await (await request("/api/backups/status")).json();
  assert.equal(status.state, "failed");
  assert.equal(status.failureStage, "snapshot");
  assert.equal(status.lastSuccessAt, null);
  await writeFile(join(directory, "backup-status.json"), "broken JSON");
  assert.equal(
    (await (await request("/api/backups/status")).json()).state,
    "unavailable",
  );
});

test("backup status is manager-only while storage usage remains workspace-scoped", async (t) => {
  const { request, base } = await diskFixture(t);
  assert.equal(
    (await request("/api/backups/status", { authenticated: false })).status,
    401,
  );
  for (const role of ["admin", "editor", "viewer"]) {
    const response = await request("/api/invitations", {
      method: "POST",
      body: { email: `${role}@example.com`, role },
    });
    assert.equal(response.status, 201);
    const invitation = await response.json();
    const accepted = await fetch(base + "/api/auth/invite/accept", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: new URL(invitation.url).hash.slice("#invite=".length),
        name: role,
        password: "operations-test-password",
      }),
    });
    assert.equal(accepted.status, 200);
    const headers = {
      cookie: accepted.headers.get("set-cookie").split(";")[0],
    };
    assert.equal(
      (await fetch(base + "/api/backups/status", { headers })).status,
      role === "admin" ? 200 : 403,
    );
    assert.equal((await fetch(base + "/api/storage", { headers })).status, 200);
  }
  const bytes = await readFile(
    new URL("./fixtures/sample.mp3", import.meta.url),
  );
  const upload = await request("/api/assets", {
    method: "POST",
    raw: bytes,
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": "Sample.mp3",
    },
  });
  assert.equal(upload.status, 201);
  assert.equal(
    (await (await request("/api/storage")).json()).usedBytes,
    bytes.length,
  );
  assert.equal(
    (
      await request("/api/workspaces", {
        method: "POST",
        body: { name: "Empty workspace" },
      })
    ).status,
    201,
  );
  assert.equal((await (await request("/api/storage")).json()).usedBytes, 0);
});
