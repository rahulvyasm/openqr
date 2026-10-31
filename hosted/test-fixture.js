import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createHostedHandler, SITE } from "./api.js";
const rest = process.env.HOSTED_TEST_REST || "http://127.0.0.1:54329";
const container = process.env.HOSTED_TEST_POSTGRES || "openqr-hosted-pg";
const database = process.env.HOSTED_TEST_DATABASE || "openqr_beta_validation";
const secret = "openqr-local-jwt-secret-at-least-32-characters";
function jwt(claims) {
  const value =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
  return (
    value + "." + createHmac("sha256", secret).update(value).digest("base64url")
  );
}
function sql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
}
const admin = {
  id: randomUUID(),
  email: "owner@example.com",
  name: "Rahul",
};
const regular = {
  id: randomUUID(),
  email: "regular-" + randomUUID() + "@example.com",
  name: "Regular",
};
const users = [admin, regular];
for (const u of users) {
  u.session = randomUUID();
  u.token = jwt({ sub: u.id, role: "authenticated", session_id: u.session });
}
const gateway = "a".repeat(64);
const env = {
  SUPABASE_URL: rest,
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role" }),
  SUPABASE_ANON_KEY: "public-test-key",
};
const sent = [];
async function fetcher(input, options) {
  const url = new URL(input);
  if (url.pathname.startsWith("/auth/v1/")) {
    const token = options.headers?.Authorization?.replace("Bearer ", "");
    const user = users.find((u) => u.token === token);
    const data = options.body ? JSON.parse(options.body) : {};
    const info = (u) => ({
      ...u,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      user_metadata: { name: u.name },
    });
    if (url.pathname.endsWith("/user"))
      return user
        ? Response.json(info(user))
        : Response.json({ msg: "Invalid token" }, { status: 401 });
    if (url.pathname.endsWith("/token")) {
      const who = users.find((u) => u.email === data.email);
      return who && data.password === "test-password-123"
        ? Response.json({
            access_token: who.token,
            refresh_token: "r",
            user: info(who),
          })
        : Response.json({ msg: "Wrong password" }, { status: 400 });
    }
    if (url.pathname.endsWith("/logout"))
      return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/signup")) {
      sent.push(data);
      return Response.json({ user: { id: randomUUID() }, access_token: null });
    }
    throw new Error("Unexpected auth test URL " + url.pathname);
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    url.pathname = url.pathname.slice("/rest/v1".length);
    return fetch(url, options);
  }
  return fetch(input, options);
}
const handle = createHostedHandler(env, fetcher);
const call = (
  path,
  { user = regular, method = "GET", data, origin = SITE, headers = {} } = {},
) =>
  handle(
    new Request("https://function.test/openqr-api" + path, {
      method,
      headers: {
        "x-openqr-gateway": gateway,
        "x-openqr-site": SITE,
        "x-openqr-ip": "127.0.0.1",
        origin,
        ...(user ? { cookie: "oq_access=" + user.token } : {}),
        ...(data !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    }),
  );
export function seed() {
  if (
    !rest.startsWith("http://127.0.0.1:") ||
    !container.startsWith("openqr-hosted-")
  )
    throw new Error("Hosted tests require their disposable local containers");
  sql(
    "update public.oq_launch_config set value='owner@example.com' where key='bootstrap_admin_email'; truncate auth.users cascade; delete from public.oq_launch_config where key='bootstrap_admin_claimed';",
  );
  for (const u of users)
    sql(
      `insert into auth.users values('${u.id}','${u.email}',now());insert into auth.sessions values('${u.session}','${u.id}');`,
    );
  sql(
    `insert into public.oq_launch_config values('gateway_token','${gateway}') on conflict(key) do update set value=excluded.value;`,
  );
}

export {
  handle,
  call,
  sql,
  admin,
  regular,
  users,
  fetcher,
  env,
  gateway,
  rest,
  sent,
  jwt,
};
