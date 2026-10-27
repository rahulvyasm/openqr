import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
  copyFile,
  link,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { resolve, join, dirname, parse } from "node:path";
import * as tar from "tar";

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
const safeArchivePath = (path) =>
  path === "openqr.sqlite" ||
  path === "manifest.json" ||
  path === "media/" ||
  path === "media" ||
  /^media\/[a-f0-9-]{36}\.(pdf|png|jpg)$/.test(path);
const safeEntry = (path, type) =>
  safeArchivePath(path) &&
  (type === "Directory"
    ? /^media\/?$/.test(path)
    : type === "File" && !/^media\/?$/.test(path));
async function removeStage(path, parent) {
  const target = resolve(path),
    root = resolve(parent);
  if (dirname(target) !== root || !parse(target).base.startsWith(".openqr-"))
    throw new Error("Refusing to remove an unexpected backup staging path.");
  await rm(target, { recursive: true, force: true });
}
export async function createBackup({
  db,
  storage,
  directory,
  publicUrl,
  retention = 7,
}) {
  if (!Number.isInteger(retention) || retention < 1)
    throw new Error("Use a positive backup retention count.");
  const folder = resolve(directory);
  await mkdir(folder, { recursive: true });
  return storage.exclusive(async () => {
    const stage = await mkdtemp(join(folder, ".openqr-backup-")),
      name = `openqr-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.tar.gz`,
      archive = join(folder, name);
    try {
      await mkdir(join(stage, "media"));
      await backup(db, join(stage, "openqr.sqlite"));
      const snapshot = new DatabaseSync(join(stage, "openqr.sqlite"), {
        readOnly: true,
      });
      let files, schema;
      try {
        files = snapshot
          .prepare("SELECT id,storage_key,size,sha256 FROM assets")
          .all();
        schema = snapshot.prepare("PRAGMA user_version").get().user_version;
      } finally {
        snapshot.close();
      }
      for (const file of files) {
        const source = storage.filePath(file.storage_key);
        if ((await checksum(source)) !== file.sha256)
          throw new Error("A stored file failed its backup checksum.");
        try {
          await link(source, join(stage, "media", file.storage_key));
        } catch {
          await copyFile(source, join(stage, "media", file.storage_key));
        }
      }
      await writeFile(
        join(stage, "manifest.json"),
        JSON.stringify(
          {
            format: 1,
            schema,
            createdAt: new Date().toISOString(),
            publicUrl,
            databaseSha256: await checksum(join(stage, "openqr.sqlite")),
            files,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      await tar.c(
        { gzip: true, file: archive + ".partial", cwd: stage, portable: true },
        ["openqr.sqlite", "manifest.json", "media"],
      );
      await rename(archive + ".partial", archive);
      const archives = (await readdir(folder))
        .filter((n) => /^openqr-\d{4}-.*\.tar\.gz$/.test(n))
        .sort()
        .reverse();
      for (const old of archives.slice(Math.max(1, retention)))
        await unlink(join(folder, old));
      return archive;
    } finally {
      await unlink(archive + ".partial").catch(() => {});
      await removeStage(stage, folder);
    }
  });
}
export async function restoreBackup({
  archive,
  dataDir,
  confirmedStopped,
  maxBytes = 1024 * 1024 * 1024,
}) {
  if (!confirmedStopped)
    throw new Error("Stop OpenQR and pass --confirm-stopped before restoring.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("Use a positive restore byte limit.");
  const root = resolve(dataDir);
  if (root === parse(root).root)
    throw new Error("Choose a dedicated OpenQR data directory.");
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(join(root, ".openqr-restore-"));
  let moved = [];
  try {
    let total = 0,
      count = 0;
    const seen = new Set();
    let validationError;
    await tar.t({
      file: resolve(archive),
      strict: true,
      onReadEntry: (entry) => {
        if (
          !safeEntry(entry.path, entry.type) ||
          seen.has(entry.path) ||
          ++count > 10000
        )
          validationError = new Error(
            "The backup contains an unsupported archive entry.",
          );
        seen.add(entry.path);
        total += entry.size;
        if (
          total > maxBytes ||
          (entry.path === "manifest.json" && entry.size > 10 * 1024 * 1024)
        )
          validationError = new Error(
            "The backup exceeds the configured restore limit.",
          );
      },
    });
    if (validationError) throw validationError;
    if (!seen.has("media") && !seen.has("media/"))
      throw new Error("The backup media directory is missing.");
    await tar.x({
      file: resolve(archive),
      cwd: stage,
      strict: true,
      preservePaths: false,
      filter: (path, entry) => safeEntry(path, entry.type),
    });
    const manifest = JSON.parse(
      await readFile(join(stage, "manifest.json"), "utf8"),
    );
    if (
      manifest.format !== 1 ||
      manifest.schema !== 4 ||
      !Array.isArray(manifest.files)
    )
      throw new Error("This backup format is not supported by OpenQR v0.4.");
    if (
      (await checksum(join(stage, "openqr.sqlite"))) !== manifest.databaseSha256
    )
      throw new Error("The database checksum does not match.");
    const db = new DatabaseSync(join(stage, "openqr.sqlite"), {
      readOnly: true,
    });
    let files;
    try {
      if (
        db.prepare("PRAGMA user_version").get().user_version !==
          manifest.schema ||
        db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("The backup database failed its integrity check.");
      files = db.prepare("SELECT id,storage_key,size,sha256 FROM assets").all();
    } finally {
      db.close();
    }
    if (files.length !== manifest.files.length)
      throw new Error("The backup media manifest does not match.");
    const expected = new Set([
      "openqr.sqlite",
      "manifest.json",
      "media",
      "media/",
      ...files.map((file) => "media/" + file.storage_key),
    ]);
    if ([...seen].some((path) => !expected.has(path)))
      throw new Error("The backup contains media outside its manifest.");
    for (const file of files) {
      if (
        !safeArchivePath("media/" + file.storage_key) ||
        !manifest.files.some(
          (f) =>
            f.id === file.id &&
            f.storage_key === file.storage_key &&
            f.sha256 === file.sha256,
        ) ||
        (await checksum(join(stage, "media", file.storage_key))) !==
          file.sha256 ||
        (await stat(join(stage, "media", file.storage_key))).size !== file.size
      )
        throw new Error("A backup media file failed validation.");
    }
    const history = join(
      root,
      "restore-history",
      new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        randomUUID().slice(0, 8),
    );
    await mkdir(history, { recursive: true });
    let installedDatabase = false;
    try {
      for (const name of [
        "openqr.sqlite",
        "openqr.sqlite-wal",
        "openqr.sqlite-shm",
        "media",
      ]) {
        try {
          await rename(join(root, name), join(history, name));
          moved.push(name);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      await rename(join(stage, "openqr.sqlite"), join(root, "openqr.sqlite"));
      installedDatabase = true;
      await rename(join(stage, "media"), join(root, "media"));
    } catch (e) {
      if (installedDatabase)
        await unlink(join(root, "openqr.sqlite")).catch(() => {});
      for (const name of moved.reverse())
        await rename(join(history, name), join(root, name));
      throw e;
    }
    return { history, publicUrl: manifest.publicUrl };
  } finally {
    await removeStage(stage, root);
  }
}
