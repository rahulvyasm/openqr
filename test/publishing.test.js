import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { fixture, urlCode } from "./helpers.js";
import { defaultDesign } from "../shared/qr.js";
import { imageFor, normalizeDesign } from "../server/design.js";
import { createBackup, restoreBackup } from "../server/backup.js";
import { createApp } from "../server/app.js";
import { publicTicket, validPublicTicket } from "../server/public-access.js";
import { contactCard } from "../shared/contact.js";

async function document() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).drawText("Hello from OpenQR");
  return Buffer.from(await pdf.save());
}
async function upload(request, bytes, name = "Guide.pdf", kind = "") {
  const res = await request("/api/assets" + kind, {
    method: "POST",
    raw: bytes,
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(name),
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
async function create(request, type, data, extra = {}) {
  const res = await request("/api/codes", {
    method: "POST",
    body: urlCode({ type, data, ...extra }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}
const ticketFrom = (html) =>
  decodeURIComponent(html.match(/\?ticket=([^"&]+)/)[1]);
const media = (code, asset, ticket) =>
  `/r/${code.slug}/media/${asset.id}?ticket=${encodeURIComponent(ticket)}`;

test("media uploads inspect content, re-encode images and enforce workspace privacy", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const pdf = await document(),
    asset = await upload(request, pdf, "A guide.pdf");
  assert.equal(asset.mime, "application/pdf");
  assert.equal(asset.pages, 1);
  assert.deepEqual(
    Buffer.from(await (await request(asset.url)).arrayBuffer()),
    pdf,
  );
  assert.equal(
    (await request(asset.url, { authenticated: false })).status,
    401,
  );
  const png = await sharp({
    create: { width: 1900, height: 30, channels: 3, background: "#447744" },
  })
    .png()
    .toBuffer();
  const image = await upload(request, png, "portrait.jpg");
  assert.equal(image.mime, "image/jpeg");
  const meta = await sharp(
    Buffer.from(await (await request(image.url)).arrayBuffer()),
  ).metadata();
  assert.equal(meta.width, 1600);
  const logo = await upload(request, png, "logo.png", "?kind=logo");
  assert.equal(logo.kind, "logo");
  assert.equal(logo.mime, "image/png");
  assert.equal(
    (
      await sharp(
        Buffer.from(await (await request(logo.url)).arrayBuffer()),
      ).metadata()
    ).width,
    128,
  );
  for (const bytes of [
    Buffer.from("<svg><script>alert(1)</script></svg>"),
    Buffer.from("%PDF-not-valid"),
    Buffer.from("<html>no</html>"),
  ])
    assert.equal(
      (
        await request("/api/assets", {
          method: "POST",
          raw: bytes,
          headers: { "content-type": "application/octet-stream" },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request("/api/assets?kind=logo", {
        method: "POST",
        raw: pdf,
        headers: { "content-type": "application/octet-stream" },
      })
    ).status,
    400,
  );
  const workspace = await (
    await request("/api/workspaces", {
      method: "POST",
      body: { name: "Other workspace" },
    })
  ).json();
  assert.ok(workspace.id);
  assert.equal((await request("/api/assets")).status, 200);
  assert.equal((await (await request("/api/assets")).json()).length, 0);
  assert.equal((await request(asset.url)).status, 404);
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({
          type: "pdf",
          data: { title: "Cross workspace", pdfId: asset.id },
        }),
      })
    ).status,
    400,
  );
});

test("published PDFs use code-bound tickets; a final allowed scan still loads its document", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const bytes = await document(),
    asset = await upload(request, bytes);
  const code = await create(
    request,
    "pdf",
    {
      title: "Our guide",
      description: "A better introduction.",
      pdfId: asset.id,
    },
    { campaign: { scanLimit: 1 } },
  );
  const path = `/r/${code.slug}`,
    page = await request(path, { authenticated: false });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Our guide/);
  assert.match(html, /1 page/);
  const ticket = ticketFrom(html),
    download = await request(media(code, asset, ticket), {
      authenticated: false,
    });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.match(download.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const metadata = await request(
    `/r/${code.slug}/document/${asset.id}?ticket=${ticket}`,
    { authenticated: false },
  );
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).name, "Guide.pdf");
  assert.match(html, new RegExp(`/view/${code.slug}/${asset.id}`));
  assert.equal(
    (
      await request(`/r/${code.slug}/document/${asset.id}`, {
        authenticated: false,
      })
    ).status,
    403,
  );
  assert.equal((await request(path, { authenticated: false })).status, 410);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scans").get().n, 1);
  assert.equal(
    (
      await request(`/r/${code.slug}/media/${asset.id}`, {
        authenticated: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(media(code, asset, "invalid"), { authenticated: false }))
      .status,
    403,
  );
  const other = await create(request, "pdf", {
    title: "Second",
    pdfId: asset.id,
  });
  assert.equal(
    (await request(media(other, asset, ticket), { authenticated: false }))
      .status,
    403,
  );
  await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...code, active: false },
  });
  assert.equal(
    (await request(media(code, asset, ticket), { authenticated: false }))
      .status,
    410,
  );
  assert.equal(
    (
      await request(`/r/${code.slug}/document/${asset.id}?ticket=${ticket}`, {
        authenticated: false,
      })
    ).status,
    410,
  );
});

test("document replacement preserves the printed link and prevents deletion of referenced media", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const one = await upload(request, await document(), "First.pdf"),
    two = await upload(request, await document(), "Second.pdf");
  const code = await create(request, "pdf", {
    title: "Catalog",
    pdfId: one.id,
    direct: "true",
  });
  const redirect = await request(`/r/${code.slug}`, { authenticated: false });
  assert.equal(redirect.status, 302);
  assert.match(redirect.headers.get("location"), new RegExp(one.id));
  assert.equal(
    (await request(`/api/assets/${one.id}`, { method: "DELETE" })).status,
    409,
  );
  const response = await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...code, data: { ...code.data, pdfId: two.id } },
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.shortUrl, code.shortUrl);
  assert.equal(
    (await request(`/api/assets/${one.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await request(one.url)).status, 404);
  const duplicate = await (
    await request(`/api/codes/${code.id}/duplicate`, { method: "POST" })
  ).json();
  assert.equal(duplicate.data.pdfId, two.id);
  const next = await request(`/r/${code.slug}`, { authenticated: false });
  assert.match(next.headers.get("location"), new RegExp(two.id));
});

test("digital contacts publish escaped pages, themed images and escaped downloadable vCards", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const portrait = await upload(
    request,
    await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#778855" },
    })
      .png()
      .toBuffer(),
    "Portrait.png",
  );
  const code = await create(
    request,
    "contact",
    {
      fullName: "Alex <script> & Morgan",
      company: "Acme; Inc.",
      jobTitle: "Founder",
      phone: "+1 555 123 4567",
      email: "alex@example.com",
      website: "https://example.com",
      address: "123 Main St",
      description: "Hello\nthere",
      portraitId: portrait.id,
    },
    { pageOptions: { theme: "bold", accent: "#202b50", showBrand: false } },
  );
  const html = await (
    await request(`/r/${code.slug}`, { authenticated: false })
  ).text();
  assert.match(html, /Alex &lt;script&gt; &amp; Morgan/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("Made with OpenQR"));
  assert.match(html, /#202b50/);
  const ticket = ticketFrom(html);
  assert.equal(
    (await request(media(code, portrait, ticket), { authenticated: false }))
      .status,
    200,
  );
  const res = await request(`/r/${code.slug}/contact.vcf?ticket=${ticket}`, {
    authenticated: false,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/vcard/);
  const card = await res.text();
  assert.match(card, /BEGIN:VCARD\r\nVERSION:3.0/);
  assert.ok(card.includes("ORG:Acme\\; Inc."));
  assert.ok(card.includes("NOTE:Hello\\nthere"));
  assert.match(card, /TITLE:Founder/);
});

test("downloadable vCards escape CR-only line breaks and fold Unicode without splitting a character", () => {
  const card = contactCard({
    fullName: "Alex\rInjected:VALUE",
    company: "界".repeat(60),
  });
  assert.ok(card.includes("FN:Alex\\nInjected:VALUE"));
  assert.ok(!card.includes("\rInjected:"));
  for (const line of card.trimEnd().split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.ok(card.replace(/\r\n /g, "").includes("ORG:" + "界".repeat(60)));
});

test("business and social pages validate links, schedules, colors and page options", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const hours = JSON.stringify(
    Array.from({ length: 7 }, (_, i) => ({
      closed: i > 4,
      open: "09:00",
      close: "17:00",
    })),
  );
  const business = await create(request, "business", {
    title: "The little studio",
    description: "Made by us",
    address: "1 Market Street",
    website: "https://example.com",
    hours,
    links: JSON.stringify([{ title: "Shop", url: "https://example.com/shop" }]),
  });
  const html = await (
    await request(`/r/${business.slug}`, { authenticated: false })
  ).text();
  assert.match(html, /Monday/);
  assert.match(html, /Closed/);
  assert.match(html, /Get directions/);
  assert.match(html, /https:\/\/example.com\/shop/);
  const social = await create(request, "social", {
    title: "Find us",
    links: JSON.stringify([
      {
        platform: "instagram",
        title: "Our Instagram",
        url: "https://instagram.com/example",
      },
    ]),
  });
  assert.match(
    await (await request(`/r/${social.slug}`, { authenticated: false })).text(),
    /Our Instagram/,
  );
  for (const body of [
    urlCode({
      type: "business",
      data: { title: "Unsafe", website: "javascript:alert(1)" },
    }),
    urlCode({ type: "social", data: { title: "No links", links: "[]" } }),
    urlCode({
      type: "social",
      data: {
        title: "Unsafe",
        links: JSON.stringify([{ title: "Unsafe", url: "data:text/html,bad" }]),
      },
    }),
    urlCode({ type: "business", data: { title: "Hours", hours: "[{}]" } }),
    urlCode({ type: "contact", dynamic: false, data: { fullName: "Name" } }),
    urlCode({ type: "pdf", data: { title: "Missing" } }),
    urlCode({
      type: "contact",
      data: { fullName: "Name" },
      pageOptions: { accent: "red; color:black" },
    }),
  ])
    assert.equal(
      (await request("/api/codes", { method: "POST", body })).status,
      400,
    );
});

test("expanded designer shapes, per-corner styling, marks and caption positions remain decodable", async () => {
  const content = "https://qr.example.com/r/design-check";
  const designs = [];
  for (const module of [
    "square",
    "gapped",
    "rounded",
    "dots",
    "vertical",
    "horizontal",
    "connected",
  ])
    for (const eye of ["square", "rounded", "circle", "leaf"])
      designs.push({ ...defaultDesign, module, eye });
  for (const frame of ["border", "banner", "pill", "speech", "ticket", "stamp"])
    for (const captionPosition of ["top", "bottom"])
      designs.push({
        ...defaultDesign,
        frame,
        captionPosition,
        caption: "HELLO FROM OPENQR",
        captionSize: "large",
      });
  for (const mark of ["globe", "arrow", "heart", "scan"])
    designs.push({ ...defaultDesign, mark, logoScale: 0.18 });
  designs.push({
    ...defaultDesign,
    innerEye: "leaf",
    outerColor: "#202b50",
    innerColor: "#733855",
    corners: {
      tl: { outer: "leaf", inner: "circle", outerColor: "#285b48" },
      tr: { outer: "rounded", inner: "square" },
      bl: { outer: "circle", inner: "leaf" },
    },
  });
  for (const design of designs) {
    await normalizeDesign(design, "#163f32");
    const png = PNG.sync.read(
      await imageFor(content, design, "#163f32", "png", 512),
    );
    assert.equal(
      jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
      content,
      JSON.stringify(design),
    );
  }
  await assert.rejects(
    normalizeDesign({ ...defaultDesign, innerColor: "#dddddd" }, "#163f32"),
    /high-contrast/,
  );
  await assert.rejects(
    normalizeDesign(
      { ...defaultDesign, corners: { tl: { outerColor: "#eeeeee" } } },
      "#163f32",
    ),
    /high-contrast/,
  );
});

test("backup restores accounts, permissions, QR links, history and media as one snapshot", async (t) => {
  const { request, setup, db, storage } = await fixture(t);
  await setup();
  const bytes = await document(),
    asset = await upload(request, bytes),
    code = await create(request, "pdf", {
      title: "Preserved guide",
      pdfId: asset.id,
    });
  await request(`/r/${code.slug}`);
  const folder = await mkdtemp(join(tmpdir(), "openqr-backup-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const archive = await createBackup({
      db,
      storage,
      directory: join(folder, "backups"),
      publicUrl: "https://qr.example.com",
    }),
    destination = join(folder, "restored");
  await assert.rejects(
    restoreBackup({ archive, dataDir: destination }),
    /confirm-stopped/,
  );
  const before = createApp({ dbPath: ":memory:" });
  before.db.close();
  await before.storage.dispose();
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "openqr.sqlite"), "previous data");
  await mkdir(join(destination, "media"));
  await writeFile(join(destination, "media", "previous.txt"), "preserve this");
  const restored = await restoreBackup({
    archive,
    dataDir: destination,
    confirmedStopped: true,
  });
  assert.equal(restored.publicUrl, "https://qr.example.com");
  assert.equal(
    await readFile(join(restored.history, "openqr.sqlite"), "utf8"),
    "previous data",
  );
  assert.equal(
    await readFile(join(restored.history, "media", "previous.txt"), "utf8"),
    "preserve this",
  );
  const app = createApp({ dbPath: join(destination, "openqr.sqlite") });
  try {
    assert.equal(
      app.db.prepare("SELECT slug FROM codes WHERE id=?").get(code.id).slug,
      code.slug,
    );
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM scans").get().n, 1);
    assert.equal(
      app.db.prepare("SELECT role FROM members").get().role,
      "owner",
    );
    const stored = app.db
      .prepare("SELECT * FROM assets WHERE id=?")
      .get(asset.id);
    assert.deepEqual(
      await readFile(app.storage.filePath(stored.storage_key)),
      bytes,
    );
    assert.equal(app.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    app.db.close();
  }
});

test("restore rejects unsupported archives and tampering before touching existing data", async (t) => {
  const { request, setup, db, storage } = await fixture(t);
  await setup();
  await upload(request, await document());
  const folder = await mkdtemp(join(tmpdir(), "openqr-restore-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const archive = await createBackup({
      db,
      storage,
      directory: join(folder, "backups"),
      publicUrl: "https://qr.example.com",
    }),
    stage = join(folder, "tampered"),
    target = join(folder, "target");
  await mkdir(stage);
  await mkdir(target);
  await writeFile(join(target, "openqr.sqlite"), "keep me");
  await tar.x({ file: archive, cwd: stage });
  await writeFile(join(stage, "openqr.sqlite"), "bad database");
  const bad = join(folder, "bad.tar.gz");
  await tar.c({ gzip: true, file: bad, cwd: stage }, [
    "manifest.json",
    "openqr.sqlite",
    "media",
  ]);
  await assert.rejects(
    restoreBackup({ archive: bad, dataDir: target, confirmedStopped: true }),
    /checksum/,
  );
  assert.equal(
    await readFile(join(target, "openqr.sqlite"), "utf8"),
    "keep me",
  );
  await writeFile(join(stage, "unwanted.txt"), "not allowed");
  const unsupported = join(folder, "unsupported.tar.gz");
  await tar.c({ gzip: true, file: unsupported, cwd: stage }, ["unwanted.txt"]);
  await assert.rejects(
    restoreBackup({
      archive: unsupported,
      dataDir: target,
      confirmedStopped: true,
    }),
    /unsupported archive/,
  );
  const traversal = join(folder, "traversal.tar.gz");
  await tar.c(
    { gzip: true, file: traversal, cwd: stage, prefix: "../escape" },
    ["unwanted.txt"],
  );
  await assert.rejects(
    restoreBackup({
      archive: traversal,
      dataDir: target,
      confirmedStopped: true,
    }),
    /unsupported archive/,
  );
  await assert.rejects(
    restoreBackup({
      archive,
      dataDir: target,
      confirmedStopped: true,
      maxBytes: 1,
    }),
    /restore limit/,
  );
  assert.equal(
    await readFile(join(target, "openqr.sqlite"), "utf8"),
    "keep me",
  );
});

test("backups retain only the configured count and leave unrelated files alone", async (t) => {
  const { db, storage } = await fixture(t),
    folder = await mkdtemp(join(tmpdir(), "openqr-retention-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, "notes.txt"), "keep");
  for (let i = 0; i < 3; i++)
    await createBackup({
      db,
      storage,
      directory: folder,
      publicUrl: "https://qr.example.com",
      retention: 2,
    });
  const files = await readdir(folder);
  assert.equal(files.filter((f) => f.endsWith(".tar.gz")).length, 2);
  assert.ok(files.includes("notes.txt"));
  assert.ok(!files.some((f) => f.startsWith(".openqr-")));
});

test("viewer permissions apply to uploads, deletion and media downloads in existing sessions", async (t) => {
  const { request, setup, base, db } = await fixture(t);
  await setup();
  const asset = await upload(request, await document());
  const invitation = await (
    await request("/api/invitations", {
      method: "POST",
      body: { email: "viewer@example.com", role: "viewer" },
    })
  ).json();
  const accepted = await fetch(base + "/api/auth/invite/accept", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token: new URL(invitation.url).hash.slice("#invite=".length),
      name: "Viewer",
      password: "viewer-secure-password",
    }),
  });
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get("set-cookie").split(";")[0],
    headers = { cookie, origin: "http://localhost:5173" };
  assert.equal((await fetch(base + asset.url, { headers })).status, 200);
  assert.equal(
    (
      await fetch(base + "/api/assets", {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream" },
        body: await document(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + `/api/assets/${asset.id}`, {
        method: "DELETE",
        headers,
      })
    ).status,
    403,
  );
  const viewer = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get("viewer@example.com");
  await request(`/api/team/${viewer.id}`, { method: "DELETE" });
  assert.equal((await fetch(base + asset.url, { headers })).status, 403);
});

test("file tickets expire, are code-bound, and cannot bypass pause, schedule or expiry", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const asset = await upload(request, await document()),
    unused = await upload(request, await document(), "Unused.pdf"),
    code = await create(request, "pdf", { title: "Timed", pdfId: asset.id });
  const token = ticketFrom(await (await request(`/r/${code.slug}`)).text());
  assert.equal(
    (await request(media(code, unused, token), { authenticated: false }))
      .status,
    404,
  );
  for (const [campaign, status] of [
    [{ startsAt: new Date(Date.now() + 3600000).toISOString() }, 423],
    [{ expiresAt: new Date(Date.now() - 3600000).toISOString() }, 410],
  ]) {
    await request(`/api/codes/${code.id}`, {
      method: "PUT",
      body: { ...code, campaign },
    });
    assert.equal(
      (await request(media(code, asset, token), { authenticated: false }))
        .status,
      status,
    );
  }
  const secret = db
    .prepare("SELECT value FROM config WHERE key='analytics_salt'")
    .get().value;
  assert.ok(validPublicTicket(token, code.id, secret));
  assert.ok(!validPublicTicket(token, unused.id, secret));
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const expiring = publicTicket(code.id, secret);
  t.mock.method(Date, "now", () => now + 16 * 60000);
  assert.ok(!validPublicTicket(expiring, code.id, secret));
});

test("v0.3 databases migrate to publishing without changing sessions or existing QR links", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "openqr-v3-upgrade-"));
  const path = join(folder, "openqr.sqlite"),
    { request, setup, db } = await fixture(t, path);
  t.after(() => rm(folder, { recursive: true, force: true }));
  await setup();
  const code = await create(request, "url", { url: "https://example.com" });
  db.exec(
    "DROP TABLE assets; ALTER TABLE codes DROP COLUMN page_options; PRAGMA user_version=3;",
  );
  const migrated = createApp({ dbPath: path });
  try {
    assert.equal(
      migrated.db.prepare("PRAGMA user_version").get().user_version,
      4,
    );
    assert.equal(
      migrated.db.prepare("SELECT slug FROM codes WHERE id=?").get(code.id)
        .slug,
      code.slug,
    );
    assert.equal(
      migrated.db.prepare("SELECT COUNT(*) n FROM sessions").get().n,
      1,
    );
    assert.deepEqual(
      JSON.parse(
        migrated.db.prepare("SELECT page_options FROM codes").get()
          .page_options,
      ),
      {},
    );
    assert.equal(
      migrated.db.prepare("SELECT COUNT(*) n FROM assets").get().n,
      0,
    );
  } finally {
    migrated.db.close();
  }
});
