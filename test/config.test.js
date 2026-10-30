import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../server/config.js";

const run = promisify(execFile);
const production = {
  NODE_ENV: "production",
  PUBLIC_URL: "https://qr.example.com",
  COOKIE_SECURE: "true",
};

test("configuration preserves development defaults and supports HTTPS and loopback production", () => {
  const dev = loadConfig({});
  assert.equal(dev.publicUrl, "http://localhost:5173");
  assert.equal(dev.host, "127.0.0.1");
  assert.equal(dev.port, 3001);
  const https = loadConfig({
    ...production,
    PUBLIC_URL: "https://qr.example.com/",
    TRUST_PROXY: "1",
    BACKUP_INTERVAL_HOURS: "0.5",
  });
  assert.equal(https.publicUrl, "https://qr.example.com");
  assert.equal(https.secureCookie, true);
  assert.equal(https.trustProxy, true);
  assert.equal(https.backupHours, 0.5);
  assert.equal(https.host, "0.0.0.0");
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const local = loadConfig({
      NODE_ENV: "production",
      PUBLIC_URL: `http://${host}:3001`,
      BACKUP_INTERVAL_HOURS: "0",
    });
    assert.equal(local.secureCookie, false);
    assert.equal(local.backupHours, 0);
  }
});

test("configuration rejects unsafe production origins and ambiguous switches", () => {
  for (const value of [
    "",
    "ftp://qr.example.com",
    "https://user:secret@qr.example.com",
    "https://qr.example.com/path",
    "https://qr.example.com?",
    "https://qr.example.com#",
    "https://0.0.0.0",
    "https://[::]",
    " https://qr.example.com",
    "https://qr.example.com/.",
  ]) {
    assert.throws(
      () => loadConfig({ ...production, PUBLIC_URL: value }),
      /PUBLIC_URL/,
    );
  }
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /PUBLIC_URL/);
  assert.throws(
    () => loadConfig({ ...production, PUBLIC_URL: "http://qr.example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => loadConfig({ ...production, COOKIE_SECURE: "false" }),
    /COOKIE_SECURE/,
  );
  assert.throws(
    () =>
      loadConfig({
        PUBLIC_URL: "http://localhost:3001",
        COOKIE_SECURE: "true",
      }),
    /HTTPS/,
  );
  for (const [name, value] of [
    ["COOKIE_SECURE", "1"],
    ["TRUST_PROXY", "true"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "1.5"],
    ["PORT", ""],
    ["HOST", ""],
    ["HOST", "http://localhost"],
    ["DATA_DIR", ""],
    ["DATA_DIR", resolve("/")],
    ["BACKUP_RETENTION", "0"],
    ["BACKUP_RETENTION", ""],
    ["BACKUP_INTERVAL_HOURS", ""],
    ["BACKUP_INTERVAL_HOURS", "NaN"],
    ["BACKUP_INTERVAL_HOURS", "577"],
    ["MAX_UPLOAD_MB", "501"],
  ]) {
    assert.throws(
      () => loadConfig({ ...production, [name]: value }),
      undefined,
      `${name}=${value}`,
    );
  }
});

function isolatedEnv(root, extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(S3_|AWS_|DOTENV_CONFIG_|NODE_ENV$|PORT$|HOST$|PUBLIC_URL$|COOKIE_SECURE$|TRUST_PROXY$|DATA_DIR$|BACKUP_|MAX_UPLOAD_MB$|WORKSPACE_STORAGE_MB$)/i.test(
          key,
        ),
    ),
  );
  return {
    ...env,
    DOTENV_CONFIG_PATH: join(root, "absent.env"),
    DATA_DIR: join(root, "data"),
    ...extra,
  };
}

test("invalid startup fails before creating the data directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openqr-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const extra of [
    { NODE_ENV: "production" },
    { BACKUP_RETENTION: "0" },
    { MAX_UPLOAD_MB: "501" },
  ]) {
    await assert.rejects(
      run(process.execPath, [resolve("server/index.js")], {
        cwd: root,
        env: isolatedEnv(root, extra),
        timeout: 10000,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /OpenQR configuration error:/);
        assert.doesNotMatch(error.stdout, /listening/);
        return true;
      },
    );
    await assert.rejects(access(join(root, "data")), { code: "ENOENT" });
  }
});

test(
  "production loopback deployment starts and answers health checks after restart",
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "openqr-startup-"));
    let child;
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
    t.after(async () => {
      await stop();
      await rm(root, { recursive: true, force: true });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const reservation = createServer();
      reservation.listen(0, "127.0.0.1");
      await once(reservation, "listening");
      const port = reservation.address().port;
      await new Promise((resolve) => reservation.close(resolve));
      const origin = `http://localhost:${port}`;
      child = spawn(process.execPath, [resolve("server/index.js")], {
        cwd: root,
        env: isolatedEnv(root, {
          NODE_ENV: "production",
          PUBLIC_URL: origin,
          PORT: String(port),
          HOST: "127.0.0.1",
          BACKUP_INTERVAL_HOURS: "0",
        }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error(`Startup timed out: ${output}`)),
          10000,
        );
        const onExit = () => finish(new Error(`Startup exited: ${output}`));
        const onData = () => {
          if (output.includes("OpenQR API listening")) finish();
        };
        function finish(error) {
          clearTimeout(timer);
          child.off("exit", onExit);
          child.off("error", finish);
          child.stdout.off("data", onData);
          error ? reject(error) : resolve();
        }
        child.on("exit", onExit);
        child.on("error", finish);
        child.stdout.on("data", onData);
      });
      for (const [path, status] of [
        ["live", "ok"],
        ["ready", "ready"],
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${port}/health/${path}`,
          { signal: AbortSignal.timeout(3000) },
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status });
      }
      await stop();
    }
  },
);
