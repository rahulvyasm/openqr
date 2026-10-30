import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { fixture, urlCode } from "./helpers.js";
import { socialPlatforms, socialLinkError } from "../shared/social.js";

test("social pages use shared platform icons and reject mismatches, unsafe URLs and duplicates", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const link = {
    title: "Instagram",
    platform: "instagram",
    url: "https://www.instagram.com/openqr/",
  };
  const social = (links) =>
    urlCode({
      type: "social",
      data: { title: "Our channels", links: JSON.stringify(links) },
    });
  for (const links of [
    [{ ...link, url: "https://instagram.com.attacker.example/profile" }],
    [{ ...link, url: "http://instagram.com/openqr" }],
    [{ ...link, url: "https://example.com/" }],
    [{ ...link, url: "javascript:alert(1)" }],
    [{ ...link, platform: "unsupported" }],
    [link, { ...link, url: "https://www.instagram.com/openqr" }],
    Array.from({ length: 13 }, (_, i) => ({
      ...link,
      url: `https://instagram.com/${i}`,
    })),
  ])
    assert.equal(
      (await request("/api/codes", { method: "POST", body: social(links) }))
        .status,
      400,
    );
  assert.equal(
    (await (await request("/api/audit")).json()).filter(
      (e) => e.event === "code.created",
    ).length,
    0,
  );
  const response = await request("/api/codes", {
    method: "POST",
    body: social([
      link,
      { title: "Telegram", platform: "telegram", url: "https://t.me/openqr" },
    ]),
  });
  assert.equal(response.status, 201);
  const code = await response.json();
  const page = await request("/r/" + code.slug, { authenticated: false });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /href="https:\/\/www.instagram.com\/openqr\/"/);
  assert.match(html, /class="platform"><svg/);
  assert.match(html, /href="https:\/\/t.me\/openqr"/);
  for (const platform of socialPlatforms.filter((p) => p.id !== "website"))
    assert.equal(
      socialLinkError({
        platform: platform.id,
        url: `https://www.${platform.hosts[0]}/profile`,
      }),
      "",
    );
});

test("a direct social profile QR encodes its external destination without localhost", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const destination = "https://www.instagram.com/openqr/";
  const response = await request("/api/codes", {
    method: "POST",
    body: urlCode({ dynamic: false, data: { url: destination } }),
  });
  assert.equal(response.status, 201);
  const code = await response.json();
  const image = await request(
    `/api/codes/${code.id}/download?format=png&size=1024`,
  );
  const png = PNG.sync.read(Buffer.from(await image.arrayBuffer()));
  assert.equal(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    destination,
  );
});

test("QR lifecycle, imports and batch actions appear in scoped activity without QR payloads", async (t) => {
  const { request, setup } = await fixture(t);
  await setup();
  const create = await request("/api/codes", {
    method: "POST",
    body: urlCode({
      name: "Activity code",
      data: { url: "https://example.com/private?token=hidden" },
    }),
  });
  const code = await create.json();
  const duplicate = await request(`/api/codes/${code.id}/duplicate`, {
    method: "POST",
    body: {},
  });
  assert.equal(duplicate.status, 201);
  assert.equal(
    (
      await request(`/api/codes/${code.id}`, {
        method: "PUT",
        body: { ...code, name: "Renamed code" },
      })
    ).status,
    200,
  );
  for (const action of ["pause", "resume", "move"])
    assert.equal(
      (
        await request("/api/codes/batch", {
          method: "POST",
          body: { ids: [code.id], action, folderId: null },
        })
      ).status,
      200,
    );
  assert.equal(
    (await request(`/api/codes/${code.id}`, { method: "DELETE" })).status,
    200,
  );
  const rows = await (await request("/api/audit")).json();
  for (const event of [
    "created",
    "duplicated",
    "updated",
    "paused",
    "resumed",
    "moved",
    "deleted",
  ])
    assert.ok(
      rows.some((row) => row.event === "code." + event),
      event,
    );
  assert.equal(
    rows.find((row) => row.event === "code.created").actor,
    "Test Owner",
  );
  assert.equal(
    rows.find((row) => row.event === "code.deleted").details.name,
    "Renamed code",
  );
  assert.doesNotMatch(JSON.stringify(rows), /token=hidden/);
  assert.equal(
    (
      await request("/api/codes/bulk", {
        method: "POST",
        body: {
          codes: [
            urlCode({ name: "Imported one" }),
            urlCode({ name: "Imported two" }),
          ],
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (await (await request("/api/audit")).json()).filter(
      (row) => row.event === "code.created",
    ).length,
    3,
  );
  await request("/api/workspaces", {
    method: "POST",
    body: { name: "Isolated" },
  });
  assert.ok(
    !(await (await request("/api/audit")).json()).some((row) =>
      row.event.startsWith("code."),
    ),
  );
});

test("failed audit writes roll back QR creation and failed imports leave no activity", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  db.exec(
    "CREATE TEMP TRIGGER fail_qr_audit BEFORE INSERT ON audit_events WHEN NEW.event='code.created' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  assert.equal(
    (await request("/api/codes", { method: "POST", body: urlCode() })).status,
    500,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM codes").get().n, 0);
  db.exec("DROP TRIGGER fail_qr_audit");
  assert.equal(
    (
      await request("/api/codes/bulk", {
        method: "POST",
        body: {
          codes: [
            urlCode({ slug: "same-slug" }),
            urlCode({ slug: "same-slug" }),
          ],
        },
      })
    ).status,
    409,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM codes").get().n, 0);
  assert.ok(
    !(await (await request("/api/audit")).json()).some(
      (row) => row.event === "code.created",
    ),
  );
});
