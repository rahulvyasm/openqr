import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const api = `http://127.0.0.1:${process.env.API_PORT || 3001}`;
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    // Wait for editor/script saves to settle before transforming a changed file.
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 25 } },
    proxy: { "/api": api, "/r": api },
  },
});
