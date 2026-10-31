import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";

// This runner owns disposable containers; it never connects to a hosted database.
const suffix = process.pid + "-" + Date.now();
const pg = "openqr-hosted-pg-" + suffix,
  rest = "openqr-hosted-rest-" + suffix,
  network = "openqr-hosted-" + suffix;
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
try {
  run("docker", ["network", "create", network]);
  run("docker", [
    "run",
    "-d",
    "--name",
    pg,
    "--network",
    network,
    "--network-alias",
    "db",
    "-e",
    "POSTGRES_PASSWORD=local-test-only",
    "postgres:16-alpine",
  ]);
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      run("docker", ["exec", pg, "pg_isready", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) throw new Error("Test database did not start.");
  const psql = (sql) =>
    run(
      "docker",
      ["exec", "-i", pg, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
      { input: sql },
    );
  psql(readFileSync("hosted/database-test-setup.sql", "utf8"));
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    psql(readFileSync("supabase/migrations/" + file, "utf8"));
  psql(readFileSync("hosted/database-tests.sql", "utf8"));
  run("docker", [
    "run",
    "-d",
    "--name",
    rest,
    "--network",
    network,
    "-p",
    "127.0.0.1::3000",
    "-e",
    "PGRST_DB_URI=postgres://postgres:local-test-only@db:5432/postgres",
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    "PGRST_JWT_SECRET=openqr-local-jwt-secret-at-least-32-characters",
    "postgrest/postgrest:v14.17",
  ]);
  const port = run("docker", ["port", rest, "3000/tcp"])
      .trim()
      .split(":")
      .at(-1),
    url = "http://127.0.0.1:" + port;
  ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) throw new Error("Test API did not start.");
  const env = {
    ...process.env,
    HOSTED_TEST_POSTGRES: pg,
    HOSTED_TEST_DATABASE: "postgres",
    HOSTED_TEST_REST: url,
  };
  for (const args of [
    ["--test", "hosted/hosted.test.js"],
    ["hosted/browser-check.mjs"],
  ]) {
    const r = spawnSync(process.execPath, args, { stdio: "inherit", env });
    if (r.status !== 0) throw new Error("Hosted checks failed.");
  }
} finally {
  for (const name of [rest, pg])
    try {
      run("docker", ["rm", "-f", name]);
    } catch {}
  try {
    run("docker", ["network", "rm", network]);
  } catch {}
}
