import { problem } from "../shared/errors.js";

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const MAX_STORAGE = Number.MAX_SAFE_INTEGER;
export const emptyDocument = () => ({
  codes: [],
  assets: [],
  folders: [],
  templates: [],
  pageTemplates: [],
  drafts: {},
  versions: {},
  audit: [],
  service: {},
});
export const json = (value, status = 200) => Response.json(value, { status });
export function cookie(req, key) {
  const part = (req.headers.get("cookie") || "")
    .split(/;\s*/)
    .find((p) => p.startsWith(key + "="));
  try {
    return part ? decodeURIComponent(part.slice(key.length + 1)) : "";
  } catch {
    return "";
  }
}
export function putCookie(headers, key, value, maxAge = 2592000) {
  headers.append(
    "Set-Cookie",
    `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
  );
}
export async function boundedBody(req, limit = 2 * 1024 * 1024) {
  if (Number(req.headers.get("content-length")) > limit)
    throw problem("Request is too large.", 413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw problem("Request is too large.", 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function body(req) {
  try {
    return JSON.parse(new TextDecoder().decode(await boundedBody(req)) || "{}");
  } catch (e) {
    if (e.domain) throw e;
    throw problem("Invalid JSON.");
  }
}
export function makeBackend(env, fetcher = fetch) {
  const url = env.SUPABASE_URL;
  const secret =
    JSON.parse(env.SUPABASE_SECRET_KEYS || "{}")?.default ||
    env.SUPABASE_SERVICE_ROLE_KEY;
  const publishable =
    JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS || "{}")?.default ||
    env.SUPABASE_ANON_KEY;
  if (!url || !secret || !publishable)
    throw problem("Hosted backend is not configured.", 503);
  const adminHeaders = {
    apikey: secret,
    ...(secret.startsWith("ey") ? { Authorization: `Bearer ${secret}` } : {}),
  };
  const request = async (path, options = {}, admin = true) => {
    const response = await fetcher(url + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(admin ? adminHeaders : { apikey: publishable }),
        ...options.headers,
      },
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const message =
        data.msg ||
        data.message ||
        data.error_description ||
        data.error ||
        "Service request failed.";
      if (message.includes("revision_conflict"))
        throw problem("revision_conflict", 409);
      if (/plan_limit:/.test(message))
        throw problem(message.split("plan_limit:")[1].trim(), 402);
      if (/public_unavailable:/.test(message))
        throw problem(message.split("public_unavailable:")[1].trim(), 410);
      if (admin) {
        console.error(
          JSON.stringify({
            service: "database",
            status: response.status,
            code: data.code,
          }),
        );
        throw problem(
          response.status === 409
            ? "That short link is already in use."
            : "The service could not save this change.",
          response.status === 409 ? 409 : 503,
        );
      }
      throw problem(message, response.status >= 500 ? 503 : 400);
    }
    return data;
  };
  const db = (table, query = "", method = "GET", data) =>
    request(`/rest/v1/${table}${query ? "?" + query : ""}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  const rpc = (name, data) =>
    request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const auth = (path, data, token, method = data ? "POST" : "GET") =>
    request(
      `/auth/v1/${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      },
      false,
    );
  const storage = async (path, options = {}) => {
    const r = await fetcher(url + "/storage/v1/" + path, {
      ...options,
      headers: { ...adminHeaders, ...options.headers },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw problem("The file could not be saved or loaded.", 503);
    return r;
  };
  const rate = async (key, count, seconds) => {
    // Use a keyed digest, never store visitor addresses in the rate-limit table.
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(secret + key),
    );
    const hashed = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (
      !(await rpc("oq_rate", {
        p_key: hashed,
        p_limit: count,
        p_seconds: seconds,
      }))
    )
      throw problem("Too many requests. Please try again later.", 429);
  };
  const fingerprint = async (value) => {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(secret + value),
    );
    return Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  };
  const signingKey = awaitKey();
  function awaitKey() {
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  const ticket = async (id) => {
    const expires = String(Date.now() + 25 * 60000);
    const mac = await crypto.subtle.sign(
      "HMAC",
      await signingKey,
      new TextEncoder().encode(id + "|" + expires),
    );
    return (
      expires +
      "." +
      Array.from(new Uint8Array(mac), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("")
    );
  };
  const validTicket = async (token, id) => {
    if (typeof token !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(token))
      return false;
    const [expires, mac] = token.split(".");
    if (
      Number(expires) < Date.now() ||
      Number(expires) > Date.now() + 26 * 60000
    )
      return false;
    return crypto.subtle.verify(
      "HMAC",
      await signingKey,
      Uint8Array.from(mac.match(/../g), (x) => parseInt(x, 16)),
      new TextEncoder().encode(id + "|" + expires),
    );
  };
  const adminAuth = (path, data, method = data ? "POST" : "GET") =>
    request("/auth/v1/admin/" + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  return {
    db,
    rpc,
    auth,
    storage,
    rate,
    fingerprint,
    ticket,
    validTicket,
    adminAuth,
  };
}
export async function identity(backend, req, headers) {
  let access = cookie(req, "oq_access");
  const refresh = cookie(req, "oq_refresh");
  let user;
  try {
    if (access) user = await backend.auth("user", undefined, access);
  } catch {
    /* Try refresh. */
  }
  if (!user && refresh) {
    try {
      const session = await backend.auth("token?grant_type=refresh_token", {
        refresh_token: refresh,
      });
      access = session.access_token;
      user = session.user;
      putCookie(headers, "oq_access", access);
      putCookie(headers, "oq_refresh", session.refresh_token);
    } catch {
      return null;
    }
  }
  if (!user || !user.email_confirmed_at) return null;
  const claims = JSON.parse(
    atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  );
  if (
    !claims.session_id ||
    !(await backend.rpc("oq_live_session", {
      p_actor: user.id,
      p_session: claims.session_id,
    }))
  )
    return null;
  const totp = (user.factors || []).find(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  // A password alone is not enough once an authenticator app is enrolled.
  if (totp && claims.aal !== "aal2")
    return {
      mfaPending: true,
      factorId: totp.id,
      access,
      user: { id: user.id, email: user.email },
    };
  const records = () =>
    Promise.all([
      backend.db("oq_accounts", `id=eq.${user.id}`),
      backend.db("oq_staff", `user_id=eq.${user.id}`),
      backend.db(
        "oq_members",
        `user_id=eq.${user.id}&select=*,oq_workspaces(id,name,owner_id)`,
      ),
    ]);
  let [accounts, staffRows, memberships] = await records();
  // Only a first visit, or an account that owns no workspace, needs the setup step.
  if (
    !accounts[0] ||
    !memberships.some((m) => m.oq_workspaces?.owner_id === user.id)
  ) {
    await backend.rpc("oq_bootstrap", {
      p_actor: user.id,
      p_name: user.user_metadata?.name || user.email.split("@")[0],
    });
    [accounts, staffRows, memberships] = await records();
  }
  const account = accounts[0];
  if (!account || account.suspended)
    throw problem("This account is suspended. Contact support.", 403);
  const staff = staffRows[0];
  const workspaces = memberships.map((m) => ({
    id: m.workspace_id,
    name: m.oq_workspaces.name,
    ownerId: m.oq_workspaces.owner_id,
    role: m.role,
  }));
  const selected = cookie(req, "oq_workspace");
  return {
    user: { id: user.id, name: account.name, email: user.email },
    access,
    sessionId: claims.session_id,
    factorId: totp?.id || null,
    staff: staff?.role || null,
    workspaces,
    workspace:
      workspaces.find((w) => w.id === selected) || workspaces[0] || null,
  };
}
export async function reauthenticate(backend, actor, password) {
  if (typeof password !== "string" || !password.length || password.length > 128)
    throw problem("Enter your password.");
  const session = await backend.auth("token?grant_type=password", {
    email: actor.user.email,
    password,
  });
  if (session.user.id !== actor.user.id)
    throw problem("The password is incorrect.", 403);
  const staff = (
    await backend.db("oq_staff", `user_id=eq.${actor.user.id}`)
  )[0];
  await backend.auth("logout?scope=local", {}, session.access_token);
  if (staff?.role !== "super_admin")
    throw problem("Super Admin access required.", 403);
}
export function auditDoc(document, actor, event, details = {}) {
  document.audit.unshift({
    id: uid(),
    event,
    actor: actor.user.name,
    subject: "",
    details,
    createdAt: now(),
  });
  document.audit = document.audit.slice(0, 100);
}
export async function mutate(backend, actor, fn) {
  const workspace = actor.workspace;
  if (!workspace || !["owner", "admin", "editor"].includes(workspace.role))
    throw problem("Workspace edit permission required.", 403);
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = (
      await backend.db("oq_workspaces", `id=eq.${workspace.id}`)
    )[0];
    if (!state) throw problem("Workspace not found.", 404);
    const result = await fn(state.document);
    try {
      await backend.rpc("oq_commit", {
        p_actor: actor.user.id,
        p_workspace: workspace.id,
        p_revision: state.revision,
        p_document: state.document,
      });
      return result;
    } catch (e) {
      if (e.message !== "revision_conflict" || attempt === 2) throw e;
    }
  }
}
export async function getDocument(backend, actor) {
  if (!actor.workspace) throw problem("Choose a workspace first.", 403);
  const state = (
    await backend.db("oq_workspaces", `id=eq.${actor.workspace.id}`)
  )[0];
  if (!state) throw problem("Workspace not found.", 404);
  return state.document;
}
export const mask = (email) =>
  email ? email[0] + "***@" + (email.split("@")[1] || "") : "";
