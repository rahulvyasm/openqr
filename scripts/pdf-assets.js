// Keep PDF rendering resources local in both Vite development and production builds.
import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const target = resolve("public/pdfjs");
await mkdir(target, { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm"])
  await cp(resolve("node_modules/pdfjs-dist", name), join(target, name), {
    recursive: true,
  });
await cp(resolve("node_modules/pdfjs-dist/LICENSE"), join(target, "LICENSE"));
