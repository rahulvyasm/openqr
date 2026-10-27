import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { createApp } from "../server/app.js";
import { payload } from "../server/payload.js";
import { codeContent } from "../src/lib.ts";

import { fixture, urlCode } from "./helpers.js";

test("owner setup, sessions, CSRF protection, sign out and sign in", async (t) => {
  const { request, setup } = await fixture(t);
  assert.equal((await request("/api/auth/status")).status, 200);
  assert.equal((await request("/api/codes")).status, 401);
  assert.equal(
    (
      await request("/api/auth/setup", {
        method: "POST",
        body: {},
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const session = await setup();
  assert.match(session.headers.get("set-cookie"), /HttpOnly/);
  assert.match(session.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(
    (await request("/api/auth/setup", { method: "POST", body: {} })).status,
    409,
  );
  assert.equal((await request("/api/codes")).status, 200);
  assert.equal(
    (await request("/api/auth/logout", { method: "POST", body: {} })).status,
    200,
  );
  assert.equal((await request("/api/codes")).status, 401);
  assert.equal(
    (
      await request("/api/auth/login", {
        method: "POST",
        body: { email: "owner@example.com", password: "incorrect-password" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/login", {
        method: "POST",
        body: {
          email: "OWNER@example.com",
          password: "a-secure-test-password",
        },
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/codes")).status, 200);
});
test("dynamic destination edits preserve QR payload; visits track; pause and delete work", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const created = await request("/api/codes", {
    method: "POST",
    body: urlCode(),
  });
  assert.equal(created.status, 201);
  const code = await created.json();
  const png = await request(`/api/codes/${code.id}/download?format=png`);
  assert.equal(png.status, 200);
  const image = PNG.sync.read(Buffer.from(await png.arrayBuffer()));
  const decoded = jsQR(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  assert.equal(decoded.data, code.shortUrl);
  assert.equal(
    (await request(`/r/${code.slug}`, { method: "HEAD" })).status,
    302,
  );
  const scan = await request(`/r/${code.slug}`, {
    headers: { "user-agent": "Test iPhone Mobile" },
  });
  assert.equal(scan.status, 302);
  assert.equal(scan.headers.get("location"), "https://example.com/original");
  assert.equal(scan.headers.get("cache-control"), "no-store");
  const changed = await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...code, data: { url: "https://example.com/new" } },
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).shortUrl, code.shortUrl);
  const second = await request(`/r/${code.slug}`, {
    headers: { "user-agent": "Test iPhone Mobile" },
  });
  assert.equal(second.headers.get("location"), "https://example.com/new");
  const analytics = await (await request("/api/analytics?days=7")).json();
  assert.equal(analytics.total, 2);
  assert.equal(analytics.uniqueDailyVisitors, 1);
  assert.equal(analytics.devices.Mobile, 2);
  assert.equal(analytics.daily.length, 7);
  const list = await (await request("/api/codes")).json();
  assert.equal(list[0].scans, 2);
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...code, active: false },
      })
    ).status,
    200,
  );
  assert.equal((await request(`/r/${code.slug}`)).status, 410);
  assert.equal(
    (await (await request(`/api/analytics?codeId=${code.id}`)).json()).total,
    2,
  );
  assert.equal(
    (await request(`/api/codes/${code.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await request(`/r/${code.slug}`)).status, 404);
  assert.equal((await (await request("/api/analytics")).json()).total, 0);
});
test("static Wi-Fi PNG actually decodes; static payloads cannot be changed", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const body = urlCode({
    type: "wifi",
    dynamic: false,
    data: { ssid: "Cafe;Guest", password: "safe:pass", security: "WPA" },
  });
  const res = await request("/api/codes", { method: "POST", body });
  assert.equal(res.status, 201);
  const code = await res.json();
  const png = await request(`/api/codes/${code.id}/download`);
  const image = PNG.sync.read(Buffer.from(await png.arrayBuffer()));
  assert.equal(
    jsQR(new Uint8ClampedArray(image.data), image.width, image.height).data,
    "WIFI:T:WPA;S:Cafe\\;Guest;P:safe\\:pass;H:false;;",
  );
  const svg = await request(`/api/codes/${code.id}/download?format=svg`);
  assert.match(svg.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await svg.text(), /<svg/);
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...body, data: { ...body.data, ssid: "New network" } },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...body, name: "New name" },
      })
    ).status,
    200,
  );
  assert.equal((await request(`/r/${code.slug}`)).status, 404);
});
test("validation rejects unsafe targets, missing data, invalid folders and changed types", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://name:password@example.com",
    "bad-url",
  ])
    assert.equal(
      (
        await request("/api/codes", {
          method: "POST",
          body: urlCode({ data: { url } }),
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({ folderId: "missing" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({ type: "text", dynamic: true, data: { text: "Hello" } }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/codes", {
        method: "POST",
        body: urlCode({
          type: "email",
          dynamic: false,
          data: { email: "invalid" },
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/codes", { method: "POST", body: {} })).status,
    400,
  );
  const code = await (
    await request("/api/codes", { method: "POST", body: urlCode() })
  ).json();
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: urlCode({ dynamic: false }),
      })
    ).status,
    400,
  );
  assert.equal((await request("/api/codes/not-found/download")).status, 404);
});
test("folder lifecycle preserves codes; duplicate folders fail", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const folder = await (
    await request("/api/folders", {
      method: "POST",
      body: { name: "Campaigns" },
    })
  ).json();
  assert.equal(
    (
      await request("/api/folders", {
        method: "POST",
        body: { name: "Campaigns" },
      })
    ).status,
    409,
  );
  const code = await (
    await request("/api/codes", {
      method: "POST",
      body: urlCode({ folderId: folder.id }),
    })
  ).json();
  assert.equal(code.folderId, folder.id);
  assert.equal(
    (await request(`/api/folders/${folder.id}`, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await (await request("/api/codes")).json())[0].folderId, null);
});
test("saved QR codes persist when the server restarts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "openqr-test-"));
  const dbPath = join(dir, "data.sqlite");
  try {
    const first = createApp({ dbPath });
    first.db
      .prepare("INSERT INTO users VALUES (?,?,?,?,?)")
      .run("owner", "owner@example.com", "Owner", "salt", "hash");
    first.db
      .prepare(
        "INSERT INTO codes (id,user_id,slug,name,type,dynamic,data,folder_id,color,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "code",
        "owner",
        "saved-link",
        "Persisted",
        "url",
        1,
        JSON.stringify({ url: "https://example.com" }),
        null,
        "#163f32",
        1,
        new Date().toISOString(),
      );
    first.db.close();
    const second = createApp({ dbPath });
    assert.equal(
      second.db.prepare("SELECT name FROM codes").get().name,
      "Persisted",
    );
    second.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("payload formats retain line escaping and phone/email encodings", () => {
  assert.equal(
    payload({ type: "phone", data: { phone: "+1 (555) 123-4567" } }),
    "tel:+15551234567",
  );
  assert.match(
    payload({
      type: "email",
      data: { email: "hello@example.com", subject: "Hello & welcome" },
    }),
    /subject=Hello%20%26%20welcome/,
  );
  assert.match(
    payload({ type: "vcard", data: { fullName: "Alex\nMorgan" } }),
    /FN:Alex\\nMorgan\r\n/,
  );
});

test("saved code previews and downloaded content encode the same data", () => {
  const cases = [
    { type: "url", data: { url: "https://example.com" } },
    { type: "text", data: { text: "A little hello" } },
    {
      type: "wifi",
      data: {
        ssid: "Cafe;Guest",
        security: "WPA",
        password: "secret:password",
      },
    },
    {
      type: "email",
      data: { email: "hello@example.com", subject: "Welcome & hello" },
    },
    { type: "phone", data: { phone: "+1 (555) 123-4567" } },
    {
      type: "vcard",
      data: {
        fullName: "Alex\nMorgan",
        phone: "+15551234567",
        email: "alex@example.com",
      },
    },
  ];
  for (const code of cases)
    assert.equal(
      codeContent({ ...code, dynamic: false, shortUrl: "" }),
      payload(code),
    );
});

test("too-light QR colors are rejected before a code is saved", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const response = await request("/api/codes", {
    method: "POST",
    body: urlCode({ color: "#ffffff" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /darker QR color/);
});
