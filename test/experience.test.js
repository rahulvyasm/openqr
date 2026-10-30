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

test("form alerts email the owner without answers and are throttled", async (t) => {
  const sent = [];
  const notifier = {
    enabled: true,
    canEmail: true,
    customerReply: async () => {},
    staffAlert: async () => {},
    formAlert: async (...args) => sent.push(args),
  };
  const { request, setup, base } = await fixture(t, ":memory:", { notifier });
  await setup();
  const code = await (await create(request)).json();
  assert.equal(
    (await request(`/api/codes/${code.id}/experience/alerts`, { method: "PUT", body: { emails: ["nope"] } })).status,
    400,
  );
  const saved = await request(`/api/codes/${code.id}/experience/alerts`, {
    method: "PUT",
    body: { emails: ["owner@example.com"] },
  });
  assert.deepEqual((await saved.json()).emails, ["owner@example.com"]);
  // Editing the code elsewhere keeps the alert setting.
  const full = await (await request("/api/codes")).json();
  const current = full.find((c) => c.id === code.id);
  await request(`/api/codes/${code.id}`, {
    method: "PUT",
    body: { ...current, name: "Renamed", data: { title: "x", blocks: "[]" } },
  });
  const page = await (await fetch(`${base}/r/${code.slug}`)).text();
  const ticket = ticketOf(page);
  for (const n of [1, 2])
    await post(base, `/r/${code.slug}/submit/form1`, { ticket, f_q1: `a${n}@example.com` });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][0], ["owner@example.com"]);
  assert.doesNotMatch(JSON.stringify(sent[0]), /a1@example\.com/);
});

test("blocks follow time rules in the page's time zone", async (t) => {
  const { request, setup, base } = await fixture(t);
  await setup();
  const rule = (id, text, when) => ({ id, type: "text", text, when });
  const list = [
    rule("morn1", "Breakfast menu", { days: [], from: "06:00", to: "11:00" }),
    rule("late1", "Late night", { days: [], from: "22:00", to: "02:00" }),
    rule("wkend", "Weekend brunch", { days: [0, 6] }),
    { id: "alway", type: "text", text: "Always here" },
  ];
  const code = await (
    await create(request, { data: { title: "Café", blocks: JSON.stringify(list) } })
  ).json();
  assert.equal(
    (await bad([{ id: "bad01", type: "text", text: "x", when: { days: [] } }])).status,
    400,
  );
  assert.equal(
    (await request(`/api/codes/${code.id}/experience/settings`, { method: "PUT", body: { timeZone: "Nowhere/Land" } })).status,
    400,
  );
  await request(`/api/codes/${code.id}/experience/settings`, {
    method: "PUT",
    body: { timeZone: "Asia/Kolkata" },
  });
  const preview = async (at) =>
    (
      await request("/api/experience/preview", {
        method: "POST",
        body: { title: "Café", blocks: list, at, timeZone: "Asia/Kolkata" },
      })
    ).text();
  // 2026-03-07 is a Saturday. 08:00 IST = 02:30 UTC.
  let html = await preview("2026-03-07T02:30:00Z");
  assert.match(html, /Breakfast menu/);
  assert.match(html, /Weekend brunch/);
  assert.doesNotMatch(html, /Late night/);
  // Monday 23:30 IST: only the overnight rule and the always block.
  html = await preview("2026-03-09T18:00:00Z");
  assert.match(html, /Late night/);
  assert.match(html, /Always here/);
  assert.doesNotMatch(html, /Breakfast menu|Weekend brunch/);
  // 01:00 IST Tuesday is inside the overnight range too.
  assert.match(await preview("2026-03-09T19:30:00Z"), /Late night/);
  function bad(blocks) {
    return create(request, { data: { title: "x", blocks: JSON.stringify(blocks) } });
  }
});

test("files used by drafts and older versions cannot be deleted", async (t) => {
  const { request, setup, db } = await fixture(t);
  await setup();
  const code = await (await create(request)).json();
  const workspace = db.prepare("SELECT id FROM workspaces").get().id,
    user = db.prepare("SELECT id FROM users").get().id,
    asset = "6f1d3c9a-2b1e-4d7a-9c3e-0a1b2c3d4e5f";
  db.prepare(
    "INSERT INTO assets (id,workspace_id,user_id,name,kind,mime,size,storage_key,sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(asset, workspace, user, "pic.png", "image", "image/png", 10, "k.png", "x", new Date().toISOString());
  await request(`/api/codes/${code.id}/experience/draft`, {
    method: "PUT",
    body: { title: "Café", blocks: [{ id: "img01", type: "image", assetId: asset }] },
  });
  const res = await request(`/api/assets/${asset}`, { method: "DELETE" });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /draft or earlier version/);
  await request(`/api/codes/${code.id}/experience/draft`, { method: "DELETE" });
  db.prepare(
    "INSERT INTO experience_versions (code_id,version,title,blocks,created_at) VALUES (?,?,?,?,?)",
  ).run(code.id, 1, "Old", JSON.stringify([{ id: "img01", type: "image", assetId: asset }]), new Date().toISOString());
  assert.equal((await request(`/api/assets/${asset}`, { method: "DELETE" })).status, 409);
});

test("the public page renders every block type without scripts and escapes content", async () => {
  const { renderExperience, templates } = await import("../server/experience-blocks.js");
  const asset = "6f1d3c9a-2b1e-4d7a-9c3e-0a1b2c3d4e5f";
  const blocks = [
    { id: "aaaa1", type: "heading", text: "<b>Hi</b>", subtext: "Sub" },
    { id: "aaaa2", type: "text", text: "Body" },
    { id: "aaaa3", type: "image", assetId: asset, alt: "Alt", caption: "Cap" },
    { id: "aaaa4", type: "video", assetId: asset, caption: "" },
    { id: "aaaa5", type: "button", label: "Go", url: "https://example.com" },
    { id: "aaaa6", type: "links", items: [{ label: "One", url: "https://example.com" }] },
    { id: "aaaa7", type: "file", assetId: asset, label: "Manual" },
    ...templates()[0].blocks.filter((b) => b.type === "form").slice(0, 1),
  ];
  const html = renderExperience(
    { title: "T", blocks, slug: "s", pageOptions: { theme: "bold", accent: "#285b48" }, ticket: "t" },
    { mediaUrl: (id) => `/m/${id}` },
  );
  assert.doesNotMatch(html, /<script|javascript:|onclick=/i);
  assert.match(html, /&lt;b&gt;Hi&lt;\/b&gt;/);
  for (const marker of ["xp-card", "xp-image", "xp-video", "xp-btn", "xp-stack", "<form", 'name="website"', "xp-foot"])
    assert.ok(html.includes(marker), marker);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media|max-width:480px/);
});

test("item pages share a template but keep their own details, history and responses", async (t) => {
  const { request, setup, base } = await fixture(t);
  await setup();
  const tpl = [
    { id: "head1", type: "heading", text: "Your kettle", subtext: "" },
    { id: "item1", type: "item", title: "About this kettle" },
    { id: "btn01", type: "button", label: "Manual", url: "https://example.com/m" },
    form,
  ];
  const parent = await (
    await create(request, { name: "Kettle", data: { title: "Kettle", blocks: JSON.stringify(tpl) } })
  ).json();
  const path = `/api/codes/${parent.id}/experience`;

  // Validation
  assert.equal(
    (await request(`${path}/items`, { method: "POST", body: { items: [{ name: "x", warrantyUntil: "soon" }] } })).status,
    400,
  );
  const made = await request(`${path}/items`, {
    method: "POST",
    body: {
      items: [
        { name: "Kettle #1", serial: "SN-001", warrantyUntil: "2099-01-31" },
        { name: "Kettle #2", serial: "<i>SN-002</i>", warrantyUntil: "2001-01-31" },
      ],
    },
  });
  assert.equal(made.status, 201);
  const [one, two] = await made.json();
  assert.notEqual(one.slug, two.slug);
  assert.notEqual(one.slug, parent.slug);

  const service = await request(`${path}/items/${one.id}/service`, {
    method: "POST",
    body: { date: "2026-02-10", note: "Replaced the filter" },
  });
  assert.equal((await service.json()).service.length, 1);
  assert.equal(
    (await request(`${path}/items/${one.id}/service`, { method: "POST", body: { date: "x", note: "n" } })).status,
    400,
  );

  const pageOne = await (await fetch(`${base}/r/${one.slug}`)).text();
  assert.match(pageOne, /Your kettle/); // template content
  assert.match(pageOne, /Kettle #1/);
  assert.match(pageOne, /SN-001/);
  assert.match(pageOne, /Active until 31 Jan 2099/);
  assert.match(pageOne, /Replaced the filter/);
  const pageTwo = await (await fetch(`${base}/r/${two.slug}`)).text();
  assert.match(pageTwo, /Expired on 31 Jan 2001/);
  assert.match(pageTwo, /No service recorded yet/);
  assert.match(pageTwo, /&lt;i&gt;SN-002/); // item text is escaped
  assert.doesNotMatch(pageTwo, /Replaced the filter/); // history is per item

  // Editing the template changes every item page at once.
  await request(`${path}/draft`, {
    method: "PUT",
    body: { title: "Kettle", blocks: tpl.map((b) => (b.id === "head1" ? { ...b, text: "Your kettle, updated" } : b)) },
  });
  await request(`${path}/publish`, { method: "POST", body: {} });
  assert.match(await (await fetch(`${base}/r/${two.slug}`)).text(), /Your kettle, updated/);

  // Actions on an item page count for the item and roll up into the template.
  const ticket = ticketOf(pageOne);
  await fetch(`${base}/r/${one.slug}/go/btn01?ticket=${ticket}`, { redirect: "manual" });
  await post(base, `/r/${one.slug}/submit/form1`, { ticket, f_q1: "owner@example.com" });
  const responses = await (await request(`${path}/submissions`)).json();
  assert.equal(responses.length, 1);
  assert.equal(responses[0].item, "Kettle #1");
  assert.match(await (await request(`${path}/submissions.csv`)).text(), /Kettle #1/);
  const stats = await (await request(`${path}/stats`)).json();
  assert.equal(stats.submissions, 1);
  assert.equal(stats.taps, 1);
  assert.equal(stats.scans, 3); // two item scans plus the update check above

  // Items cannot be treated as templates, and cannot nest.
  assert.equal((await request(`/api/codes/${one.id}/experience/draft`)).status, 400);
  assert.equal((await request(`/api/codes/${one.id}/experience/items`, { method: "POST", body: { items: [{ name: "x" }] } })).status, 400);

  // Editing an item and removing one.
  const renamed = await request(`${path}/items/${two.id}`, {
    method: "PUT",
    body: { name: "Kettle #2b", serial: "SN-002", warrantyUntil: "" },
  });
  assert.equal((await renamed.json()).name, "Kettle #2b");
  await request(`${path}/items/${two.id}`, { method: "DELETE" });
  assert.equal((await fetch(`${base}/r/${two.slug}`)).status, 404);
  const items = await (await request(`${path}/items`)).json();
  assert.equal(items.length, 1);

  // Deleting the template removes its item pages with it.
  await request(`/api/codes/${parent.id}`, { method: "DELETE" });
  assert.equal((await fetch(`${base}/r/${one.slug}`)).status, 404);
  assert.equal((await (await request("/api/codes")).json()).filter((c) => c.name.startsWith("Kettle")).length, 0);
});
