import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { newSlug } from "../server/security.js";

const rule = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,59}$/;

test("generated short links always satisfy the slug rule", () => {
  // Plain base64url starts with "-" or "_" about one time in 32.
  for (let n = 0; n < 20000; n++) assert.match(newSlug(), rule);
});

test("a code whose stored short link breaks today's rule can still be edited", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const made = await request("/api/codes", {
    method: "POST",
    body: {
      name: "Menu",
      type: "url",
      dynamic: true,
      data: { url: "https://example.com/menu" },
    },
  });
  const code = await made.json();
  // Codes created before the fix could have received slugs such as "-AbC123xyz".
  db.prepare("UPDATE codes SET slug=? WHERE id=?").run("-Legacy_slug1", code.id);
  const current = (await (await request("/api/codes")).json())[0];
  assert.equal(current.slug, "-Legacy_slug1");
  const saved = await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...current, name: "Menu v2", data: { url: "https://example.com/menu2" } },
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).name, "Menu v2");
  // The permanent link still cannot be swapped for a different one.
  const swap = await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...current, slug: "another-link" },
  });
  assert.equal(swap.status, 400);
});
