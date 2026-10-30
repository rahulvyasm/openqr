import { randomBytes, randomUUID, createHash } from "node:crypto";
import { audit } from "./security.js";
import { z } from "zod";
import QRCode from "qrcode";
import { zipSync, strToU8 } from "fflate";
import { codeSchema, payload, destination } from "./payload.js";
import { normalizeDesign, imageFor } from "./design.js";
import { linksPage, hostedPage, unavailablePage } from "./pages.js";
import { hostedTypes } from "./publishing.js";
import { renderExperience, parseBlocks } from "./experience-blocks.js";
import { referencedAssets, validateAssetReferences } from "./storage.js";
import {
  availability,
  publicTicket,
  validPublicTicket,
} from "./public-access.js";
import { contactCard } from "../shared/contact.js";
import { calendarEvent } from "../shared/calendar.js";
import { appDestination } from "../shared/app-routing.js";

export function migrateCodes(db) {
  if (db.prepare("PRAGMA user_version").get().user_version > 5)
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

export function registerCodeRoutes(
  app,
  db,
  origin,
  analyticsSalt,
  storage,
  entitlements,
) {
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
    pageOptions: JSON.parse(row.page_options || "{}"),
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
  const insert = (c, workspaceId, creatorId, sourceId) => {
    entitlements?.assertCodeCreate(workspaceId);
    validateAssetReferences(db, c.data, workspaceId, c.type);
    const id = randomUUID(),
      slug = c.slug || randomBytes(8).toString("base64url");
    if (db.prepare("SELECT id FROM codes WHERE slug=?").get(slug))
      throw invalid("That short link is already taken. Choose another.", 409);
    db.prepare(
      "INSERT INTO codes (id,user_id,slug,name,type,dynamic,data,folder_id,color,active,created_at,design,campaign,workspace_id,page_options) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      JSON.stringify(c.pageOptions || {}),
    );
    audit(
      db,
      workspaceId,
      creatorId,
      sourceId ? "code.duplicated" : "code.created",
      id,
      {
        name: c.name,
        type: c.type,
        dynamic: c.dynamic,
        ...(sourceId ? { sourceId } : {}),
      },
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
    const result = await storage.exclusive(() => {
      req.assertEdit();
      return transaction(db, () => insert(c, req.workspace.id, req.user.id));
    });
    res.status(201).json(result);
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
    const result = await storage.exclusive(() => {
      req.assertEdit();
      return transaction(db, () =>
        codes.map((c) => insert(c, req.workspace.id, req.user.id)),
      );
    });
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
        if (["delete", "move"].includes(input.action) || row.dynamic)
          audit(
            db,
            req.workspace.id,
            req.user.id,
            {
              delete: "code.deleted",
              move: "code.moved",
              pause: "code.paused",
              resume: "code.resumed",
            }[input.action],
            row.id,
            {
              name: row.name,
              ...(input.action === "move"
                ? { folderId: input.folderId || null }
                : {}),
            },
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
  app.post("/api/codes/:id/duplicate", async (req, res) => {
    const row = getCode(req.params.id, req.workspace.id);
    if (!row) throw invalid("QR code not found.", 404);
    const copy = serialize(row);
    delete copy.slug;
    copy.name = `${copy.name.slice(0, 93)} (copy)`;
    const result = await storage.exclusive(() => {
      req.assertEdit();
      return transaction(db, () =>
        insert(copy, req.workspace.id, req.user.id, row.id),
      );
    });
    res.status(201).json(result);
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
    await storage.exclusive(() =>
      transaction(db, () => {
        req.assertEdit();
        if (!getCode(old.id, req.workspace.id))
          throw invalid("QR code not found.", 404);
        // Page content has its own draft and publish flow in Experience Studio.
        if (old.type === "experience") {
          const live = JSON.parse(old.data);
          c.data = {
            ...c.data,
            title: live.title,
            blocks: live.blocks,
            alertEmails: live.alertEmails || "",
          };
        }
        validateAssetReferences(db, c.data, req.workspace.id, c.type);
        db.prepare(
          "UPDATE codes SET name=?,data=?,folder_id=?,color=?,active=?,design=?,campaign=?,page_options=? WHERE id=? AND workspace_id=?",
        ).run(
          c.name,
          JSON.stringify(c.data),
          c.folderId,
          c.color,
          +c.active,
          JSON.stringify(c.design),
          JSON.stringify(c.campaign),
          JSON.stringify(c.pageOptions),
          old.id,
          req.workspace.id,
        );
        audit(
          db,
          req.workspace.id,
          req.user.id,
          +c.active !== old.active && old.dynamic
            ? c.active
              ? "code.resumed"
              : "code.paused"
            : "code.updated",
          old.id,
          { name: c.name, type: c.type },
        );
      }),
    );
    res.json(serialize(getCode(old.id, req.workspace.id)));
  });
  app.delete("/api/codes/:id", (req, res) => {
    const row = getCode(req.params.id, req.workspace.id);
    if (!row) throw invalid("QR code not found.", 404);
    transaction(db, () => {
      db.prepare("DELETE FROM codes WHERE id=? AND workspace_id=?").run(
        req.params.id,
        req.workspace.id,
      );
      audit(db, req.workspace.id, req.user.id, "code.deleted", row.id, {
        name: row.name,
      });
    });
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
      const blocked = availability(c);
      if (blocked) return blocked;
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
    if (result.code.type === "experience") {
      const c = result.code,
        ticket = publicTicket(c.id, analyticsSalt, 25),
        mediaUrl = (id) =>
          `/r/${encodeURIComponent(c.slug)}/media/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`;
      return res.type("html").send(
        renderExperience(
          {
            title: c.data.title || c.name,
            blocks: parseBlocks(c.data),
            slug: c.slug,
            pageOptions: c.pageOptions,
            ticket,
          },
          { mediaUrl },
        ),
      );
    }
    if (hostedTypes.includes(result.code.type)) {
      const c = result.code,
        ticket = publicTicket(
          c.id,
          analyticsSalt,
          ["audio", "video"].includes(c.type) ? 25 * 60 : 15,
        );
      if (c.type === "app" && c.data.routing === "smart")
        return res.redirect(
          302,
          appDestination(c.data, req.get("user-agent") || ""),
        );
      if (c.type === "pdf" && c.data.direct === "true")
        return res.redirect(
          302,
          `/view/${encodeURIComponent(c.slug)}/${encodeURIComponent(c.data.pdfId)}?ticket=${encodeURIComponent(ticket)}`,
        );
      const assets = referencedAssets(c.data)
        .map((id) =>
          db
            .prepare("SELECT * FROM assets WHERE id=? AND workspace_id=?")
            .get(id, rowWorkspace(c.id)),
        )
        .filter(Boolean);
      return res.type("html").send(hostedPage(c, assets, ticket));
    }
    res.redirect(302, destination(result.code));
  });
  function rowWorkspace(id) {
    return db.prepare("SELECT workspace_id FROM codes WHERE id=?").get(id)
      .workspace_id;
  }
  function publicCode(req) {
    const row = db
      .prepare(
        "SELECT c.*,(SELECT COUNT(*) FROM scans WHERE code_id=c.id) AS scans FROM codes c WHERE c.slug=? AND c.dynamic=1",
      )
      .get(req.params.slug);
    if (!row) throw invalid("QR page not found.", 404);
    const code = serialize(row);
    if (!validPublicTicket(req.query.ticket, code.id, analyticsSalt))
      throw invalid("Open this QR page again to access its files.", 403);
    const blocked = availability(code, { ignoreCap: true });
    if (blocked) throw invalid(blocked.message, blocked.status);
    return { code, workspaceId: row.workspace_id };
  }
  app.get("/r/:slug/media/:id", (req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    });
    const { code, workspaceId } = publicCode(req);
    if (
      !hostedTypes.includes(code.type) ||
      !referencedAssets(code.data).includes(req.params.id)
    )
      throw invalid("File not found.", 404);
    const asset = db
      .prepare("SELECT * FROM assets WHERE id=? AND workspace_id=?")
      .get(req.params.id, workspaceId);
    if (!asset) throw invalid("File not found.", 404);
    res.type(asset.mime).set("X-Content-Type-Options", "nosniff");
    if (asset.kind === "pdf") {
      res.attachment(asset.name.replace(/\.[^.]+$/, "") + ".pdf");
      if (req.query.inline === "1")
        res.set(
          "Content-Disposition",
          res.get("Content-Disposition").replace(/^attachment/, "inline"),
        );
      res.set("Content-Security-Policy", "sandbox; default-src 'none'");
    }
    if (req.query.download === "1") {
      if (
        code.data.allowDownload !== "true" ||
        !["audio", "video", "gallery"].includes(code.type)
      )
        throw invalid("Downloads are not enabled for this page.", 403);
      res.attachment(
        asset.name.replace(/\.[^.]+$/, "") +
          "." +
          asset.storage_key.split(".").at(-1),
      );
      res.type(asset.mime);
    }
    storage.serve(asset.storage_key, req, res, next);
  });
  app.get("/r/:slug/contact.vcf", (req, res) => {
    const { code } = publicCode(req);
    if (code.type !== "contact") throw invalid("Contact not found.", 404);
    res
      .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" })
      .attachment("contact.vcf")
      .type("text/vcard")
      .send(contactCard(code.data));
  });
  app.get("/r/:slug/document/:id", (req, res) => {
    const { code, workspaceId } = publicCode(req);
    if (code.type !== "pdf" || code.data.pdfId !== req.params.id)
      throw invalid("Document not found.", 404);
    const asset = db
      .prepare(
        "SELECT name,pages FROM assets WHERE id=? AND workspace_id=? AND kind='pdf'",
      )
      .get(req.params.id, workspaceId);
    if (!asset) throw invalid("Document not found.", 404);
    res
      .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" })
      .json({
        title: code.data.title,
        name: asset.name,
        pages: asset.pages,
        downloadUrl: `/r/${encodeURIComponent(code.slug)}/media/${encodeURIComponent(req.params.id)}?ticket=${encodeURIComponent(req.query.ticket)}`,
      });
  });
  app.get("/r/:slug/event.ics", (req, res) => {
    const { code } = publicCode(req);
    if (code.type !== "hosted-event") throw invalid("Event not found.", 404);
    res
      .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" })
      .attachment("event.ics")
      .type("text/calendar")
      .send(
        calendarEvent(
          {
            ...code.data,
            location: [code.data.venue, code.data.address]
              .filter(Boolean)
              .join(", "),
          },
          code.id,
        ),
      );
  });
  app.get("/api/page-templates", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM page_templates WHERE workspace_id=? ORDER BY name",
        )
        .all(req.workspace.id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          data: JSON.parse(row.data),
          pageOptions: JSON.parse(row.page_options),
        })),
    ),
  );
  app.post("/api/page-templates", async (req, res) => {
    const c = await validate({ ...req.body, dynamic: true }, req.workspace.id);
    if (!hostedTypes.includes(c.type) || c.type === "links")
      throw invalid("Choose a supported publishing page type.");
    const id = randomUUID();
    await storage.exclusive(() => {
      req.assertEdit();
      validateAssetReferences(db, c.data, req.workspace.id, c.type);
      if (
        db
          .prepare(
            "SELECT 1 FROM page_templates WHERE workspace_id=? AND name=?",
          )
          .get(req.workspace.id, c.name)
      )
        throw invalid("A page template with that name already exists.", 409);
      db.prepare("INSERT INTO page_templates VALUES (?,?,?,?,?,?,?)").run(
        id,
        req.workspace.id,
        req.user.id,
        c.name,
        c.type,
        JSON.stringify(c.data),
        JSON.stringify(c.pageOptions),
      );
    });
    res.status(201).json({ id });
  });
  app.delete("/api/page-templates/:id", (req, res) => {
    db.prepare("DELETE FROM page_templates WHERE id=? AND workspace_id=?").run(
      req.params.id,
      req.workspace.id,
    );
    res.json({ ok: true });
  });
}
