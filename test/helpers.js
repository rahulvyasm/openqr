import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/app.js";

export async function fixture(t, dbPath = ":memory:",options={}) {
  const { app, db, storage } = createApp({
    dbPath,
    publicUrl: "http://localhost:5173",
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    await storage.dispose();
  });
  let cookie = "";
  async function request(
    path,
    {
      method = "GET",
      body,
      raw,
      origin = "http://localhost:5173",
      authenticated = true,
      headers = {},
    } = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(authenticated && cookie ? { cookie } : {}),
        ...(origin ? { origin } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });
    if (res.headers.has("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    return res;
  }
  async function setup() {
    const res = await request("/api/auth/setup", {
      method: "POST",
      body: {
        name: "Test Owner",
        email: "owner@example.com",
        password: "a-secure-test-password",
      },
    });
    assert.equal(res.status, 201);
    return res;
  }
  return { request, setup, db, base, storage };
}
export const urlCode = (extra = {}) => ({
  name: "My website",
  type: "url",
  dynamic: true,
  data: { url: "https://example.com/original" },
  color: "#163f32",
  folderId: null,
  active: true,
  ...extra,
});
