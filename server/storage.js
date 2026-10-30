import express from "express";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  rm,
  access,
  copyFile,
} from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { tmpdir, hostname } from "node:os";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { problem, audit } from "./security.js";
import { constants } from "node:fs";
import { inspectMedia } from "./media.js";
import { parseGallery } from "./collections.js";
import { blockAssetsOfData, assertBlockAssets, parseBlocks } from "./experience-blocks.js";

export const assetFields = ["pdfId", "portraitId", "coverId", "mediaId"];
export const referencedAssets = (data) => {
  let items = [];
  try {
    items = JSON.parse(data.items || "[]");
  } catch {}
  return [
    ...new Set(
      [
        ...assetFields.map((key) => data[key]),
        ...(Array.isArray(items) ? items.map((item) => item?.assetId) : []),
        ...blockAssetsOfData(data),
      ].filter(Boolean),
    ),
  ];
};
export function migrateCollections(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= 5) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "ALTER TABLE assets ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'; CREATE TABLE page_templates(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,page_options TEXT NOT NULL,UNIQUE(workspace_id,name)); PRAGMA user_version=5; COMMIT;",
    );
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
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
export function createStorage(
  root,
  {
    objectStore,
    quota = 1024 * 1024 * 1024,
    maxUpload = 100 * 1024 * 1024,
    backupBucket,
    backupPrefix,
    backupStore,
  } = {},
) {
  const temporary = !root,
    mediaDir = resolve(root || join(tmpdir(), `openqr-media-${randomUUID()}`)),
    lockPath = join(dirname(mediaDir), `.${basename(mediaDir)}.lock`);
  const filePath = (key) => {
    if (!/^[a-f0-9-]{36}\.(pdf|png|jpg|mp3|mp4|webm)$/.test(key))
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
    kind: objectStore ? "s3" : "local",
    quota,
    maxUpload,
    objectStore,
    backupBucket,
    backupPrefix,
    backupStore,
    temporary,
    filePath,
    exclusive,
    async put(key, bytes, mime) {
      if (objectStore) return objectStore.put(key, bytes, mime);
      await mkdir(mediaDir, { recursive: true });
      const file = await open(filePath(key), "wx");
      try {
        await file.writeFile(bytes);
      } catch (e) {
        await unlink(filePath(key)).catch(() => {});
        throw e;
      } finally {
        await file.close();
      }
    },
    async read(key) {
      if (objectStore) {
        try {
          return await objectStore.read(key);
        } catch (e) {
          if (!["NoSuchKey", "NotFound"].includes(e.name)) throw e;
        }
      }
      return readFile(filePath(key));
    },
    async copyTo(key, path) {
      if (objectStore) {
        try {
          return await objectStore.copyTo(key, path);
        } catch (e) {
          if (!["NoSuchKey", "NotFound"].includes(e.name)) throw e;
        }
      }
      return copyFile(filePath(key), path);
    },
    async remove(key) {
      if (objectStore) await objectStore.remove(key);
      await unlink(filePath(key)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    },
    async serve(key, req, res, next) {
      try {
        if (objectStore) {
          try {
            return await objectStore.serve(key, req, res);
          } catch (e) {
            if (!["NoSuchKey", "NotFound"].includes(e.name)) throw e;
          }
        }
        res.sendFile(filePath(key), (e) => {
          if (e) next(e);
        });
      } catch (e) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        next(problem("File storage is unavailable. Try again shortly.", 503));
      }
    },
    async ready() {
      await mkdir(mediaDir, { recursive: true });
      await access(mediaDir, constants.W_OK);
      if (objectStore) await objectStore.ready();
    },
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
    metadata: JSON.parse(row.metadata || "{}"),
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
    const expected =
      key === "pdfId"
        ? ["pdf"]
        : key === "mediaId"
          ? ["audio", "video"].includes(type)
            ? [type]
            : ["audio", "video"]
          : ["image", "logo"];
    if (!row || !expected.includes(row.kind))
      throw problem("Choose a valid file from this workspace.");
  }
  if (type === "pdf" && !data.pdfId)
    throw problem("Choose a PDF for this page.");
  if (type === "experience")
    assertBlockAssets(db, parseBlocks(data), workspaceId);
  if (type === "gallery")
    for (const item of parseGallery(data)) {
      const row = db
        .prepare("SELECT kind FROM assets WHERE id=? AND workspace_id=?")
        .get(item.assetId, workspaceId);
      if (!row || !["image", "logo"].includes(row.kind))
        throw problem("Choose gallery images from this workspace.");
    }
}
export function registerAssetRoutes(app, db, storage, entitlements) {
  const workspaceQuota = (workspaceId) =>
    entitlements?.quota(workspaceId) ?? storage.quota;
  let uploads = 0;
  app.get("/api/storage", (req, res) =>
    res.json({
      usedBytes: db
        .prepare(
          "SELECT COALESCE(SUM(size),0) total FROM assets WHERE workspace_id=?",
        )
        .get(req.workspace.id).total,
      limitBytes: workspaceQuota(req.workspace.id),
      maxUploadBytes: storage.maxUpload,
      backend: storage.kind,
    }),
  );
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
    (req, res, next) => {
      if (uploads >= 2)
        return res
          .status(429)
          .json({
            error:
              "Two uploads are already being processed. Try again shortly.",
          });
      uploads++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          uploads--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
    express.raw({ type: () => true, limit: storage.maxUpload }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw problem("Choose a PDF, PNG, JPEG, MP3, MP4, or WebM file.");
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
        pages = null,
        metadata = {},
        extension;
      const media = await inspectMedia(original);
      if (media) {
        if (req.query.kind === "logo")
          throw problem("Choose a PNG or JPEG for your logo.");
        ({ mime, kind, extension, metadata } = media);
        bytes = original;
      } else if (original.length > 20 * 1024 * 1024)
        throw problem("PDFs and images must be at most 20 MB.");
      else if (original.subarray(0, 5).toString() === "%PDF-") {
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
        key = `${id}.${extension || (kind === "pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg")}`,
        hash = createHash("sha256").update(bytes).digest("hex");
      await storage.exclusive(async () => {
        if (req.aborted || res.destroyed) throw problem("Upload cancelled.");
        req.assertEdit();
        const used = db
          .prepare(
            "SELECT COALESCE(SUM(size),0) total FROM assets WHERE workspace_id=?",
          )
          .get(req.workspace.id).total;
        if (used + bytes.length > workspaceQuota(req.workspace.id))
          throw problem(
            "This workspace has reached its storage limit. Remove unused files or ask the server operator to increase it.",
            413,
          );
        await storage.put(key, bytes, mime);
        let inserting = false;
        try {
          if (req.aborted || res.destroyed) throw problem("Upload cancelled.");
          req.assertEdit();
          db.exec("BEGIN IMMEDIATE");
          inserting = true;
          const currentUsed = db
            .prepare(
              "SELECT COALESCE(SUM(size),0) total FROM assets WHERE workspace_id=?",
            )
            .get(req.workspace.id).total;
          if (currentUsed + bytes.length > workspaceQuota(req.workspace.id))
            throw problem("This workspace has reached its storage limit.", 413);
          db.prepare(
            "INSERT INTO assets (id,workspace_id,user_id,name,kind,mime,size,storage_key,sha256,pages,created_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
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
            JSON.stringify(metadata),
          );
          audit(db, req.workspace.id, req.user.id, "asset.uploaded", id, {
            name,
            kind,
          });
          db.exec("COMMIT");
          inserting = false;
        } catch (e) {
          if (inserting) db.exec("ROLLBACK");
          await storage.remove(key);
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
    storage.serve(row.storage_key, req, res, next);
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
          .some((c) => referencedAssets(JSON.parse(c.data)).includes(row.id)) ||
        db
          .prepare("SELECT data FROM page_templates WHERE workspace_id=?")
          .all(req.workspace.id)
          .some((t) => referencedAssets(JSON.parse(t.data)).includes(row.id)) ||
        db
          .prepare(
            "SELECT blocks FROM experience_drafts d JOIN codes c ON c.id=d.code_id WHERE c.workspace_id=? UNION ALL SELECT blocks FROM experience_versions v JOIN codes c ON c.id=v.code_id WHERE c.workspace_id=?",
          )
          .all(req.workspace.id, req.workspace.id)
          .some((b) => blockAssetsOfData({ blocks: b.blocks }).includes(row.id))
      )
        throw problem(
          "This file is used by a QR page, page template, draft or earlier version. Replace it there before removing it.",
          409,
        );
      db.prepare("DELETE FROM assets WHERE id=? AND workspace_id=?").run(
        row.id,
        req.workspace.id,
      );
      try {
        await storage.remove(row.storage_key);
      } catch (e) {
        db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
          row.id,
          row.workspace_id,
          row.user_id,
          row.name,
          row.kind,
          row.mime,
          row.size,
          row.storage_key,
          row.sha256,
          row.pages,
          row.created_at,
          row.metadata,
        );
        throw e;
      }
      audit(db, req.workspace.id, req.user.id, "asset.deleted", row.id, {
        name: row.name,
      });
    });
    res.json({ ok: true });
  });
}
