import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The free generator (/) and the interactive demo (/demo/) as a static site.
// There is no server: the demo runs the real app against an in-browser mock API.
export default defineConfig({
  root: resolve("lite"),
  publicDir: resolve("lite/public"),
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT || 5280),
    strictPort: true,
    fs: { allow: [resolve(".")] },
  },
  build: {
    outDir: resolve("dist-lite"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve("lite/index.html"),
        demo: resolve("lite/demo/index.html"),
      },
    },
  },
});
