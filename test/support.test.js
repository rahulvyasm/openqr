import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import { setOperator } from "../server/operator.js";

test("support staff work cases and customer privacy is enforced and audited", async (t) => {
  const { setup, db, base } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT * FROM users").get();
  const workspace = db.prepare("SELECT id FROM workspaces").get().id;
  const headers = { origin: "http://localhost:5173" };
  async function account(name, role) {
    const id = randomUUID(),
      email = `${name}@example.com`;
    db.prepare(
      "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
    ).run(id, email, name, owner.salt, owner.password);
    db.prepare(
      "INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)",
    ).run(workspace, id, "viewer", new Date().toISOString());
    if (role) setOperator(db, id, true, role);
    const login = () =>
      fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ email, password: "a-secure-test-password" }),
      });
    const response = await login();
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    return {
      id,
      email,
      login,
      status: response.status,
      call: (path, body, method) =>
        fetch(base + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...headers,
            cookie,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
    };
  }
  const support = await account("support", "support"),
    billing = await account("billing", "billing"),
    analyst = await account("analyst", "analyst"),
    admin = await account("admin", "super_admin"),
    customer = await account("customer");

  // Privacy: masked contact data, no content, and customers cannot reach staff routes.
  const detail = await (
    await support.call(`/api/operator/customers/${workspace}`)
  ).json();
  const row = detail.members.find((m) => m.id === customer.id);
  assert.equal(row.email, "c***@example.com");
  assert.doesNotMatch(
    JSON.stringify(detail),
    /customer@example\.com|salt|password/,
  );
  assert.equal(
    (await customer.call(`/api/operator/customers/${workspace}`)).status,
    403,
  );
  assert.equal(
    (await analyst.call(`/api/operator/customers/${workspace}`)).status,
    403,
  );
  const users = await (await support.call("/api/operator/users")).json();
  assert.ok(users.rows.every((u) => /\*\*\*@/.test(u.email)));

  // Revealing requires a reason, is limited to users:read, and is logged.
  const reveal = `/api/operator/users/${customer.id}/reveal-email`;
  assert.equal((await support.call(reveal, { reason: "short" })).status, 400);
  assert.equal(
    (await billing.call(reveal, { reason: "Looking at billing" })).status,
    403,
  );
  const revealed = await support.call(reveal, {
    reason: "Customer asked for help with SUP-1",
  });
  assert.equal((await revealed.json()).email, "customer@example.com");

  // Case lifecycle shared between support and billing.
  assert.equal((await analyst.call("/api/operator/cases")).status, 403);
  const created = await support.call("/api/operator/cases", {
    workspaceId: workspace,
    userId: customer.id,
    category: "billing",
    priority: "high",
    subject: "Charged twice",
    note: "Customer reports a duplicate charge.",
  });
  assert.equal(created.status, 201);
  const { number } = await created.json();
  assert.equal(
    (
      await support.call("/api/operator/cases", {
        workspaceId: workspace,
        userId: admin.id === customer.id ? "" : randomUUID(),
        category: "other",
        subject: "Bad contact",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await billing.call(`/api/operator/cases/${number}/notes`, {
        body: "Refund handled offline.",
      })
    ).status,
    201,
  );
  const resolved = await billing.call(
    `/api/operator/cases/${number}`,
    { status: "resolved", assign: "me" },
    "PATCH",
  );
  assert.equal((await resolved.json()).status, "resolved");
  const opened = await (
    await support.call(`/api/operator/cases/${number}`)
  ).json();
  assert.equal(opened.notes.length, 2);
  const active = await (await support.call("/api/operator/cases")).json();
  assert.equal(active.total, 0);
  const found = await (
    await support.call("/api/operator/cases?status=resolved&q=SUP-" + number)
  ).json();
  assert.equal(found.total, 1);

  // Suspension: password + reason, never self or staff, blocks sessions and sign-in, restores.
  const suspend = (target, body) =>
    support.call(`/api/operator/users/${target}/suspension`, body);
  const valid = { suspended: true, reason: "Abuse report SUP-2" };
  assert.equal(
    (await suspend(customer.id, { ...valid, password: "wrong" })).status,
    403,
  );
  assert.equal(
    (
      await suspend(support.id, {
        ...valid,
        password: "a-secure-test-password",
      })
    ).status,
    400,
  );
  assert.equal(
    (await suspend(admin.id, { ...valid, password: "a-secure-test-password" }))
      .status,
    409,
  );
  assert.equal(
    (
      await billing.call(`/api/operator/users/${customer.id}/suspension`, {
        ...valid,
        password: "a-secure-test-password",
      })
    ).status,
    403,
  );
  assert.equal(
    (await customer.call("/api/auth/status").then((r) => r.json())).user.id,
    customer.id,
  );
  assert.equal(
    (
      await suspend(customer.id, {
        ...valid,
        password: "a-secure-test-password",
      })
    ).status,
    200,
  );
  assert.equal(
    (await customer.call("/api/auth/status").then((r) => r.json())).user,
    null,
  );
  const blocked = await customer.login();
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).error, /suspended/);
  assert.equal(
    (
      await suspend(customer.id, {
        suspended: false,
        reason: "Resolved with owner",
        password: "a-secure-test-password",
      })
    ).status,
    200,
  );
  assert.equal((await customer.login()).status, 200);

  // Only Super Admin reads the audit trail, and it holds every sensitive step.
  assert.equal((await support.call("/api/operator/audit")).status, 403);
  const audit = await (await admin.call("/api/operator/audit")).json();
  const actions = audit.rows.map((r) => r.action);
  for (const action of [
    "customer.viewed",
    "contact.revealed",
    "case.opened",
    "case.resolved",
    "account.suspended",
    "account.restored",
  ])
    assert.ok(actions.includes(action), action);
  assert.equal(
    audit.rows.find((r) => r.action === "contact.revealed").reason,
    "Customer asked for help with SUP-1",
  );
});

test("customers file requests, see only their own and public replies, and cannot reach others", async (t) => {
  const { setup, db, base } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT * FROM users").get();
  const workspace = db.prepare("SELECT id FROM workspaces").get().id;
  const headers = { origin: "http://localhost:5173" };
  async function member(name, role) {
    const id = randomUUID(),
      email = `${name}@example.com`;
    db.prepare(
      "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
    ).run(id, email, name, owner.salt, owner.password);
    db.prepare(
      "INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)",
    ).run(workspace, id, "viewer", new Date().toISOString());
    if (role) setOperator(db, id, true, role);
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "a-secure-test-password" }),
    });
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      call: (path, body, method) =>
        fetch(base + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...headers,
            cookie,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
    };
  }
  const alice = await member("alice"),
    bob = await member("bob"),
    support = await member("support", "support");
  const made = await alice.call("/api/support/requests", {
    category: "billing",
    subject: "Wrong invoice",
    message: "My plan shows Free after paying.",
  });
  assert.equal(made.status, 201);
  const { number } = await made.json();
  assert.equal((await bob.call(`/api/support/requests/${number}`)).status, 404);
  assert.equal(
    (
      await bob.call(`/api/support/requests/${number}/replies`, {
        message: "hi",
      })
    ).status,
    404,
  );
  assert.deepEqual(await (await bob.call("/api/support/requests")).json(), []);
  // Staff internal notes stay hidden; public replies show.
  const note = (body, visibility) =>
    support.call(`/api/operator/cases/${number}/notes`, { body, visibility });
  assert.equal(
    (await note("Internal: check provider", "internal")).status,
    201,
  );
  assert.equal((await note("We are fixing your plan.", "public")).status, 201);
  const seen = await (
    await alice.call(`/api/support/requests/${number}`)
  ).json();
  assert.deepEqual(seen.replies.map((r) => r.body).sort(), [
    "My plan shows Free after paying.",
    "We are fixing your plan.",
  ]);
  assert.doesNotMatch(JSON.stringify(seen), /Internal|assigned|workspaceId/);
  // A customer reply reopens a resolved case; closed cases refuse replies.
  await support.call(
    `/api/operator/cases/${number}`,
    { status: "resolved" },
    "PATCH",
  );
  assert.equal(
    (
      await alice.call(`/api/support/requests/${number}/replies`, {
        message: "Still wrong.",
      })
    ).status,
    201,
  );
  assert.equal(
    (await (await alice.call(`/api/support/requests/${number}`)).json()).status,
    "open",
  );
  await support.call(
    `/api/operator/cases/${number}`,
    { status: "closed" },
    "PATCH",
  );
  assert.equal(
    (
      await alice.call(`/api/support/requests/${number}/replies`, {
        message: "Hello?",
      })
    ).status,
    409,
  );
  assert.equal((await alice.call("/api/operator/cases")).status, 403);
});

test("support alerts count customer replies for staff and staff replies for customers", async (t) => {
  const { setup, db, base } = await fixture(t);
  await setup();
  const owner = db.prepare("SELECT * FROM users").get();
  const workspace = db.prepare("SELECT id FROM workspaces").get().id;
  const headers = { origin: "http://localhost:5173" };
  async function member(name, role) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
    ).run(id, `${name}@example.com`, name, owner.salt, owner.password);
    db.prepare(
      "INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)",
    ).run(workspace, id, "viewer", new Date().toISOString());
    if (role) setOperator(db, id, true, role);
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        email: `${name}@example.com`,
        password: "a-secure-test-password",
      }),
    });
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      call: (path, body, method) =>
        fetch(base + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...headers,
            cookie,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
    };
  }
  const alice = await member("alice"),
    support = await member("support", "support"),
    analyst = await member("analyst", "analyst");
  const count = async (who, path) =>
    (await (await who.call(path)).json()).count;
  const made = await alice.call("/api/support/requests", {
    category: "other",
    subject: "Help me",
    message: "Need help.",
  });
  const { number } = await made.json();
  assert.equal(await count(support, "/api/operator/cases/attention"), 1);
  assert.equal(await count(analyst, "/api/operator/cases/attention"), 0);
  assert.equal(await count(alice, "/api/support/unread"), 0);
  // An internal note changes nothing; a public reply clears staff attention and notifies the customer.
  await support.call(`/api/operator/cases/${number}/notes`, {
    body: "Internal.",
    visibility: "internal",
  });
  assert.equal(await count(alice, "/api/support/unread"), 0);
  assert.equal(await count(support, "/api/operator/cases/attention"), 1);
  await support.call(`/api/operator/cases/${number}/notes`, {
    body: "On it.",
    visibility: "public",
  });
  assert.equal(await count(support, "/api/operator/cases/attention"), 0);
  assert.equal(await count(alice, "/api/support/unread"), 1);
  assert.equal(
    (await (await alice.call("/api/support/requests")).json())[0].unread,
    true,
  );
  await alice.call(`/api/support/requests/${number}`);
  assert.equal(await count(alice, "/api/support/unread"), 0);
  await alice.call(`/api/support/requests/${number}/replies`, {
    message: "Thanks, one more thing.",
  });
  assert.equal(await count(support, "/api/operator/cases/attention"), 1);
  assert.equal(
    (await (await support.call("/api/operator/cases")).json()).rows[0]
      .needsReply,
    1,
  );
});

test("outbound support alerts omit request text, skip internal notes, and never block requests", async (t) => {
  const sent = [];
  const notifier = {
    customerReply: async (email, number) =>
      sent.push(["customer", email, number]),
    staffAlert: async (kind, number, workspace) =>
      sent.push(["staff", kind, number, workspace]),
  };
  const { setup, db, base } = await fixture(t, ":memory:", { notifier });
  await setup();
  const owner = db.prepare("SELECT * FROM users").get();
  const workspace = db.prepare("SELECT id FROM workspaces").get().id;
  const headers = { origin: "http://localhost:5173" };
  async function member(name, role) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
    ).run(id, `${name}@example.com`, name, owner.salt, owner.password);
    db.prepare(
      "INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES (?,?,?,?)",
    ).run(workspace, id, "viewer", new Date().toISOString());
    if (role) setOperator(db, id, true, role);
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        email: `${name}@example.com`,
        password: "a-secure-test-password",
      }),
    });
    const cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      call: (path, body, method) =>
        fetch(base + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...headers,
            cookie,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
    };
  }
  const alice = await member("alice"),
    support = await member("support", "support");
  const { number } = await (
    await alice.call("/api/support/requests", {
      category: "other",
      subject: "Help",
      message: "Secret details",
    })
  ).json();
  assert.deepEqual(sent.splice(0), [
    [
      "staff",
      "new",
      number,
      db.prepare("SELECT name FROM workspaces").get().name,
    ],
  ]);
  await support.call(`/api/operator/cases/${number}/notes`, {
    body: "Internal",
    visibility: "internal",
  });
  assert.deepEqual(sent, []);
  await support.call(`/api/operator/cases/${number}/notes`, {
    body: "Public",
    visibility: "public",
  });
  assert.deepEqual(sent.splice(0), [["customer", "alice@example.com", number]]);
  await alice.call(`/api/support/requests/${number}/replies`, {
    message: "More",
  });
  assert.equal(sent.splice(0)[0][1], "reply");
});

test("the notifier sends bare-bones messages and survives delivery failures", async () => {
  const { createNotifier } = await import("../server/notify.js");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body).text]);
    throw new Error("network down");
  };
  try {
    const notifier = createNotifier(
      { webhookUrl: "https://hooks.example/x", retryDelayMs: 1 },
      "https://qr.example",
    );
    assert.equal(notifier.enabled, true);
    await notifier.staffAlert("new", 7, "Acme");
    assert.equal(calls.length, 3); // network failures are retried, then given up
    assert.match(
      calls[0][1],
      /SUP-7 \(Acme\).*https:\/\/qr\.example\/control-room/,
    );
    await notifier.customerReply("a@example.com", 7);
    assert.equal(createNotifier({}, "").enabled, false);
  } finally {
    globalThis.fetch = original;
  }
  const { loadConfig } = await import("../server/config.js");
  const base = { PUBLIC_URL: "http://localhost:5173" };
  assert.throws(
    () => loadConfig({ ...base, SMTP_URL: "http://x" }),
    /SMTP_URL/,
  );
  assert.throws(
    () => loadConfig({ ...base, SUPPORT_ALERT_EMAIL: "a@example.com" }),
    /requires SMTP_URL/,
  );
});

test("webhooks are signed, retried on server errors and not retried on client errors", async () => {
  const { createNotifier } = await import("../server/notify.js");
  const { createHmac } = await import("node:crypto");
  const original = globalThis.fetch;
  const seen = [];
  let statuses = [503, 200];
  globalThis.fetch = async (_url, init) => {
    seen.push(init);
    const status = statuses.shift() ?? 200;
    return { ok: status < 400, status };
  };
  try {
    const secret = "a-long-shared-secret";
    const notifier = createNotifier(
      { webhookUrl: "https://hooks.example/x", webhookSecret: secret, retryDelayMs: 1 },
      "https://qr.example",
    );
    await notifier.staffAlert("new", 9, "Acme");
    assert.equal(seen.length, 2); // 503 then success
    const { headers, body } = seen[1];
    const expected = createHmac("sha256", secret)
      .update(`${headers["x-openqr-timestamp"]}.${body}`)
      .digest("hex");
    assert.equal(headers["x-openqr-signature"], `sha256=${expected}`);
    seen.length = 0;
    statuses = [400, 200];
    await notifier.staffAlert("new", 10, "Acme");
    assert.equal(seen.length, 1); // rejected requests are not retried
  } finally {
    globalThis.fetch = original;
  }
  const { loadConfig } = await import("../server/config.js");
  const base = { PUBLIC_URL: "http://localhost:5173" };
  assert.throws(() => loadConfig({ ...base, SUPPORT_WEBHOOK_SECRET: "x".repeat(20) }), /SUPPORT_WEBHOOK_URL/);
  assert.throws(
    () => loadConfig({ ...base, SUPPORT_WEBHOOK_URL: "https://h.example", SUPPORT_WEBHOOK_SECRET: "short" }),
    /16 characters/,
  );
  assert.equal(loadConfig({ ...base }).logRequests, false);
  assert.equal(loadConfig({ ...base, LOG_REQUESTS: "true" }).logRequests, true);
});
