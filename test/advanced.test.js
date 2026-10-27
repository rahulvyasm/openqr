import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, urlCode } from "./helpers.js";
import { defaultDesign } from "../shared/qr.js";
import { imageFor, normalizeDesign } from "../server/design.js";
import { payload } from "../server/payload.js";
import { codeContent } from "../src/lib.ts";
import { createApp } from "../server/app.js";

const decode = (buffer) => {
  const image = PNG.sync.read(buffer);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)
    ?.data;
};
const create = async (request, body) => {
  const res = await request("/api/codes", { method: "POST", body });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
};
test("every module, finder and frame combination produces a decodable QR", async () => {
  const content = "https://qr.example.com/r/summer-launch";
  for (const module of ["square", "rounded", "dots"])
    for (const eye of ["square", "rounded", "circle"])
      for (const frame of ["none", "border", "banner"]) {
        const design = {
          ...defaultDesign,
          module,
          eye,
          frame,
          caption: "MEET SOMETHING GOOD",
        };
        assert.equal(
          decode(await imageFor(content, design, "#285b48", "png", 512)),
          content,
          `${module}/${eye}/${frame}`,
        );
      }
});
test("logos are sanitized, embedded in PNG/SVG, and preserve decodability", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const logo =
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 32, height: 32, channels: 4, background: "#c67745" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  const code = await create(
    request,
    urlCode({
      design: {
        ...defaultDesign,
        logo,
        module: "rounded",
        eye: "rounded",
        frame: "banner",
        caption: "<script>alert(1)</script>",
      },
    }),
  );
  assert.match(code.design.logo, /^data:image\/png;base64,/);
  const png = await request(`/api/codes/${code.id}/download?size=2048`);
  const bytes = Buffer.from(await png.arrayBuffer());
  const image = PNG.sync.read(bytes);
  assert.equal(image.width, 2048);
  assert.equal(decode(bytes), code.shortUrl);
  const svg = await (
    await request(`/api/codes/${code.id}/download?format=svg`)
  ).text();
  assert.match(svg, /<image href="data:image\/png;base64,/);
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, /&lt;script&gt;/);
  for (const unsafe of [
    "https://example.com/logo.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,bm90LWFuLWltYWdl",
  ]) {
    const res = await request("/api/codes", {
      method: "POST",
      body: urlCode({ design: { ...defaultDesign, logo: unsafe } }),
    });
    assert.equal(res.status, 400);
  }
  await assert.rejects(
    normalizeDesign({ ...defaultDesign, background: "#000000" }, "#ffffff"),
    /dark QR modules/,
  );
});
test("bulk imports are atomic on validation and duplicate-slug failures", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const valid = urlCode({ slug: "bulk-test-one" });
  let response = await request("/api/codes/bulk", {
    method: "POST",
    body: { codes: [valid, urlCode({ data: { url: "javascript:alert(1)" } })] },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Row 3/);
  assert.equal((await (await request("/api/codes")).json()).length, 0);
  response = await request("/api/codes/bulk", {
    method: "POST",
    body: { codes: [valid, valid] },
  });
  assert.equal(response.status, 409);
  assert.equal((await (await request("/api/codes")).json()).length, 0);
  response = await request("/api/codes/bulk", {
    method: "POST",
    body: {
      codes: [valid, urlCode({ name: "Second code" })],
      common: {
        color: "#733855",
        design: { ...defaultDesign, module: "dots" },
      },
    },
  });
  assert.equal(response.status, 201);
  const codes = await response.json();
  assert.equal(codes.length, 2);
  assert.equal(codes[0].color, "#733855");
  assert.equal(codes[1].design.module, "dots");
  assert.equal(
    (
      await request("/api/codes/bulk", {
        method: "POST",
        body: { codes: Array.from({ length: 101 }, () => urlCode()) },
      })
    ).status,
    400,
  );
});
test("batch ZIPs contain usable codes and a matching manifest", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const a = await create(
      request,
      urlCode({ name: "../../my/campaign", slug: "zip-first" }),
    ),
    b = await create(
      request,
      urlCode({
        name: "Second",
        slug: "zip-second",
        type: "text",
        dynamic: false,
        data: { text: "Hello from a batch" },
      }),
    );
  for (const format of ["png", "svg"]) {
    const response = await request("/api/codes/export", {
      method: "POST",
      body: { ids: [a.id, b.id], format, size: 512 },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/zip/);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    assert.equal(Object.keys(files).length, 3);
    assert.ok(
      Object.keys(files).every(
        (name) => !name.includes("/") && !name.includes(".."),
      ),
    );
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    assert.equal(manifest[0].shortUrl, a.shortUrl);
    assert.equal(manifest[1].shortUrl, null);
    if (format === "png") {
      assert.equal(
        decode(
          Buffer.from(
            files[
              Object.keys(files).find((name) => name.endsWith(`zip-first.png`))
            ],
          ),
        ),
        a.shortUrl,
      );
      assert.equal(
        decode(
          Buffer.from(
            files[
              Object.keys(files).find((name) => name.endsWith(`zip-second.png`))
            ],
          ),
        ),
        "Hello from a batch",
      );
    }
  }
});
test("batch pause/resume/move/delete and duplicated codes keep history separate", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const a = await create(request, urlCode()),
    b = await create(request, urlCode({ dynamic: false }));
  await request(`/r/${a.slug}`);
  const duplicate = await request(`/api/codes/${a.id}/duplicate`, {
    method: "POST",
    body: {},
  });
  assert.equal(duplicate.status, 201);
  const copy = await duplicate.json();
  assert.notEqual(copy.slug, a.slug);
  assert.equal(copy.scans, 0);
  assert.match(copy.name, /\(copy\)/);
  const ids = [a.id, b.id];
  let res = await request("/api/codes/batch", {
    method: "POST",
    body: { ids, action: "pause" },
  });
  assert.equal((await res.json()).affected, 1);
  assert.equal((await request(`/r/${a.slug}`)).status, 410);
  await request("/api/codes/batch", {
    method: "POST",
    body: { ids, action: "resume" },
  });
  assert.equal((await request(`/r/${a.slug}`)).status, 302);
  const folder = await (
    await request("/api/folders", {
      method: "POST",
      body: { name: "Bulk collection" },
    })
  ).json();
  await request("/api/codes/batch", {
    method: "POST",
    body: { ids, action: "move", folderId: folder.id },
  });
  const codes = await (await request("/api/codes")).json();
  assert.equal(codes.filter((c) => c.folderId === folder.id).length, 2);
  await request("/api/codes/batch", {
    method: "POST",
    body: { ids, action: "delete" },
  });
  assert.equal((await (await request("/api/codes")).json()).length, 1);
  assert.equal((await (await request("/api/analytics")).json()).total, 0);
});
test("campaign windows and limits block visits before scan recording", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const future = await create(
    request,
    urlCode({ campaign: { startsAt: "2999-01-01T00:00:00Z" } }),
  );
  assert.equal((await request(`/r/${future.slug}`)).status, 423);
  const expired = await create(
    request,
    urlCode({ campaign: { expiresAt: "2000-01-01T00:00:00Z" } }),
  );
  assert.equal((await request(`/r/${expired.slug}`)).status, 410);
  const limited = await create(
    request,
    urlCode({ campaign: { scanLimit: 2 } }),
  );
  assert.equal(
    (await request(`/r/${limited.slug}`, { method: "HEAD" })).status,
    302,
  );
  const results = await Promise.all(
    Array.from({ length: 6 }, () => request(`/r/${limited.slug}`)),
  );
  assert.equal(results.filter((r) => r.status === 302).length, 2);
  assert.equal(results.filter((r) => r.status === 410).length, 4);
  assert.equal((await (await request("/api/analytics")).json()).total, 2);
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({
          campaign: {
            startsAt: "2030-01-02T00:00:00Z",
            expiresAt: "2030-01-01T00:00:00Z",
          },
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({ dynamic: false, campaign: { scanLimit: 2 } }),
      })
    ).status,
    400,
  );
});
test("custom links are unique and immutable; UTM tags merge with existing query parameters", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const code = await create(
    request,
    urlCode({
      slug: "summer-2026",
      data: { url: "https://example.com/?hello=world&utm_source=old#section" },
      campaign: {
        utmSource: "poster & print",
        utmMedium: "QR",
        utmCampaign: "summer",
      },
    }),
  );
  assert.equal(code.shortUrl, "http://localhost:5173/r/summer-2026");
  const url = new URL(
    (await request(`/r/${code.slug}`)).headers.get("location"),
  );
  assert.equal(url.searchParams.get("utm_source"), "poster & print");
  assert.equal(url.searchParams.get("hello"), "world");
  assert.equal(url.searchParams.get("utm_medium"), "QR");
  assert.equal(url.hash, "#section");
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({ slug: "summer-2026" }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...code, slug: "new-slug" },
      })
    ).status,
    400,
  );
});
test("hosted pages are editable, tracked, safe HTML with validated destination links", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const body = urlCode({
    type: "links",
    data: {
      title: "<script>Studio</script>",
      description: "<img src=x onerror=alert(1)>",
      links: JSON.stringify([
        { title: "Our <website>", url: "https://example.com/?a=1&b=2" },
      ]),
    },
  });
  const code = await create(request, body);
  const page = await request(`/r/${code.slug}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;script&gt;Studio/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...code, data: { ...code.data, title: "Studio North" } },
      })
    ).status,
    200,
  );
  assert.match(await (await request(`/r/${code.slug}`)).text(), /Studio North/);
  assert.equal(
    (await (await request(`/api/analytics?codeId=${code.id}`)).json()).total,
    2,
  );
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: {
          ...body,
          data: {
            title: "Unsafe",
            links: '[{"title":"Click","url":"javascript:alert(1)"}]',
          },
        },
      })
    ).status,
    400,
  );
});
test("design templates persist per owner and do not mutate existing codes", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const body = {
    name: "Our brand",
    color: "#733855",
    design: { ...defaultDesign, module: "dots", frame: "border" },
  };
  const saved = await request("/api/templates", { method: "POST", body });
  assert.equal(saved.status, 201);
  const template = await saved.json();
  assert.equal(
    (await request("/api/templates", { method: "POST", body })).status,
    409,
  );
  const code = await create(
    request,
    urlCode({ design: template.design, color: template.color }),
  );
  assert.equal(
    (await request(`/api/templates/${template.id}`, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await (await request("/api/templates")).json()).length, 0);
  assert.equal(
    (await (await request("/api/codes")).json())[0].design.module,
    "dots",
  );
  assert.equal(code.color, "#733855");
});
test("analytics report browser, OS, referrer host and top codes without storing raw identifiers", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const code = await create(request, urlCode());
  await request(`/r/${code.slug}`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537",
      referer: "https://example.org/private?secret=value",
    },
  });
  const data = await (await request("/api/analytics")).json();
  assert.equal(data.browsers.Chrome, 1);
  assert.equal(data.operatingSystems.Windows, 1);
  assert.equal(data.referrers["example.org"], 1);
  assert.equal(data.topCodes[0].id, code.id);
  const row = db.prepare("SELECT * FROM scans").get();
  assert.equal(row.referrer, "example.org");
  assert.ok(!JSON.stringify(row).includes("secret=value"));
  assert.equal(row.visitor.length, 64);
});
test("batch and template operations respect ownership and reject duplicates and unknown IDs", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const own = await create(request, urlCode());
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
    "other-owner",
    "other@example.com",
    "Other",
    "salt",
    "hash",
  );
  db.prepare(
    "INSERT INTO codes (id,user_id,slug,name,type,dynamic,data,folder_id,color,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "other-code",
    "other-owner",
    "other-slug",
    "Other",
    "url",
    1,
    '{"url":"https://example.com"}',
    null,
    "#163f32",
    1,
    new Date().toISOString(),
  );
  for (const path of ["/api/codes/export", "/api/codes/batch"])
    assert.equal(
      (
        await request(path, {
          method: "POST",
          body: { ids: [own.id, "other-code"], action: "delete" },
        })
      ).status,
      404,
    );
  assert.equal((await (await request("/api/codes")).json()).length, 1);
  assert.equal(
    (
      await request("/api/codes/batch", {
        method: "POST",
        body: { ids: [own.id, own.id], action: "delete" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/codes/other-code/duplicate", {
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
});
test("legacy v0.1 databases migrate without changing printed tracking links or scan history", () => {
  const dir = mkdtempSync(join(tmpdir(), "openqr-migration-")),
    path = join(dir, "legacy.sqlite");
  let old, upgraded;
  try {
    old = new DatabaseSync(path);
    old.exec(
      `PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL); CREATE TABLE codes (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,dynamic INTEGER NOT NULL,data TEXT NOT NULL,folder_id TEXT,color TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL); CREATE TABLE scans (id INTEGER PRIMARY KEY,code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,scanned_at TEXT NOT NULL,visitor TEXT NOT NULL,device TEXT NOT NULL); INSERT INTO users VALUES ('owner','owner@example.com','Owner','salt','hash'); INSERT INTO codes VALUES ('legacy','owner','printed-code','Legacy','url',1,'{"url":"https://example.com"}',NULL,'#163f32',1,'2026-01-01T00:00:00Z'); INSERT INTO scans VALUES (1,'legacy','2026-01-01T00:00:00Z','hashed-visitor','Mobile');`,
    );
    old.close();
    old = null;
    upgraded = createApp({ dbPath: path });
    assert.equal(
      upgraded.db.prepare("SELECT slug FROM codes").get().slug,
      "printed-code",
    );
    assert.equal(
      upgraded.db.prepare("SELECT COUNT(*) AS n FROM scans").get().n,
      1,
    );
    assert.equal(
      upgraded.db.prepare("SELECT design FROM codes").get().design,
      "{}",
    );
    assert.equal(
      upgraded.db.prepare("PRAGMA user_version").get().user_version,
      5,
    );
    upgraded.db.close();
    upgraded = null;
    const again = createApp({ dbPath: path });
    again.db.close();
  } finally {
    old?.close();
    upgraded?.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("new static content types share exactly the same preview and exported payload", () => {
  for (const code of [
    { type: "sms", data: { phone: "+1 (555) 123-4567", message: "Hi there" } },
    {
      type: "whatsapp",
      data: { phone: "+91 98765 43210", message: "Hi & hello" },
    },
    { type: "location", data: { latitude: "28.6139", longitude: "77.2090" } },
    {
      type: "event",
      data: {
        title: "Launch\nparty",
        startsAt: "2027-01-01T10:00:00Z",
        endsAt: "2027-01-01T11:00:00Z",
        location: "Studio",
        description: "Meet; greet",
      },
    },
  ])
    assert.equal(
      codeContent({ ...code, dynamic: false, shortUrl: "" }),
      payload(code),
    );
  assert.throws(
    () =>
      payload({ type: "location", data: { latitude: "91", longitude: "181" } }),
    /latitude/,
  );
});
