import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  call,
  admin,
  regular,
  handle,
  gateway,
  seed,
  sent,
  jwt,
} from "./test-fixture.js";
import { SITE } from "./api.js";
before(seed);
test("public status, authentication, gateway and origin checks", async () => {
  const state = await (await call("/api/auth/status", { user: null })).json();
  assert.equal(state.publicSignup, true);
  assert.equal(state.user, null);
  assert.equal((await call("/api/codes", { user: null })).status, 401);
  assert.equal(
    (await call("/api/codes", { headers: { "x-openqr-gateway": "bad" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("/api/codes", {
        method: "POST",
        data: {},
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/codes", {
        user: {
          token:
            jwt({
              sub: admin.id,
              role: "authenticated",
              session_id: admin.session,
            }) + "forged",
        },
      })
    ).status,
    401,
  );
});

test("signup discards privilege claims and requires email verification", async () => {
  const response = await call("/api/auth/signup", {
    user: null,
    method: "POST",
    data: {
      name: "New person",
      email: "person@example.com",
      password: "new-password-123",
      role: "super_admin",
      tier: "unlimited",
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verificationRequired, true);
  assert.deepEqual(sent[0].data, { name: "New person" });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("verified users get private Free workspaces; the verified service owner gets staff and Unlimited", async () => {
  const member = await (await call("/api/auth/status")).json();
  assert.equal(member.user.id, regular.id);
  assert.equal(member.operator, false);
  assert.equal(member.workspace.role, "owner");
  const owner = await (await call("/api/auth/status", { user: admin })).json();
  assert.equal(owner.operatorRole, "super_admin");
  assert.equal((await (await call("/api/billing")).json()).current.id, "free");
  assert.equal(
    (await (await call("/api/billing", { user: admin })).json()).current.id,
    "unlimited",
  );
  assert.equal(
    (
      await call(`/api/operator/accounts/${regular.id}/access`, {
        method: "POST",
        data: {
          tier: "unlimited",
          password: "test-password-123",
          reason: "Trying self promotion",
        },
      })
    ).status,
    403,
  );
});

test("support accepts the app form and keeps internal staff notes private", async () => {
  const created = await call("/api/support/requests", {
    method: "POST",
    data: {
      subject: "Account help",
      category: "account",
      message: "Please check my account",
    },
  });
  assert.equal(created.status, 201);
  const { number } = await created.json();
  const base = "/api/operator/cases/" + number;
  assert.equal(
    (
      await call(base + "/notes", {
        user: admin,
        method: "POST",
        data: { body: "Private investigation", visibility: "internal" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(base + "/notes", {
        user: admin,
        method: "POST",
        data: { body: "Your account is ready", visibility: "public" },
      })
    ).status,
    200,
  );
  const detail = await (await call("/api/support/requests/" + number)).json();
  assert.equal(detail.replies.length, 2);
  assert.equal(JSON.stringify(detail).includes("Private investigation"), false);
  assert.equal(
    (
      await call("/api/support/requests/" + number + "/replies", {
        method: "POST",
        data: { message: "Thank you" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(base, {
        user: admin,
        method: "PATCH",
        data: { status: "resolved", priority: "high" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call("/api/support/requests/" + number)).json()).status,
    "resolved",
  );
});

test("dynamic code quotas are enforced in Postgres and existing links survive a downgrade", async () => {
  const code = {
    name: "A website",
    type: "url",
    dynamic: true,
    data: { url: "https://example.com" },
    color: "#163f32",
  };
  let first;
  for (let n = 0; n < 3; n++) {
    const r = await call("/api/codes", { method: "POST", data: code });
    assert.equal(r.status, 201, await r.clone().text());
    first ||= await r.json();
  }
  assert.equal(
    (await call("/api/codes", { method: "POST", data: code })).status,
    402,
  );
  const grant = (tier) =>
    call(`/api/operator/accounts/${regular.id}/access`, {
      user: admin,
      method: "POST",
      data: {
        tier,
        password: "test-password-123",
        reason: "Testing early access grant",
      },
    });
  assert.equal((await grant("plus")).status, 200);
  assert.equal(
    (await call("/api/codes", { method: "POST", data: code })).status,
    201,
  );
  assert.equal((await grant("inherit")).status, 200);
  assert.equal(
    (await call("/api/codes", { method: "POST", data: code })).status,
    402,
  );
  const response = await call("/r/" + first.slug, { user: null });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.com/");
  assert.equal((await (await call("/api/codes")).json()).length, 4);
});

test("Experience drafts, publication, item isolation and responses work against Postgres", async () => {
  const blocks = [
    { id: "head1", type: "heading", text: "A real experience", subtext: "" },
    {
      id: "form1",
      type: "form",
      title: "Report a problem",
      intro: "",
      submitLabel: "Send",
      successMessage: "We got it",
      fields: [
        {
          id: "q1",
          label: "Message",
          type: "textarea",
          required: true,
          options: [],
        },
      ],
    },
  ];
  const r = await call("/api/codes", {
    user: admin,
    method: "POST",
    data: {
      name: "Aero kettle",
      type: "experience",
      dynamic: true,
      data: { title: "Aero", blocks: JSON.stringify(blocks) },
    },
  });
  assert.equal(r.status, 201, await r.clone().text());
  const code = await r.json();
  const base = "/api/codes/" + code.id + "/experience";
  const draft = await call(base + "/draft", {
    user: admin,
    method: "PUT",
    data: {
      title: "Updated Aero",
      blocks: [
        ...blocks,
        { id: "text1", type: "text", text: "Published content" },
      ],
    },
  });
  assert.equal(draft.status, 200);
  assert.equal(
    (
      await call(base + "/publish", {
        user: admin,
        method: "POST",
        data: { note: "First revision" },
      })
    ).status,
    200,
  );
  const page = await (await call("/r/" + code.slug, { user: null })).text();
  assert.match(page, /Published content/);
  const ticket = page.match(/name="ticket" value="([^"]+)"/)[1];
  const submit = () =>
    handle(
      new Request(
        "https://function.test/openqr-api/r/" + code.slug + "/submit/form1",
        {
          method: "POST",
          headers: {
            "x-openqr-gateway": gateway,
            "x-openqr-site": SITE,
            "x-openqr-ip": "visitor",
            origin: SITE,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ ticket, f_q1: "The lid is stuck" }),
        },
      ),
    );
  assert.match(await (await submit()).text(), /We got it/);
  await submit();
  const rows = await (
    await call(base + "/submissions", { user: admin })
  ).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answers.Message, "The lid is stuck");
  assert.equal((await call(base + "/submissions")).status, 404);
  const items = await call(base + "/items", {
    user: admin,
    method: "POST",
    data: {
      items: [
        { name: "Aero 1", serial: "SN-001", warrantyUntil: "2099-01-01" },
      ],
    },
  });
  assert.equal(items.status, 201, await items.clone().text());
  const [item] = await items.json();
  assert.equal(
    (
      await call(base + "/items/" + item.id + "/service", {
        user: admin,
        method: "POST",
        data: { date: "2026-01-01", note: "Changed filter" },
      })
    ).status,
    201,
  );
  const labels = await call(base + "/items/labels", { user: admin });
  assert.match(await labels.text(), /SN-001/);
});

test("the staff directory and plan catalog are private and prices stay hidden", async () => {
  assert.equal((await call("/api/operator/plans")).status, 403);
  const list = await (
    await call("/api/operator/plans", { user: admin })
  ).json();
  assert.equal(list.canGrantAccountAccess, true);
  assert.equal(list.rows.length, 2);
  assert.ok(list.plans.every((p) => p.monthlyINR === null));
});
