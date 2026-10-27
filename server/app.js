import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { z } from "zod";
import { migrateCodes, registerCodeRoutes } from "./codes.js";

import { migrateWorkspaces, registerWorkspaceRoutes } from "./workspaces.js";
import { registerAuth } from "./auth.js";
import { access, problem } from "./security.js";
import {
  createStorage,
  migratePublishing,
  migrateCollections,
  registerAssetRoutes,
} from "./storage.js";

export function createApp({
  dbPath,
  publicUrl = "http://localhost:5173",
  secureCookie = false,
  trustProxy = false,
  storageDir,
  storageOptions = {},
} = {}) {
  const origin = new URL(publicUrl).origin;
  if (!dbPath) {
    mkdirSync(resolve("data"), { recursive: true });
    dbPath = resolve("data/openqr.sqlite");
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, UNIQUE(user_id,name));
    CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, dynamic INTEGER NOT NULL, data TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, color TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE, scanned_at TEXT NOT NULL, visitor TEXT NOT NULL, device TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS scans_code_date ON scans(code_id, scanned_at);
    CREATE INDEX IF NOT EXISTS codes_owner ON codes(user_id);
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  try {
    migrateCodes(db);
    migrateWorkspaces(db);
    migratePublishing(db);
    migrateCollections(db);
  } catch (error) {
    db.close();
    throw error;
  }
  db.prepare("INSERT OR IGNORE INTO config VALUES (?,?)").run(
    "analytics_salt",
    randomBytes(32).toString("hex"),
  );
  const analyticsSalt = db
    .prepare("SELECT value FROM config WHERE key=?")
    .get("analytics_salt").value;
  const app = express();
  const storage = createStorage(
    storageDir ||
      (dbPath === ":memory:"
        ? undefined
        : join(dirname(resolve(dbPath)), "media")),
    storageOptions,
  );
  app.disable("x-powered-by");
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      await storage.ready();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  if (trustProxy) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          workerSrc: ["'self'", "blob:"],
          fontSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== origin
    )
      return res.status(403).json({ error: "Request origin not allowed." });
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in 15 minutes." },
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait a moment." },
    }),
  );
  const { requireAuth } = registerAuth(
    app,
    db,
    origin,
    secureCookie,
    authLimit,
  );
  app.use("/api", requireAuth);
  registerWorkspaceRoutes(app, db, origin);
  app.use("/api", (req, _res, next) => {
    if (!req.workspace)
      throw problem("Choose or create a workspace first.", 403);
    const workspaceId = req.workspace.id;
    const liveSession = () => {
      if (
        !db
          .prepare(
            "SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?",
          )
          .get(req.sessionId, req.user.id, Date.now())
      )
        throw problem("Please sign in again.", 401);
    };
    req.assertRead = () => {
      liveSession();
      return access(db, req.user.id, workspaceId);
    };
    req.assertEdit = () => {
      liveSession();
      return access(db, req.user.id, workspaceId, "edit");
    };
    req.assertRead();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !(req.method === "POST" && req.path === "/codes/export")
    )
      req.assertEdit();
    next();
  });
  registerAssetRoutes(app, db, storage);
  registerCodeRoutes(app, db, origin, analyticsSalt, storage);
  app.get("/api/folders", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name FROM folders WHERE workspace_id=? ORDER BY name",
        )
        .all(req.workspace.id),
    ),
  );
  app.post("/api/folders", (req, res) => {
    const name = z.string().trim().min(1).max(60).parse(req.body.name);
    const id = randomUUID();
    if (
      db
        .prepare("SELECT id FROM folders WHERE workspace_id=? AND name=?")
        .get(req.workspace.id, name)
    )
      return res
        .status(409)
        .json({ error: "A folder with that name already exists." });
    db.prepare(
      "INSERT INTO folders (id,user_id,name,workspace_id) VALUES (?,?,?,?)",
    ).run(id, req.user.id, name, req.workspace.id);
    res.status(201).json({ id, name });
  });
  app.delete("/api/folders/:id", (req, res) => {
    db.prepare("DELETE FROM folders WHERE id=? AND workspace_id=?").run(
      req.params.id,
      req.workspace.id,
    );
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res, next) =>
    res.sendFile(resolve("dist/index.html"), (err) => {
      if (err) next(err);
    }),
  );
  app.use((err, _req, res, _next) => {
    if (err.domain)
      return res.status(err.status || 400).json({ error: err.message });
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "Check the form fields and try again.",
        details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    if (err.status === 413)
      return res.status(413).json({ error: "Request is too large." });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON." });
    if (err.code === "ENOENT")
      return res.status(404).json({
        error: "Build the web app first, or use the development server.",
      });
    // Domain validation errors are safe to display; database and unexpected errors are not.
    const safe = /^(Enter |Use |Only |Choose |Folder |The amount of data)/.test(
      err.message,
    );
    if (!safe) console.error(err);
    res.status(safe ? 400 : 500).json({
      error: safe ? err.message : "Something went wrong. Please try again.",
    });
  });
  return { app, db, storage };
}
