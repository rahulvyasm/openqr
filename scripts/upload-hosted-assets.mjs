// Receives a short-lived Pages upload token on stdin. Never writes or logs it.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { hash } = wranglerRequire("blake3-wasm");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { token } = JSON.parse(input);
if (typeof token !== "string") throw new Error("Missing Pages upload token");
const root = "dist-hosted";
const files = [];
const manifest = {};
const types = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
};
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      walk(path);
      continue;
    }
    const name = "/" + relative(root, path).replaceAll("\\", "/");
    if (
      ["/_worker.js", "/_headers", "/_routes.json", "/_redirects"].includes(
        name,
      )
    )
      continue;
    const bytes = readFileSync(path);
    const extension = extname(path).slice(1);
    const key = hash(bytes.toString("base64") + extension)
      .toString("hex")
      .slice(0, 32);
    manifest[name] = key;
    files.push({
      key,
      value: bytes.toString("base64"),
      metadata: {
        contentType: types[extname(path)] || "application/octet-stream",
      },
      base64: true,
    });
  }
}
walk(root);
async function call(path, payload) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/pages/assets/" + path,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(
      "Asset " + path + " failed: " + JSON.stringify(result.errors),
    );
  return result.result;
}
const missing = new Set(
  await call("check-missing", { hashes: files.map((f) => f.key) }),
);
let batch = [],
  size = 0,
  uploaded = 0;
for (const f of files.filter((f) => missing.has(f.key))) {
  if (size + f.value.length > 4000000 && batch.length) {
    await call("upload", batch);
    uploaded += batch.length;
    batch = [];
    size = 0;
  }
  batch.push(f);
  size += f.value.length;
}
if (batch.length) {
  await call("upload", batch);
  uploaded += batch.length;
}
await call("upsert-hashes", { hashes: files.map((f) => f.key) });
writeFileSync(".hosted-build/pages-manifest.json", JSON.stringify(manifest));
console.log(
  JSON.stringify({
    files: files.length,
    uploaded,
    manifest: ".hosted-build/pages-manifest.json",
  }),
);
