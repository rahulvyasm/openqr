import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";

const form = {
  id: "form1",
  type: "form",
  title: "Enquiry",
  intro: "",
  submitLabel: "Send",
  successMessage: "Thanks, we got it.",
  fields: [
    { id: "q1", label: "Email", type: "email", required: true, options: [] },
    { id: "q2", label: "Message", type: "textarea", required: false, options: [] },
  ],
};
const blocks = [
  { id: "head1", type: "heading", text: "Hello", subtext: "Welcome" },
  { id: "btn01", type: "button", label: "Visit us", url: "https://example.com/a" },
  form,
];
const create = (request, extra = {}) =>
  request("/api/codes", {
    method: "POST",
    body: {
      name: "Café",
      type: "experience",
      dynamic: true,
      data: { title: "Café", blocks: JSON.stringify(blocks) },
      ...extra,
    },
  });
const ticketOf = (html) => html.match(/name="ticket" value="([^"]+)"/)[1];
const post = (base, path, fields) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

test("experiences render, track actions, collect responses and version", async (t) => {
  const { request, setup, base } = await fixture(t);
  await setup();
  const res = await create(request);
  if (res.status !== 201) console.log(await res.clone().text());
  assert.equal(res.status, 201);
  const code = await res.json();

  // Validation: unsafe actions and duplicate ids are refused.
  const bad = (list) =>
    create(request, {
      data: { title: "x", blocks: JSON.stringify(list) },
    });
  assert.equal(
    (await bad([{ id: "btn01", type: "button", label: "x", url: "javascript:alert(1)" }])).status,
    400,
  );
  assert.equal((await bad([blocks[0], blocks[0]])).status, 400);
  assert.equal(
    (await create(request, { dynamic: false })).status,
    400,
  );

  const page = await (
    await fetch(`${base}/r/${code.slug}`, { headers: { "user-agent": "Mobile" } })
  ).text();
  assert.match(page, /Hello/);
  assert.match(page, /Visit us/);
  assert.doesNotMatch(page, /example\.com\/a/); // taps go through the tracker
  const ticket = ticketOf(page);

  // Tracked tap redirects and is counted.
  const go = await fetch(`${base}/r/${code.slug}/go/btn01?ticket=${ticket}`, {
    redirect: "manual",
  });
  assert.equal(go.status, 302);
  assert.equal(go.headers.get("location"), "https://example.com/a");
  assert.equal(
    (await fetch(`${base}/r/${code.slug}/go/btn01?ticket=bad`, { redirect: "manual" })).status,
    403,
  );

  // Form: validation, honeypot, success.
  const invalid = await post(base, `/r/${code.slug}/submit/form1`, {
    ticket,
    f_q1: "nope",
  });
  assert.match(await invalid.text(), /valid email/);
  const spam = await post(base, `/r/${code.slug}/submit/form1`, {
    ticket,
    website: "http://spam",
    f_q1: "bot@example.com",
  });
  assert.match(await spam.text(), /Thanks, we got it/);
  const ok = await post(base, `/r/${code.slug}/submit/form1`, {
    ticket,
    f_q1: "ada@example.com",
    f_q2: "=cmd|' /C calc'!A0",
  });
  assert.match(await ok.text(), /Thanks, we got it/);
  assert.equal(
    (await post(base, `/r/${code.slug}/submit/form1`, { f_q1: "a@b.co" })).status,
    403,
  );

  const list = await (
    await request(`/api/codes/${code.id}/experience/submissions`)
  ).json();
  assert.equal(list.length, 1); // honeypot and invalid input stored nothing
  assert.equal(list[0].answers.Email, "ada@example.com");
  assert.equal((await (await request("/api/experience/unread")).json()).unread, 1);
  const csv = await (
    await request(`/api/codes/${code.id}/experience/submissions.csv`)
  ).text();
  assert.match(csv, /'=cmd/); // spreadsheet formulas are neutralised

  const stats = await (await request(`/api/codes/${code.id}/experience/stats`)).json();
  assert.equal(stats.submissions, 1);
  assert.equal(stats.taps, 1);
  assert.ok(stats.actions.some((a) => a.label === "Visit us" && a.kind === "tap"));

  // Draft -> publish -> versions -> restore.
  const edited = [
    { ...blocks[0], text: "Hello again" },
    ...blocks.slice(1),
  ];
  assert.equal(
    (await request(`/api/codes/${code.id}/experience/publish`, { method: "POST", body: {} })).status,
    400,
  );
  const saved = await request(`/api/codes/${code.id}/experience/draft`, {
    method: "PUT",
    body: { title: "Café", blocks: edited },
  });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(
    await (await fetch(`${base}/r/${code.slug}`)).text(),
    /Hello again/,
  ); // drafts are not public
  const preview = await request("/api/experience/preview", {
    method: "POST",
    body: { title: "Café", blocks: edited },
  });
  assert.match(await preview.text(), /Hello again/);
  const published = await request(`/api/codes/${code.id}/experience/publish`, {
    method: "POST",
    body: { note: "Updated greeting" },
  });
  assert.equal((await published.json()).version, 2);
  assert.match(
    await (await fetch(`${base}/r/${code.slug}`)).text(),
    /Hello again/,
  );
  const versions = await (
    await request(`/api/codes/${code.id}/experience/versions`)
  ).json();
  assert.deepEqual(versions.map((v) => v.version), [2, 1]);
  const restored = await (
    await request(`/api/codes/${code.id}/experience/versions/1/restore`, { method: "POST", body: {} })
  ).json();
  assert.equal(restored.blocks[0].text, "Hello");
  assert.equal(restored.dirty, true);

  // Responses can be removed by the owner.
  await request(`/api/codes/${code.id}/experience/submissions/${list[0].id}`, { method: "DELETE" });
  assert.equal(
    (await (await request(`/api/codes/${code.id}/experience/submissions`)).json()).length,
    0,
  );

  // Templates exist and validate.
  const templates = await (await request("/api/experience/templates")).json();
  assert.ok(templates.length >= 3);
  for (const tpl of templates)
    assert.equal(
      (
        await create(request, {
          name: tpl.name,
          data: { title: tpl.title, blocks: JSON.stringify(tpl.blocks) },
        })
      ).status,
      201,
      tpl.name,
    );
});
