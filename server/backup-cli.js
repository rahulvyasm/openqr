import "dotenv/config";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { createApp } from "./app.js";
import { createBackup, restoreBackup } from "./backup.js";
const args = process.argv.slice(2),
  root = resolve(process.env.DATA_DIR || "data");
try {
  if (args[0] === "restore") {
    const index = args.indexOf("--archive");
    if (index < 0 || !args[index + 1])
      throw new Error(
        "Usage: npm run restore -- --archive path/to/backup.tar.gz --confirm-stopped",
      );
    const result = await restoreBackup({
      archive: args[index + 1],
      dataDir: root,
      confirmedStopped: args.includes("--confirm-stopped"),
      maxBytes: Number(process.env.RESTORE_MAX_BYTES || 1024 * 1024 * 1024),
    });
    console.log(
      `Restored OpenQR. Previous files are preserved in ${result.history}.\nKeep PUBLIC_URL set to ${result.publicUrl} so printed QR codes keep working.`,
    );
  } else {
    mkdirSync(root, { recursive: true });
    const { db, storage } = createApp({ dbPath: join(root, "openqr.sqlite") });
    try {
      console.log(
        "Backup saved: " +
          (await createBackup({
            db,
            storage,
            directory: join(root, "backups"),
            publicUrl: process.env.PUBLIC_URL || "http://localhost:5173",
            retention: Number(process.env.BACKUP_RETENTION || 7),
          })),
      );
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
