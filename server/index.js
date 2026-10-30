import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createBackup } from "./backup.js";
import { loadConfig } from "./config.js";
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`OpenQR configuration error: ${error.message}`);
  process.exit(1);
}
const {
  port,
  host,
  dataDir,
  publicUrl,
  secureCookie,
  trustProxy,
  storageOptions,
  backupHours,
  retention,
} = config;
mkdirSync(dataDir, { recursive: true });
const { app, db, storage } = createApp({
  dbPath: resolve(dataDir, "openqr.sqlite"),
  publicUrl,
  secureCookie,
  trustProxy,
  storageOptions,
  backupPolicy: { intervalHours: backupHours, retention },
  hosting: config.hosting,
  notifications: config.notifications,
});
const server = app.listen(port, host, () =>
  console.log(`OpenQR API listening on http://localhost:${port}`),
);
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
          publicUrl,
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
