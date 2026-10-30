import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { fixture, urlCode } from "./helpers.js";

const run = promisify(execFile);
const origin = "http://localhost:5173";

function client(base) {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  };
}

test(
  "recovery drill: CLI snapshot survives restart with links, media, scans and team permissions",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "openqr-recovery-"));
    const cleanups = [];
    const resources = { after: (cleanup) => cleanups.push(cleanup) };
    t.after(async () => {
      try {
        for (const cleanup of cleanups.reverse()) await cleanup();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    const source = join(root, "source"),
      destination = join(root, "restored");
    await mkdir(source);
    const { request, setup, base } = await fixture(
      resources,
      join(source, "openqr.sqlite"),
    );
    await setup();
    const invitationResponse = await request("/api/invitations", {
      method: "POST",
      body: { email: "viewer@example.com", role: "viewer" },
    });
    assert.equal(invitationResponse.status, 201);
    const invitation = await invitationResponse.json();
    const viewer = client(base);
    assert.equal(
      (
        await viewer("/api/auth/invite/accept", {
          method: "POST",
          body: {
            token: new URL(invitation.url).hash.slice("#invite=".length),
            name: "Recovery Viewer",
            password: "recovery-viewer-password",
          },
        })
      ).status,
      200,
    );
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Recovery drill document");
    const bytes = Buffer.from(await pdf.save());
    const upload = await request("/api/assets", {
      method: "POST",
      raw: bytes,
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "Recovery.pdf",
      },
    });
    assert.equal(upload.status, 201);
    const asset = await upload.json();
    const codes = [];
    for (const body of [
      urlCode(),
      urlCode({
        name: "Recovery PDF",
        type: "pdf",
        data: { title: "Recovery guide", pdfId: asset.id },
      }),
    ]) {
      const response = await request("/api/codes", { method: "POST", body });
      assert.equal(response.status, 201);
      codes.push(await response.json());
    }
    const [website, guide] = codes;
    await request(`/r/${website.slug}`);
    await request(`/r/${website.slug}`);
    await request(`/r/${guide.slug}`);
    assert.equal((await (await request("/api/analytics")).json()).total, 3);

    // Isolate the operator commands from local .env files and cloud credentials/configuration.
    const cli = resolve("server/backup-cli.js");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(S3_|AWS_|DOTENV_CONFIG_)/i.test(key),
      ),
    );
    Object.assign(env, {
      PUBLIC_URL: origin,
      DOTENV_CONFIG_PATH: join(root, "absent.env"),
      BACKUP_RETENTION: "7",
    });
    await run(process.execPath, [cli, "backup"], {
      cwd: root,
      env: { ...env, DATA_DIR: source },
      timeout: 20000,
    });
    const archives = (await readdir(join(source, "backups"))).filter((name) =>
      name.endsWith(".tar.gz"),
    );
    assert.equal(archives.length, 1);
    const archive = join(source, "backups", archives[0]);

    // Changes after the snapshot must not leak into the recovered installation.
    assert.equal(
      (
        await request(`/api/codes/${website.id}`, {
          method: "PUT",
          body: urlCode({
            data: { url: "https://example.com/after-snapshot" },
          }),
        })
      ).status,
      200,
    );
    await request(`/r/${website.slug}`);
    await mkdir(join(destination, "media"), { recursive: true });
    await writeFile(
      join(destination, "openqr.sqlite"),
      "previous installation",
    );
    await writeFile(
      join(destination, "media", "previous.txt"),
      "previous media",
    );
    await run(
      process.execPath,
      [cli, "restore", "--archive", archive, "--confirm-stopped"],
      {
        cwd: root,
        env: { ...env, DATA_DIR: destination },
        timeout: 20000,
      },
    );
    const history = await readdir(join(destination, "restore-history"));
    assert.equal(history.length, 1);
    assert.equal(
      await readFile(
        join(destination, "restore-history", history[0], "openqr.sqlite"),
        "utf8",
      ),
      "previous installation",
    );
    assert.equal(
      await readFile(
        join(
          destination,
          "restore-history",
          history[0],
          "media",
          "previous.txt",
        ),
        "utf8",
      ),
      "previous media",
    );

    const recovered = await fixture(
      resources,
      join(destination, "openqr.sqlite"),
    );
    assert.equal((await recovered.request("/health/ready")).status, 200);
    assert.equal(
      (
        await recovered.request("/api/auth/login", {
          method: "POST",
          body: {
            email: "owner@example.com",
            password: "a-secure-test-password",
          },
        })
      ).status,
      200,
    );
    const status = await (await recovered.request("/api/auth/status")).json();
    assert.equal(status.workspace.role, "owner");
    const recoveredCodes = await (await recovered.request("/api/codes")).json();
    assert.deepEqual(
      recoveredCodes.map((c) => c.id).sort(),
      codes.map((c) => c.id).sort(),
    );
    for (const original of codes) {
      const restored = recoveredCodes.find((c) => c.id === original.id);
      assert.equal(restored.slug, original.slug);
      assert.equal(restored.scans, original.id === website.id ? 2 : 1);
    }
    assert.equal(
      (await (await recovered.request("/api/analytics")).json()).total,
      3,
    );
    const redirect = await recovered.request(`/r/${website.slug}`, {
      authenticated: false,
    });
    assert.equal(redirect.status, 302);
    assert.equal(
      redirect.headers.get("location"),
      "https://example.com/original",
    );
    const page = await recovered.request(`/r/${guide.slug}`, {
      authenticated: false,
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Recovery guide/);
    const ticket = html.match(/\?ticket=([^"&]+)/)?.[1];
    assert.ok(ticket, "restored hosted page issues a media ticket");
    const download = await recovered.request(
      `/r/${guide.slug}/media/${asset.id}?ticket=${ticket}`,
      { authenticated: false },
    );
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(
      (await recovered.request(asset.url, { authenticated: false })).status,
      401,
    );
    assert.equal(
      (await (await recovered.request("/api/analytics")).json()).total,
      5,
    );

    const restoredViewer = client(recovered.base);
    assert.equal(
      (
        await restoredViewer("/api/auth/login", {
          method: "POST",
          body: {
            email: "viewer@example.com",
            password: "recovery-viewer-password",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await restoredViewer("/api/auth/status")).json()).workspace.id,
      status.workspace.id,
    );
    assert.equal(
      (await (await restoredViewer("/api/auth/status")).json()).workspace.role,
      "viewer",
    );
    assert.equal((await restoredViewer("/api/codes")).status, 200);
    assert.equal(
      (await restoredViewer(`/api/codes/${website.id}`, { method: "DELETE" }))
        .status,
      403,
    );
    assert.equal(
      (await restoredViewer("/api/codes", { method: "POST", body: urlCode() }))
        .status,
      403,
    );
  },
);
