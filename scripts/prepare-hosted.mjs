import { copyFileSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
copyFileSync("hosted/worker.js", "dist-hosted/_worker.js");
writeFileSync(
  "dist-hosted/_routes.json",
  JSON.stringify({
    version: 1,
    include: ["/api/*", "/r/*", "/health/*"],
    exclude: [],
  }),
);
writeFileSync(
  "dist-hosted/_headers",
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// Collect only the backend's source dependencies, never local data or credentials.
const files = new Map();
function collect(path) {
  path = path.replaceAll("\\", "/");
  if (files.has(path)) return;
  const content = readFileSync(path, "utf8");
  files.set(path, content);
  for (const m of content.matchAll(
    /(?:from\s*|import\s*)["'](\.[^"']+)["']/g,
  )) {
    const full = resolve(dirname(path), m[1]);
    const root = resolve(".");
    if (!full.startsWith(root + (process.platform === "win32" ? "\\" : "/")))
      throw new Error("Import leaves the repository");
    collect(full.slice(root.length + 1));
  }
}
collect("hosted/edge-entry.js");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const imports = {};
for (const name of [
  "zod",
  "qrcode",
  "pngjs",
  "jpeg-js",
  "pdf-lib",
  "file-type",
  "music-metadata",
])
  imports[name] =
    "npm:" + name + "@" + lock.packages["node_modules/" + name].version;
files.set(
  "deno.json",
  JSON.stringify({
    imports,
    compilerOptions: { allowJs: true, checkJs: false },
  }),
);
mkdirSync(".hosted-build", { recursive: true });
writeFileSync(
  ".hosted-build/edge-payload.json",
  JSON.stringify({
    files: [...files].map(([name, content]) => ({ name, content })),
    entrypoint_path: "hosted/edge-entry.js",
    import_map_path: "deno.json",
  }),
);
console.log(`Prepared ${files.size} backend files and the Cloudflare site.`);
