import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit, problem } from "./security.js";
import {
  assertBlockAssets,
  blockSchema,
  experienceSchema,
  formAnswers,
  parseBlocks,
  renderExperience,
  safeAction,
  templates,
  validateExperienceBlocks,
} from "./experience-blocks.js";
import { availability, publicTicket, validPublicTicket } from "./public-access.js";

const MAX_JSON = 18000;
const KEEP_VERSIONS = 50;
const RETENTION_DAYS = 365;
const INBOX_LIMIT = 10000;

export function migrateExperiences(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experience_drafts (code_id TEXT PRIMARY KEY REFERENCES codes(id) ON DELETE CASCADE, title TEXT NOT NULL, blocks TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
    CREATE TABLE IF NOT EXISTS experience_versions (id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE, version INTEGER NOT NULL, title TEXT NOT NULL, blocks TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT, UNIQUE(code_id,version));
    CREATE TABLE IF NOT EXISTS experience_submissions (id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE, block_id TEXT NOT NULL, form_title TEXT NOT NULL, answers TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
    CREATE INDEX IF NOT EXISTS experience_submissions_code ON experience_submissions(code_id, created_at);
    CREATE TABLE IF NOT EXISTS experience_events (id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE, block_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS experience_events_code ON experience_events(code_id, created_at);
  `);
}

const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function registerExperienceRoutes(app, db, origin, analyticsSalt) {
  const owned = (req) => {
    const row = db
      .prepare(
        "SELECT * FROM codes WHERE id=? AND workspace_id=? AND type='experience'",
      )
      .get(req.params.id, req.workspace.id);
    if (!row) throw problem("Experience not found.", 404);
    return row;
  };
  const live = (row) => {
    const data = JSON.parse(row.data);
    return { title: data.title || row.name, blocks: parseBlocks(data) };
  };
  // Drafts may be unfinished; only publishing needs complete blocks.
  const draftSchema = z.object({
    title: z.string().trim().max(100),
    blocks: z
      .array(
        z.object({ id: z.string().max(20), type: z.string().max(20) }).loose(),
      )
      .max(30),
  });
  const looseDraft = (body) => {
    const input = draftSchema.safeParse(body);
    if (!input.success) throw problem("This draft could not be saved.");
    if (JSON.stringify(input.data.blocks).length > MAX_JSON)
      throw problem("This page is too large. Remove a few blocks or shorten the text.");
    return input.data;
  };
  const clean = (body, workspaceId) => {
    const input = experienceSchema.safeParse(body);
    if (!input.success) {
      const index = input.error.issues.find((i) => i.path[0] === "blocks")?.path[1];
      throw problem(
        typeof index === "number"
          ? `Block ${index + 1} is not finished. Fill in its required details.`
          : "Add a page title before publishing.",
      );
    }
    const blocks = validateExperienceBlocks(input.data.blocks);
    if (JSON.stringify(blocks).length > MAX_JSON)
      throw problem("This page is too large. Remove a few blocks or shorten the text.");
    assertBlockAssets(db, blocks, workspaceId);
    return { title: input.data.title, blocks };
  };
  const mediaFor = (assetId) => `/api/assets/${encodeURIComponent(assetId)}/content`;
  const pageOptions = (row) => JSON.parse(row.page_options || "{}");

  app.get("/api/experience/templates", (_req, res) => res.json(templates()));
  app.post("/api/experience/preview", (req, res) => {
    const input = z
      .object({
        title: z.string().trim().max(100).default("Preview"),
        blocks: z.array(z.any()).max(30),
        pageOptions: z.record(z.string(), z.any()).default({}),
      })
      .parse(req.body);
    // Half-edited blocks are skipped so the preview keeps working while typing.
    const blocks = input.blocks
      .map((block) => blockSchema.safeParse(block))
      .filter((result) => result.success)
      .map((result) => result.data);
    res.type("html").send(
      renderExperience(
        {
          title: input.title || "Preview",
          blocks,
          slug: "preview",
          pageOptions: input.pageOptions,
          ticket: "preview",
        },
        { mediaUrl: mediaFor, preview: true },
      ),
    );
  });

  app.get("/api/codes/:id/experience/draft", (req, res) => {
    const row = owned(req),
      draft = db
        .prepare("SELECT * FROM experience_drafts WHERE code_id=?")
        .get(row.id);
    const base = draft
      ? { title: draft.title, blocks: JSON.parse(draft.blocks) }
      : live(row);
    res.json({ ...base, dirty: !!draft, updatedAt: draft?.updated_at ?? null });
  });
  app.put("/api/codes/:id/experience/draft", (req, res) => {
    const row = owned(req),
      { title, blocks } = looseDraft(req.body);
    db.prepare(
      "INSERT INTO experience_drafts (code_id,title,blocks,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(code_id) DO UPDATE SET title=excluded.title,blocks=excluded.blocks,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
    ).run(row.id, title, JSON.stringify(blocks), new Date().toISOString(), req.user.id);
    res.json({ ok: true });
  });
  app.delete("/api/codes/:id/experience/draft", (req, res) => {
    const row = owned(req);
    db.prepare("DELETE FROM experience_drafts WHERE code_id=?").run(row.id);
    res.json({ ok: true });
  });

  app.post("/api/codes/:id/experience/publish", (req, res) => {
    const row = owned(req),
      note = z.string().trim().max(120).default("").parse(req.body?.note ?? "");
    const draft = db
      .prepare("SELECT * FROM experience_drafts WHERE code_id=?")
      .get(row.id);
    if (!draft) throw problem("There are no unpublished changes.");
    const next = clean(
      { title: draft.title, blocks: JSON.parse(draft.blocks) },
      req.workspace.id,
    );
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const count = db
        .prepare("SELECT COUNT(*) n FROM experience_versions WHERE code_id=?")
        .get(row.id).n;
      if (!count) {
        const before = live(row);
        db.prepare(
          "INSERT INTO experience_versions (code_id,version,title,blocks,note,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
        ).run(row.id, 1, before.title, JSON.stringify(before.blocks), "Original", row.created_at, null);
      }
      const version =
        db
          .prepare("SELECT MAX(version) v FROM experience_versions WHERE code_id=?")
          .get(row.id).v + 1;
      db.prepare(
        "INSERT INTO experience_versions (code_id,version,title,blocks,note,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
      ).run(row.id, version, next.title, JSON.stringify(next.blocks), note, now, req.user.id);
      db.prepare(
        "DELETE FROM experience_versions WHERE code_id=? AND version<=?",
      ).run(row.id, version - KEEP_VERSIONS);
      const data = {
        ...JSON.parse(row.data),
        title: next.title,
        blocks: JSON.stringify(next.blocks),
      };
      db.prepare("UPDATE codes SET data=? WHERE id=?").run(JSON.stringify(data), row.id);
      db.prepare("DELETE FROM experience_drafts WHERE code_id=?").run(row.id);
      audit(db, req.workspace.id, req.user.id, "experience.published", row.id, {
        name: row.name,
        version,
      });
      db.exec("COMMIT");
      res.json({ ok: true, version });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.get("/api/codes/:id/experience/versions", (req, res) => {
    const row = owned(req);
    res.json(
      db
        .prepare(
          "SELECT v.version,v.title,v.note,v.created_at,u.name AS author FROM experience_versions v LEFT JOIN users u ON u.id=v.created_by WHERE v.code_id=? ORDER BY v.version DESC",
        )
        .all(row.id)
        .map((v) => ({
          version: v.version,
          title: v.title,
          note: v.note,
          createdAt: v.created_at,
          author: v.author,
        })),
    );
  });
  app.post("/api/codes/:id/experience/versions/:version/restore", (req, res) => {
    const row = owned(req),
      v = db
        .prepare("SELECT * FROM experience_versions WHERE code_id=? AND version=?")
        .get(row.id, Number(req.params.version));
    if (!v) throw problem("Version not found.", 404);
    const restored = looseDraft({
      title: v.title,
      blocks: JSON.parse(v.blocks),
    });
    db.prepare(
      "INSERT INTO experience_drafts (code_id,title,blocks,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(code_id) DO UPDATE SET title=excluded.title,blocks=excluded.blocks,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
    ).run(row.id, restored.title, JSON.stringify(restored.blocks), new Date().toISOString(), req.user.id);
    audit(db, req.workspace.id, req.user.id, "experience.restored", row.id, {
      name: row.name,
      version: v.version,
    });
    res.json({ ...restored, dirty: true });
  });

  app.get("/api/codes/:id/experience/stats", (req, res) => {
    const row = owned(req),
      { blocks } = live(row),
      scans = db
        .prepare("SELECT COUNT(*) n FROM scans WHERE code_id=?")
        .get(row.id).n,
      submissions = db
        .prepare("SELECT COUNT(*) n FROM experience_submissions WHERE code_id=?")
        .get(row.id).n,
      taps = db
        .prepare("SELECT COUNT(*) n FROM experience_events WHERE code_id=?")
        .get(row.id).n;
    const perBlock = new Map();
    for (const e of db
      .prepare(
        "SELECT block_id,label,COUNT(*) n FROM experience_events WHERE code_id=? GROUP BY block_id,label",
      )
      .all(row.id))
      perBlock.set(`${e.block_id}|${e.label}`, { kind: "tap", ...e });
    const actions = [
      ...[...perBlock.values()].map((e) => ({
        blockId: e.block_id,
        label: e.label,
        kind: "tap",
        count: e.n,
      })),
      ...db
        .prepare(
          "SELECT block_id,form_title,COUNT(*) n FROM experience_submissions WHERE code_id=? GROUP BY block_id,form_title",
        )
        .all(row.id)
        .map((e) => ({
          blockId: e.block_id,
          label: e.form_title,
          kind: "submit",
          count: e.n,
        })),
    ].sort((a, b) => b.count - a.count);
    res.json({
      scans,
      submissions,
      taps,
      actions,
      conversion: scans ? Math.min(1, (submissions + taps) / scans) : 0,
      blocks: blocks.length,
    });
  });

  const submissionRow = (s) => ({
    id: s.id,
    blockId: s.block_id,
    form: s.form_title,
    answers: JSON.parse(s.answers),
    createdAt: s.created_at,
    read: !!s.read_at,
  });
  app.get("/api/codes/:id/experience/submissions", (req, res) => {
    const row = owned(req);
    res.json(
      db
        .prepare(
          "SELECT * FROM experience_submissions WHERE code_id=? ORDER BY id DESC LIMIT 500",
        )
        .all(row.id)
        .map(submissionRow),
    );
  });
  app.get("/api/codes/:id/experience/submissions.csv", (req, res) => {
    const row = owned(req),
      rows = db
        .prepare("SELECT * FROM experience_submissions WHERE code_id=? ORDER BY id")
        .all(row.id)
        .map(submissionRow);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.answers)))];
    const lines = [
      ["Received", "Form", ...keys].map(csvCell).join(","),
      ...rows.map((r) =>
        [r.createdAt, r.form, ...keys.map((k) => r.answers[k] ?? "")]
          .map(csvCell)
          .join(","),
      ),
    ];
    res
      .type("text/csv")
      .attachment("responses.csv")
      .send(lines.join("\r\n"));
  });
  app.post("/api/codes/:id/experience/submissions/read", (req, res) => {
    const row = owned(req);
    db.prepare(
      "UPDATE experience_submissions SET read_at=? WHERE code_id=? AND read_at IS NULL",
    ).run(new Date().toISOString(), row.id);
    res.json({ ok: true });
  });
  app.delete("/api/codes/:id/experience/submissions/:sid", (req, res) => {
    const row = owned(req);
    db.prepare(
      "DELETE FROM experience_submissions WHERE id=? AND code_id=?",
    ).run(Number(req.params.sid), row.id);
    res.json({ ok: true });
  });
  app.get("/api/experience/unread", (req, res) =>
    res.json({
      unread: db
        .prepare(
          "SELECT COUNT(*) n FROM experience_submissions s JOIN codes c ON c.id=s.code_id WHERE c.workspace_id=? AND s.read_at IS NULL",
        )
        .get(req.workspace.id).n,
      byCode: Object.fromEntries(
        db
          .prepare(
            "SELECT s.code_id,COUNT(*) n FROM experience_submissions s JOIN codes c ON c.id=s.code_id WHERE c.workspace_id=? AND s.read_at IS NULL GROUP BY s.code_id",
          )
          .all(req.workspace.id)
          .map((r) => [r.code_id, r.n]),
      ),
    }),
  );

  // Public side. Everything needs the ticket issued when the page was opened.
  const publicExperience = (req, source) => {
    const row = db
      .prepare(
        "SELECT * FROM codes WHERE slug=? AND dynamic=1 AND type='experience'",
      )
      .get(req.params.slug);
    if (!row) throw problem("This QR code could not be found.", 404);
    const code = {
      id: row.id,
      active: !!row.active,
      campaign: JSON.parse(row.campaign || "{}"),
      scans: 0,
    };
    if (!validPublicTicket(source.ticket, row.id, analyticsSalt))
      throw problem("Open this page again from its QR code.", 403);
    const blocked = availability(code, { ignoreCap: true });
    if (blocked) throw problem(blocked.message, blocked.status);
    return row;
  };
  app.get("/r/:slug/go/:block", (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    const row = publicExperience(req, req.query),
      block = parseBlocks(JSON.parse(row.data)).find((b) => b.id === req.params.block);
    const index = Number(req.query.i) || 0;
    const target =
      block?.type === "button"
        ? { label: block.label, url: block.url }
        : block?.type === "links"
          ? block.items[index]
          : null;
    const url = target && safeAction(target.url);
    if (!url) throw problem("This link is not available.", 404);
    db.prepare(
      "INSERT INTO experience_events (code_id,block_id,label,created_at) VALUES (?,?,?,?)",
    ).run(row.id, block.id, target.label, new Date().toISOString());
    res.redirect(302, url);
  });
  const submitLimit = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .type("html")
        .send("<p>Too many submissions. Please try again in a few minutes.</p>"),
  });
  app.post(
    "/r/:slug/submit/:block",
    submitLimit,
    express.urlencoded({ extended: false, limit: "24kb" }),
    (req, res) => {
      res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
      const input = req.body || {};
      const row = publicExperience(req, input),
        data = JSON.parse(row.data),
        blocks = parseBlocks(data),
        block = blocks.find((b) => b.id === req.params.block && b.type === "form");
      if (!block) throw problem("This form is not available.", 404);
      const ticket = publicTicket(row.id, analyticsSalt, 25);
      const page = (extra) =>
        res.type("html").send(
          renderExperience(
            {
              title: data.title || row.name,
              blocks,
              slug: row.slug,
              pageOptions: pageOptions(row),
              ticket,
            },
            {
              mediaUrl: (id) =>
                `/r/${encodeURIComponent(row.slug)}/media/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`,
              ...extra,
            },
          ),
        );
      // A filled honeypot looks like success so scripts get no signal.
      if (input.website) return page({ sent: block.id });
      const result = formAnswers(block, input);
      if (result.error)
        return page({
          error: { block: block.id, message: result.error },
          values: input,
        });
      if (!Object.keys(result.answers).length)
        return page({
          error: { block: block.id, message: "Please fill in the form." },
          values: input,
        });
      const total = db
        .prepare("SELECT COUNT(*) n FROM experience_submissions WHERE code_id=?")
        .get(row.id).n;
      if (total >= INBOX_LIMIT)
        return page({
          error: {
            block: block.id,
            message: "This form is not accepting responses right now.",
          },
        });
      const now = new Date();
      db.prepare(
        "INSERT INTO experience_submissions (code_id,block_id,form_title,answers,created_at) VALUES (?,?,?,?,?)",
      ).run(row.id, block.id, block.title, JSON.stringify(result.answers), now.toISOString());
      // Responses are personal data, so they expire on their own.
      db.prepare(
        "DELETE FROM experience_submissions WHERE code_id=? AND created_at<?",
      ).run(
        row.id,
        new Date(now - RETENTION_DAYS * 86400000).toISOString(),
      );
      page({ sent: block.id });
    },
  );
}
