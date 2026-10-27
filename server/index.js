import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3001);
const dataDir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
const { app, db } = createApp({
  dbPath: resolve(dataDir, "openqr.sqlite"),
  publicUrl: process.env.PUBLIC_URL || "http://localhost:5173",
  secureCookie: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "1",
});
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const server = app.listen(port, host, () =>
  console.log(`OpenQR API listening on http://localhost:${port}`),
);
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
