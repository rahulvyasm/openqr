import express from "express";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, rm } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { tmpdir, hostname } from "node:os";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { problem, audit } from "./security.js";

export const assetFields = ["pdfId", "portraitId", "coverId"];
export const referencedAssets = (data) => [
  ...new Set(assetFields.map((key) => data[key]).filter(Boolean)),
];
export function migratePublishing(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= 4) return;
  try {
    db.exec(
      `BEGIN IMMEDIATE; CREATE TABLE assets(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,storage_key TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,pages INTEGER,created_at TEXT NOT NULL); CREATE INDEX assets_workspace ON assets(workspace_id); ALTER TABLE codes ADD COLUMN page_options TEXT NOT NULL DEFAULT '{}'; PRAGMA user_version=4; COMMIT;`,
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function createStorage(root) {
  const temporary = !root,
    mediaDir = resolve(root || join(tmpdir(), `openqr-media-${randomUUID()}`)),
    lockPath = join(dirname(mediaDir), `.${basename(mediaDir)}.lock`);
  const filePath = (key) => {
    if (!/^[a-f0-9-]{36}\.(pdf|png|jpg)$/.test(key))
      throw problem("Invalid stored file.", 500);
    return join(mediaDir, key);
  };
  async function exclusive(fn) {
    await mkdir(mediaDir, { recursive: true });
    let handle;
    for (let i = 0; i < 200; i++) {
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, host: hostname() }),
        );
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const lock = JSON.parse(await readFile(lockPath, "utf8"));
          if (lock.host === hostname()) {
            try {
              process.kill(lock.pid, 0);
            } catch (e) {
              if (e.code === "ESRCH") {
                await unlink(lockPath);
                continue;
              }
            }
          }
        } catch {
          /* Another operation may be finishing its lock. */
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    if (!handle) throw problem("File storage is busy. Try again shortly.", 503);
    try {
      return await fn();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => {});
    }
  }
  return {
    root: mediaDir,
    temporary,
    filePath,
    exclusive,
    async dispose() {
      if (temporary) {
        await rm(mediaDir, { recursive: true, force: true });
        await unlink(lockPath).catch(() => {});
      }
    },
  };
}
export function serializeAsset(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    pages: row.pages,
    createdAt: row.created_at,
    url: `/api/assets/${row.id}/content`,
  };
}
export function validateAssetReferences(db, data, workspaceId, type) {
  for (const key of assetFields) {
    if (!data[key]) continue;
    const row = db
      .prepare("SELECT kind FROM assets WHERE id=? AND workspace_id=?")
      .get(data[key], workspaceId);
    if (!row || (key === "pdfId") !== (row.kind === "pdf"))
      throw problem("Choose a valid file from this workspace.");
  }
  if (type === "pdf" && !data.pdfId)
    throw problem("Choose a PDF for this page.");
}
export function registerAssetRoutes(app, db, storage) {
  app.get("/api/assets", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM assets WHERE workspace_id=? ORDER BY created_at DESC",
        )
        .all(req.workspace.id)
        .map(serializeAsset),
    ),
  );
  app.post(
    "/api/assets",
    express.raw({ type: () => true, limit: "20mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw problem("Choose a PDF, PNG, or JPEG file.");
      let name;
      try {
        name = decodeURIComponent(req.get("x-file-name") || "Untitled file");
      } catch {
        throw problem("Invalid file name.");
      }
      name =
        basename(name.replace(/\\/g, "/"))
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 180) || "Untitled file";
      const original = req.body;
      let bytes,
        mime,
        kind,
        pages = null;
      if (original.subarray(0, 5).toString() === "%PDF-") {
        if (req.query.kind === "logo")
          throw problem("Choose a PNG or JPEG for your logo.");
        try {
          const doc = await PDFDocument.load(original, {
            updateMetadata: false,
          });
          pages = doc.getPageCount();
          if (!pages) throw new Error();
        } catch {
          throw problem("Choose a valid, unencrypted PDF.");
        }
        bytes = original;
        mime = "application/pdf";
        kind = "pdf";
      } else {
        try {
          const image = sharp(original, {
              limitInputPixels: 16_000_000,
              animated: false,
            }),
            meta = await image.metadata();
          if (!["png", "jpeg"].includes(meta.format)) throw new Error();
          kind = req.query.kind === "logo" ? "logo" : "image";
          if (kind === "logo") {
            bytes = await image
              .rotate()
              .resize(128, 128, { fit: "inside", withoutEnlargement: true })
              .png()
              .toBuffer();
            mime = "image/png";
          } else if (meta.hasAlpha) {
            bytes = await image
              .rotate()
              .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
              .png()
              .toBuffer();
            mime = "image/png";
          } else {
            bytes = await image
              .rotate()
              .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 88 })
              .toBuffer();
            mime = "image/jpeg";
          }
        } catch {
          throw problem("Choose a PNG or JPEG with at most 16 million pixels.");
        }
      }
      const id = randomUUID(),
        key = `${id}.${kind === "pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`,
        hash = createHash("sha256").update(bytes).digest("hex");
      await storage.exclusive(async () => {
        req.assertEdit();
        const file = await open(storage.filePath(key), "wx");
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
        try {
          db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
            id,
            req.workspace.id,
            req.user.id,
            name,
            kind,
            mime,
            bytes.length,
            key,
            hash,
            pages,
            new Date().toISOString(),
          );
          audit(db, req.workspace.id, req.user.id, "asset.uploaded", id, {
            name,
            kind,
          });
        } catch (e) {
          await unlink(storage.filePath(key));
          throw e;
        }
      });
      res
        .status(201)
        .json(
          serializeAsset(db.prepare("SELECT * FROM assets WHERE id=?").get(id)),
        );
    },
  );
  app.get("/api/assets/:id/content", (req, res, next) => {
    const row = db
      .prepare("SELECT * FROM assets WHERE id=? AND workspace_id=?")
      .get(req.params.id, req.workspace.id);
    if (!row) throw problem("File not found.", 404);
    res.type(row.mime).set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (row.kind === "pdf")
      res.set({
        "Content-Disposition": 'attachment; filename="document.pdf"',
        "Content-Security-Policy": "sandbox; default-src 'none'",
      });
    res.sendFile(storage.filePath(row.storage_key), (error) => {
      if (error) next(error);
    });
  });
  app.delete("/api/assets/:id", async (req, res) => {
    await storage.exclusive(async () => {
      req.assertEdit();
      const row = db
        .prepare("SELECT * FROM assets WHERE id=? AND workspace_id=?")
        .get(req.params.id, req.workspace.id);
      if (!row) throw problem("File not found.", 404);
      if (
        db
          .prepare("SELECT data FROM codes WHERE workspace_id=?")
          .all(req.workspace.id)
          .some((c) => referencedAssets(JSON.parse(c.data)).includes(row.id))
      )
        throw problem(
          "This file is used by a QR page. Replace it on that page before removing it.",
          409,
        );
      const trash = storage.filePath(row.storage_key) + ".trash";
      await rename(storage.filePath(row.storage_key), trash);
      try {
        db.prepare("DELETE FROM assets WHERE id=? AND workspace_id=?").run(
          row.id,
          req.workspace.id,
        );
      } catch (e) {
        await rename(trash, storage.filePath(row.storage_key));
        throw e;
      }
      await unlink(trash);
      audit(db, req.workspace.id, req.user.id, "asset.deleted", row.id, {
        name: row.name,
      });
    });
    res.json({ ok: true });
  });
}
