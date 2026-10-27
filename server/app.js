import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { migrateCodes, registerCodeRoutes } from "./codes.js";

const hashPassword = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const authSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});

export function createApp({
  dbPath,
  publicUrl = "http://localhost:5173",
  secureCookie = false,
  trustProxy = false,
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
  migrateCodes(db);
  db.prepare("INSERT OR IGNORE INTO config VALUES (?,?)").run(
    "analytics_salt",
    randomBytes(32).toString("hex"),
  );
  const analyticsSalt = db
    .prepare("SELECT value FROM config WHERE key=?")
    .get("analytics_salt").value;
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
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
  app.use("/api", (req, _res, next) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("openqr_session="))
      ?.slice(15);
    if (token)
      req.user = db
        .prepare(
          "SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        )
        .get(digest(token), Date.now());
    next();
  });
  const session = (res, id) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      digest(token),
      id,
      Date.now() + 7 * 86400000,
    );
    res.cookie("openqr_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookie,
      maxAge: 7 * 86400000,
      path: "/",
    });
  };
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/status", (req, res) =>
    res.json({
      setupRequired: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      user: req.user || null,
      publicUrl: origin,
    }),
  );
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      return res
        .status(409)
        .json({ error: "This instance already has an owner. Please sign in." });
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.name)
      return res.status(400).json({
        error:
          "Enter your name, a valid email, and a password of 12–128 characters.",
      });
    const { email, password, name } = parsed.data;
    const salt = randomBytes(16).toString("hex");
    const hash = (await hashPassword(password, salt, 64)).toString("hex");
    // Claim the instance atomically after the asynchronous password hash.
    const id = randomUUID();
    const result = db
      .prepare(
        "INSERT INTO users SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users)",
      )
      .run(id, email, name, salt, hash);
    if (!result.changes)
      return res
        .status(409)
        .json({ error: "An owner already claimed this instance." });
    session(res, id);
    res.status(201).json({ id, email, name });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Enter a valid email and password." });
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(parsed.data.email);
    const hash = await hashPassword(
      parsed.data.password,
      user?.salt || "invalid-account-salt",
      64,
    );
    if (!user || !timingSafeEqual(hash, Buffer.from(user.password, "hex")))
      return res.status(401).json({ error: "Email or password is incorrect." });
    session(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  });
  app.use("/api", (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: "Please sign in." }),
  );
  app.post("/api/auth/logout", (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("openqr_session="))
      ?.slice(15);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
    res.clearCookie("openqr_session", {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookie,
    });
    res.json({ ok: true });
  });
  registerCodeRoutes(app, db, origin, analyticsSalt);
  app.get("/api/folders", (req, res) =>
    res.json(
      db
        .prepare("SELECT id,name FROM folders WHERE user_id=? ORDER BY name")
        .all(req.user.id),
    ),
  );
  app.post("/api/folders", (req, res) => {
    const name = z.string().trim().min(1).max(60).parse(req.body.name);
    const id = randomUUID();
    if (
      db
        .prepare("SELECT id FROM folders WHERE user_id=? AND name=?")
        .get(req.user.id, name)
    )
      return res
        .status(409)
        .json({ error: "A folder with that name already exists." });
    db.prepare("INSERT INTO folders VALUES (?,?,?)").run(id, req.user.id, name);
    res.status(201).json({ id, name });
  });
  app.delete("/api/folders/:id", (req, res) => {
    db.prepare("DELETE FROM folders WHERE id=? AND user_id=?").run(
      req.params.id,
      req.user.id,
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
  return { app, db };
}
