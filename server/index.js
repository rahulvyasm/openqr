import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createBackup } from "./backup.js";
import { storageOptionsFromEnv } from "./object-store.js";
const port = Number(process.env.PORT || 3001);
const dataDir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
const { app, db, storage } = createApp({
  dbPath: resolve(dataDir, "openqr.sqlite"),
  publicUrl: process.env.PUBLIC_URL || "http://localhost:5173",
  secureCookie: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "1",
  storageOptions: storageOptionsFromEnv(),
});
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const server = app.listen(port, host, () =>
  console.log(`OpenQR API listening on http://localhost:${port}`),
);
const backupHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const retention = Number(process.env.BACKUP_RETENTION ?? 7);
if (
  !Number.isFinite(backupHours) ||
  backupHours < 0 ||
  backupHours > 24 * 24 ||
  !Number.isInteger(retention) ||
  retention < 1
)
  throw new Error("Use a valid backup interval and positive retention count.");
let backingUp = false;
let backupInFlight;
const backupTimer = backupHours
  ? setInterval(async () => {
      if (backingUp) return;
      backingUp = true;
      try {
        backupInFlight = createBackup({
          db,
          storage,
          directory: resolve(dataDir, "backups"),
          publicUrl: process.env.PUBLIC_URL || "http://localhost:5173",
          retention,
        });
        await backupInFlight;
        console.log("OpenQR scheduled backup completed.");
      } catch (error) {
        console.error("OpenQR scheduled backup failed:", error.message);
      } finally {
        backingUp = false;
      }
    }, backupHours * 3600000).unref()
  : null;
function stop() {
  if (backupTimer) clearInterval(backupTimer);
  server.close(async () => {
    await backupInFlight?.catch(() => {});
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
