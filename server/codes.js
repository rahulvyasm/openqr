import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import { zipSync, strToU8 } from "fflate";
import { codeSchema, payload, destination } from "./payload.js";
import { normalizeDesign, imageFor } from "./design.js";
import { linksPage, unavailablePage } from "./pages.js";

export function migrateCodes(db) {
  if (db.prepare("PRAGMA user_version").get().user_version > 3)
    throw new Error(
      "This database belongs to a newer OpenQR release. Upgrade the server before opening it.",
    );
  if (db.prepare("PRAGMA user_version").get().user_version >= 2) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(codes)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, value] of [
      ["design", "'{}'"],
      ["campaign", "'{}'"],
    ])
      if (!columns.has(name))
        db.exec(
          `ALTER TABLE codes ADD COLUMN ${name} TEXT NOT NULL DEFAULT ${value}`,
        );
    const scanColumns = new Set(
      db
        .prepare("PRAGMA table_info(scans)")
        .all()
        .map((c) => c.name),
    );
    for (const name of ["browser", "os", "referrer"])
      if (!scanColumns.has(name))
        db.exec(
          `ALTER TABLE scans ADD COLUMN ${name} TEXT NOT NULL DEFAULT 'Unknown'`,
        );
    db.exec(
      "CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,color TEXT NOT NULL,design TEXT NOT NULL,UNIQUE(user_id,name)); PRAGMA user_version=2; COMMIT",
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const idList = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Duplicate IDs are not allowed.",
  );
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
const invalid = (message, status = 400) =>
  Object.assign(new Error(message), { status, domain: true });

export function registerCodeRoutes(app, db, origin, analyticsSalt) {
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
    design: JSON.parse(row.design || "{}"),
    campaign: JSON.parse(row.campaign || "{}"),
  });
  const getCode = (id, workspaceId) =>
    db
      .prepare(
        "SELECT c.*,(SELECT COUNT(*) FROM scans WHERE code_id=c.id) AS scans FROM codes c WHERE c.id=? AND c.workspace_id=?",
      )
      .get(id, workspaceId);
  const ownedCodes = (ids, workspaceId) =>
    ids.map((id) => {
      const row = getCode(id, workspaceId);
      if (!row) throw invalid("QR code not found.", 404);
      return row;
    });
  const validate = async (body, workspaceId) => {
    const c = codeSchema.parse(body);
    const content = payload(c);
    if (c.type !== "links")
      QRCode.create(content, { errorCorrectionLevel: "H" });
    c.design = await normalizeDesign(c.design, c.color);
    if (
      c.folderId &&
      !db
        .prepare("SELECT id FROM folders WHERE id=? AND workspace_id=?")
        .get(c.folderId, workspaceId)
    )
      throw invalid("Folder not found.");
    if (
      c.campaign.startsAt &&
      c.campaign.expiresAt &&
      new Date(c.campaign.expiresAt) <= new Date(c.campaign.startsAt)
    )
      throw invalid("Enter an expiry time after the activation time.");
    if (
      !c.dynamic &&
      (c.campaign.startsAt ||
        c.campaign.expiresAt ||
        c.campaign.scanLimit ||
        c.campaign.utmSource ||
        c.campaign.utmMedium ||
        c.campaign.utmCampaign)
    )
      throw invalid("Only dynamic QR codes support campaign rules.");
    if (
      c.type !== "url" &&
      (c.campaign.utmSource || c.campaign.utmMedium || c.campaign.utmCampaign)
    )
      throw invalid("Only website codes support UTM tags.");
    return c;
  };
  const insert = (c, workspaceId, creatorId) => {
    const id = randomUUID(),
      slug = c.slug || randomBytes(8).toString("base64url");
    if (db.prepare("SELECT id FROM codes WHERE slug=?").get(slug))
      throw invalid("That short link is already taken. Choose another.", 409);
    db.prepare(
      "INSERT INTO codes (id,user_id,slug,name,type,dynamic,data,folder_id,color,active,created_at,design,campaign,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      creatorId,
      slug,
      c.name,
      c.type,
      +c.dynamic,
      JSON.stringify(c.data),
      c.folderId,
      c.color,
      +c.active,
      new Date().toISOString(),
      JSON.stringify(c.design),
      JSON.stringify(c.campaign),
      workspaceId,
    );
    return serialize(getCode(id, workspaceId));
  };
  app.get("/api/codes", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT c.*,(SELECT COUNT(*) FROM scans WHERE code_id=c.id) AS scans FROM codes c WHERE c.workspace_id=? ORDER BY c.created_at DESC,c.rowid DESC",
        )
        .all(req.workspace.id)
        .map(serialize),
    ),
  );
  app.post("/api/codes", async (req, res) => {
    const c = await validate(req.body, req.workspace.id);
    req.assertEdit();
    res.status(201).json(insert(c, req.workspace.id, req.user.id));
  });
  app.post("/api/codes/bulk", async (req, res) => {
    const input = z
      .object({
        codes: z
          .array(
            codeSchema.pick({
              name: true,
              type: true,
              data: true,
              dynamic: true,
              slug: true,
            }),
          )
          .min(1)
          .max(100),
        common: codeSchema
          .pick({ folderId: true, color: true, design: true, campaign: true })
          .partial()
          .default({}),
      })
      .parse(req.body);
    const codes = [];
    for (const [index, row] of input.codes.entries()) {
      try {
        codes.push(
          await validate({ ...input.common, ...row }, req.workspace.id),
        );
      } catch (e) {
        throw invalid(
          `Row ${index + 2}: ${e instanceof z.ZodError ? "Check the content fields." : e.message}`,
        );
      }
    }
    req.assertEdit();
    const result = transaction(db, () =>
      codes.map((c) => insert(c, req.workspace.id, req.user.id)),
    );
    res.status(201).json(result);
  });
  app.post("/api/codes/batch", (req, res) => {
    const input = z
      .object({
        ids: idList,
        action: z.enum(["pause", "resume", "move", "delete"]),
        folderId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const rows = ownedCodes(input.ids, req.workspace.id);
    if (
      input.action === "move" &&
      input.folderId &&
      !db
        .prepare("SELECT id FROM folders WHERE id=? AND workspace_id=?")
        .get(input.folderId, req.workspace.id)
    )
      throw invalid("Folder not found.");
    transaction(db, () => {
      for (const row of rows) {
        if (input.action === "delete")
          db.prepare("DELETE FROM codes WHERE id=?").run(row.id);
        else if (input.action === "move")
          db.prepare("UPDATE codes SET folder_id=? WHERE id=?").run(
            input.folderId || null,
            row.id,
          );
        else if (row.dynamic)
          db.prepare("UPDATE codes SET active=? WHERE id=?").run(
            +(input.action === "resume"),
            row.id,
          );
      }
    });
    res.json({
      ok: true,
      affected:
        input.action === "pause" || input.action === "resume"
          ? rows.filter((r) => r.dynamic).length
          : rows.length,
    });
  });
  app.post("/api/codes/export", async (req, res) => {
    const { ids, format, size } = z
      .object({
        ids: idList,
        format: z.enum(["png", "svg"]).default("svg"),
        size: z
          .union([z.literal(512), z.literal(1024), z.literal(2048)])
          .default(1024),
      })
      .parse(req.body);
    const codes = ownedCodes(ids, req.workspace.id).map(serialize),
      files = {};
    for (const c of codes)
      files[
        `${c.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "qr"}-${c.slug}.${format}`
      ] = new Uint8Array(
        await imageFor(
          c.dynamic ? c.shortUrl : payload(c),
          c.design,
          c.color,
          format,
          size,
        ),
      );
    files["manifest.json"] = strToU8(
      JSON.stringify(
        codes.map((c) => ({
          name: c.name,
          type: c.type,
          dynamic: c.dynamic,
          shortUrl: c.dynamic ? c.shortUrl : null,
        })),
        null,
        2,
      ),
    );
    req.assertRead();
    res
      .set("Content-Disposition", 'attachment; filename="openqr-codes.zip"')
      .type("application/zip")
      .send(Buffer.from(zipSync(files)));
  });
  app.post("/api/codes/:id/duplicate", (req, res) => {
    const row = getCode(req.params.id, req.workspace.id);
    if (!row) throw invalid("QR code not found.", 404);
    const copy = serialize(row);
    delete copy.slug;
    copy.name = `${copy.name.slice(0, 93)} (copy)`;
    res.status(201).json(insert(copy, req.workspace.id, req.user.id));
  });
  app.put("/api/codes/:id", async (req, res) => {
    const old = getCode(req.params.id, req.workspace.id);
    if (!old) throw invalid("QR code not found.", 404);
    const c = await validate(req.body, req.workspace.id);
    if (c.type !== old.type || +c.dynamic !== old.dynamic)
      throw invalid("Code type cannot change after creation.");
    if (c.slug && c.slug !== old.slug)
      throw invalid(
        "The short link is permanent. Create a new code to use a different one.",
      );
    if (!old.dynamic && payload(c) !== payload(serialize(old)))
      throw invalid("Static QR content cannot be edited. Create a new code.");
    req.assertEdit();
    db.prepare(
      "UPDATE codes SET name=?,data=?,folder_id=?,color=?,active=?,design=?,campaign=? WHERE id=? AND workspace_id=?",
    ).run(
      c.name,
      JSON.stringify(c.data),
      c.folderId,
      c.color,
      +c.active,
      JSON.stringify(c.design),
      JSON.stringify(c.campaign),
      old.id,
      req.workspace.id,
    );
    res.json(serialize(getCode(old.id, req.workspace.id)));
  });
  app.delete("/api/codes/:id", (req, res) => {
    if (!getCode(req.params.id, req.workspace.id))
      throw invalid("QR code not found.", 404);
    db.prepare("DELETE FROM codes WHERE id=? AND workspace_id=?").run(
      req.params.id,
      req.workspace.id,
    );
    res.json({ ok: true });
  });
  app.get("/api/codes/:id/download", async (req, res) => {
    const row = getCode(req.params.id, req.workspace.id);
    if (!row) throw invalid("QR code not found.", 404);
    const c = serialize(row),
      format = req.query.format === "svg" ? "svg" : "png",
      size = [512, 1024, 2048].includes(Number(req.query.size))
        ? Number(req.query.size)
        : 1024;
    const bytes = await imageFor(
      c.dynamic ? c.shortUrl : payload(c),
      c.design,
      c.color,
      format,
      size,
    );
    req.assertRead();
    res
      .set(
        "Content-Disposition",
        `attachment; filename="openqr-${c.slug}.${format}"`,
      )
      .type(format === "svg" ? "image/svg+xml" : "image/png")
      .send(bytes);
  });
  app.get("/api/templates", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,color,design FROM templates WHERE workspace_id=? ORDER BY name",
        )
        .all(req.workspace.id)
        .map((t) => ({ ...t, design: JSON.parse(t.design) })),
    ),
  );
  app.post("/api/templates", async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(60),
        color: codeSchema.shape.color,
        design: codeSchema.shape.design,
      })
      .parse(req.body);
    const design = await normalizeDesign(input.design, input.color);
    if (
      db
        .prepare("SELECT id FROM templates WHERE workspace_id=? AND name=?")
        .get(req.workspace.id, input.name)
    )
      throw invalid("A design with that name already exists.", 409);
    req.assertEdit();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO templates (id,user_id,name,color,design,workspace_id) VALUES (?,?,?,?,?,?)",
    ).run(
      id,
      req.user.id,
      input.name,
      input.color,
      JSON.stringify(design),
      req.workspace.id,
    );
    res.status(201).json({ id, name: input.name, color: input.color, design });
  });
  app.delete("/api/templates/:id", (req, res) => {
    db.prepare("DELETE FROM templates WHERE id=? AND workspace_id=?").run(
      req.params.id,
      req.workspace.id,
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
    const where =
      "FROM scans s JOIN codes c ON c.id=s.code_id WHERE c.workspace_id=? AND s.scanned_at>=? AND (? IS NULL OR c.id=?)";
    const params = [req.workspace.id, since.toISOString(), codeId, codeId];
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,COUNT(DISTINCT s.visitor) AS uniqueDailyVisitors ${where}`,
      )
      .get(...params);
    const buckets = db
      .prepare(
        `SELECT substr(s.scanned_at,1,10) AS date,COUNT(*) AS scans ${where} GROUP BY date`,
      )
      .all(...params);
    const daily = Array.from({ length: days }, (_, i) => {
      const date = new Date(since.getTime() + i * 86400000)
        .toISOString()
        .slice(0, 10);
      return { date, scans: buckets.find((b) => b.date === date)?.scans || 0 };
    });
    const breakdown = (column) =>
      Object.fromEntries(
        db
          .prepare(
            `SELECT s.${column} AS name,COUNT(*) AS scans ${where} GROUP BY s.${column} ORDER BY scans DESC LIMIT 15`,
          )
          .all(...params)
          .map((r) => [r.name, r.scans]),
      );
    const topCodes = db
      .prepare(
        `SELECT c.id,c.name,COUNT(*) AS scans ${where} GROUP BY c.id ORDER BY scans DESC LIMIT 8`,
      )
      .all(...params);
    res.json({
      ...totals,
      days,
      daily,
      devices: { Mobile: 0, Desktop: 0, Tablet: 0, ...breakdown("device") },
      browsers: breakdown("browser"),
      operatingSystems: breakdown("os"),
      referrers: breakdown("referrer"),
      topCodes,
    });
  });
  app.get("/r/:slug", (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    const result = transaction(db, () => {
      const row = db
        .prepare(
          "SELECT c.*,(SELECT COUNT(*) FROM scans WHERE code_id=c.id) AS scans FROM codes c WHERE c.slug=? AND c.dynamic=1",
        )
        .get(req.params.slug);
      if (!row)
        return { status: 404, message: "This QR code could not be found." };
      const c = serialize(row),
        now = new Date().toISOString();
      if (!c.active)
        return { status: 410, message: "This QR code is currently paused." };
      if (
        c.campaign.startsAt &&
        now < new Date(c.campaign.startsAt).toISOString()
      )
        return {
          status: 423,
          message: "This campaign has not started yet. Please try again later.",
        };
      if (
        c.campaign.expiresAt &&
        now >= new Date(c.campaign.expiresAt).toISOString()
      )
        return { status: 410, message: "This campaign has ended." };
      if (c.campaign.scanLimit && row.scans >= c.campaign.scanLimit)
        return {
          status: 410,
          message: "This campaign has reached its scan limit.",
        };
      if (req.method === "GET") {
        const ua = req.get("user-agent") || "";
        const device = /iPad|Tablet/i.test(ua)
          ? "Tablet"
          : /Mobile|Android|iPhone/i.test(ua)
            ? "Mobile"
            : "Desktop";
        const browser = /Edg\//i.test(ua)
          ? "Edge"
          : /OPR\//i.test(ua)
            ? "Opera"
            : /Firefox|FxiOS/i.test(ua)
              ? "Firefox"
              : /Chrome|CriOS/i.test(ua)
                ? "Chrome"
                : /Safari/i.test(ua)
                  ? "Safari"
                  : "Other";
        const os = /iPhone|iPad|iPod/i.test(ua)
          ? "iOS"
          : /Android/i.test(ua)
            ? "Android"
            : /Windows/i.test(ua)
              ? "Windows"
              : /Macintosh|Mac OS/i.test(ua)
                ? "macOS"
                : /Linux/i.test(ua)
                  ? "Linux"
                  : "Other";
        let referrer = "Direct";
        try {
          referrer = new URL(req.get("referer")).hostname.slice(0, 253);
        } catch {
          /* Scanners usually have no referrer. */
        }
        const visitor = createHash("sha256")
          .update(`${analyticsSalt}|${now.slice(0, 10)}|${req.ip}|${ua}`)
          .digest("hex");
        db.prepare(
          "INSERT INTO scans (code_id,scanned_at,visitor,device,browser,os,referrer) VALUES (?,?,?,?,?,?,?)",
        ).run(c.id, now, visitor, device, browser, os, referrer);
      }
      return { code: c };
    });
    if (result.status)
      return res
        .status(result.status)
        .type("html")
        .send(unavailablePage(result.message));
    if (result.code.type === "links")
      return res.type("html").send(linksPage(result.code));
    res.redirect(302, destination(result.code));
  });
}
