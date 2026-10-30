import "dotenv/config";
import { resolve, join } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createApp } from "./app.js";
import { storageOptionsFromEnv } from "./object-store.js";
const args = process.argv.slice(2),
  root = resolve(process.env.DATA_DIR || "data");
try {
  if (!args.includes("--confirm-stopped"))
    throw new Error(
      "Stop OpenQR, then run npm run storage:sync -- --confirm-stopped. Add --prune-local to remove verified local copies.",
    );
  const { objectStore } = storageOptionsFromEnv();
  if (!objectStore)
    throw new Error(
      "Configure S3_BUCKET and the S3 connection before syncing media.",
    );
  const { db, storage } = createApp({ dbPath: join(root, "openqr.sqlite") });
  try {
    await storage.exclusive(async () => {
      const assets = db.prepare("SELECT * FROM assets").all(),
        local = [];
      for (const asset of assets) {
        let bytes;
        try {
          bytes = await readFile(storage.filePath(asset.storage_key));
          local.push(asset.storage_key);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        if (
          bytes &&
          createHash("sha256").update(bytes).digest("hex") !== asset.sha256
        )
          throw new Error(
            "A local file failed its checksum. No local files were removed.",
          );
        let remote;
        try {
          remote = await objectStore.read(asset.storage_key);
        } catch (e) {
          if (!["NoSuchKey", "NotFound"].includes(e.name)) throw e;
        }
        if (!remote) {
          if (!bytes)
            throw new Error("A media file is missing locally and remotely.");
          await objectStore.put(asset.storage_key, bytes, asset.mime);
          remote = await objectStore.read(asset.storage_key);
        }
        if (createHash("sha256").update(remote).digest("hex") !== asset.sha256)
          throw new Error(
            "A remote file failed its checksum. No local files were removed.",
          );
      }
      if (args.includes("--prune-local"))
        for (const key of local) await unlink(storage.filePath(key));
      console.log(
        `Verified ${assets.length} media files in object storage.${args.includes("--prune-local") ? " Removed verified local copies." : " Local copies were retained."}`,
      );
    });
  } finally {
    db.close();
    objectStore.client.destroy();
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
