import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Wait for editor/script saves to settle before transforming a changed file.
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 25 } },
    proxy: { "/api": "http://127.0.0.1:3001", "/r": "http://127.0.0.1:3001" },
  },
});
