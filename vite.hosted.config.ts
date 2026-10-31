import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";
export default mergeConfig(
  base,
  defineConfig({
    define: { "import.meta.env.VITE_HOSTED": JSON.stringify("true") },
    build: { outDir: "dist-hosted" },
  }),
);
