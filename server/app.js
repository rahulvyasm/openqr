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
import QRCode from "qrcode";
import { z } from "zod";
import { codeSchema, payload } from "./payload.js";

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
  app.use(express.json({ limit: "24kb" }));
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
  const serialize = (row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    dynamic: !!row.dynamic,
    data: JSON.parse(row.data),
    folderId: row.folder_id,
    color: row.color,
    active: !!row.active,
    createdAt: row.created_at,
    scans: row.scans || 0,
    shortUrl: `${origin}/r/${row.slug}`,
  });
  const findCode = (req) =>
    db
      .prepare("SELECT * FROM codes WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
  app.get("/api/codes", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT c.*, (SELECT COUNT(*) FROM scans WHERE code_id=c.id) AS scans FROM codes c WHERE c.user_id=? ORDER BY c.created_at DESC",
        )
        .all(req.user.id)
        .map(serialize),
    ),
  );
  const validateCode = (body, userId) => {
    const code = codeSchema.parse(body);
    const rgb = code.color
      .slice(1)
      .match(/../g)
      .map((hex) => {
        const value = parseInt(hex, 16) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    if (1.05 / (luminance + 0.05) < 4.5)
      throw new Error(
        "Use a darker QR color for reliable scanning (at least 4.5:1 contrast on white).",
      );
    const content = payload(code);
    QRCode.create(content, { errorCorrectionLevel: "M" });
    if (
      code.folderId &&
      !db
        .prepare("SELECT id FROM folders WHERE id=? AND user_id=?")
        .get(code.folderId, userId)
    )
      throw new Error("Folder not found.");
    return code;
  };
  app.post("/api/codes", (req, res) => {
    const c = validateCode(req.body, req.user.id);
    const id = randomUUID();
    const slug = randomBytes(8).toString("base64url");
    db.prepare("INSERT INTO codes VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      id,
      req.user.id,
      slug,
      c.name,
      c.type,
      +c.dynamic,
      JSON.stringify(c.data),
      c.folderId,
      c.color,
      +c.active,
      new Date().toISOString(),
    );
    res
      .status(201)
      .json(serialize(db.prepare("SELECT * FROM codes WHERE id=?").get(id)));
  });
  app.put("/api/codes/:id", (req, res) => {
    const old = findCode(req);
    if (!old) return res.status(404).json({ error: "QR code not found." });
    const c = validateCode(req.body, req.user.id);
    if (c.type !== old.type || +c.dynamic !== old.dynamic)
      return res
        .status(400)
        .json({ error: "Code type cannot change after creation." });
    if (!old.dynamic && JSON.stringify(c.data) !== old.data)
      return res.status(400).json({
        error: "Static QR content cannot be edited. Create a new code.",
      });
    db.prepare(
      "UPDATE codes SET name=?,data=?,folder_id=?,color=?,active=? WHERE id=? AND user_id=?",
    ).run(
      c.name,
      JSON.stringify(c.data),
      c.folderId,
      c.color,
      +c.active,
      old.id,
      req.user.id,
    );
    res.json(serialize(findCode(req)));
  });
  app.delete("/api/codes/:id", (req, res) => {
    if (!findCode(req))
      return res.status(404).json({ error: "QR code not found." });
    db.prepare("DELETE FROM codes WHERE id=? AND user_id=?").run(
      req.params.id,
      req.user.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/codes/:id/download", async (req, res) => {
    const row = findCode(req);
    if (!row) return res.status(404).json({ error: "QR code not found." });
    const code = serialize(row);
    const content = code.dynamic ? code.shortUrl : payload(code);
    const svg = req.query.format === "svg";
    const options = {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: code.color, light: "#ffffff" },
    };
    res.set(
      "Content-Disposition",
      `attachment; filename="openqr-${code.slug}.${svg ? "svg" : "png"}"`,
    );
    res
      .type(svg ? "image/svg+xml" : "image/png")
      .send(
        svg
          ? await QRCode.toString(content, { ...options, type: "svg" })
          : await QRCode.toBuffer(content, options),
      );
  });
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
  app.get("/api/analytics", (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days))
      ? Number(req.query.days)
      : 30;
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const codeId =
      typeof req.query.codeId === "string" ? req.query.codeId : null;
    const rows = db
      .prepare(
        "SELECT s.* FROM scans s JOIN codes c ON c.id=s.code_id WHERE c.user_id=? AND s.scanned_at>=? AND (? IS NULL OR c.id=?) ORDER BY s.scanned_at",
      )
      .all(req.user.id, since.toISOString(), codeId, codeId);
    const daily = Array.from({ length: days }, (_, i) => {
      const date = new Date(since.getTime() + i * 86400000)
        .toISOString()
        .slice(0, 10);
      return { date, scans: 0 };
    });
    const devices = { Mobile: 0, Desktop: 0, Tablet: 0 };
    const visitors = new Set();
    for (const row of rows) {
      const day = daily.find((d) => d.date === row.scanned_at.slice(0, 10));
      if (day) day.scans++;
      devices[row.device]++;
      visitors.add(row.visitor);
    }
    res.json({
      total: rows.length,
      uniqueDailyVisitors: visitors.size,
      daily,
      devices,
      days,
    });
  });
  app.get("/r/:slug", (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    const row = db
      .prepare("SELECT * FROM codes WHERE slug=? AND dynamic=1")
      .get(req.params.slug);
    if (!row)
      return res
        .status(404)
        .type("text")
        .send("This QR code could not be found.");
    if (!row.active)
      return res
        .status(410)
        .type("text")
        .send("This QR code is currently paused. Please contact its owner.");
    if (req.method === "GET") {
      const ua = req.get("user-agent") || "";
      const device = /iPad|Tablet/i.test(ua)
        ? "Tablet"
        : /Mobile|Android|iPhone/i.test(ua)
          ? "Mobile"
          : "Desktop";
      const now = new Date().toISOString();
      const visitor = digest(
        `${analyticsSalt}|${now.slice(0, 10)}|${req.ip}|${ua}`,
      );
      db.prepare(
        "INSERT INTO scans (code_id,scanned_at,visitor,device) VALUES (?,?,?,?)",
      ).run(row.id, now, visitor, device);
    }
    res.redirect(302, payload({ type: row.type, data: JSON.parse(row.data) }));
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
