import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, problem } from "./security.js";

/*
 * Item pages: one experience is the template, and every physical item (a product, an
 * asset, a room) gets its own code and short link. An item stores only what is its
 * own (name, serial, warranty, service history); blocks, design and settings come
 * from the template, so editing the template updates every printed item at once.
 */
export function migrateItems(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experience_service (id INTEGER PRIMARY KEY, code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE, service_date TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS experience_service_code ON experience_service(code_id, service_date);
  `);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(+new Date(`${value}T00:00:00Z`)),
  "Enter a valid date.",
);
const itemInput = z.object({
  name: z.string().trim().min(1).max(100),
  serial: z.string().trim().max(80).default(""),
  warrantyUntil: z.union([date, z.literal("")]).default(""),
});

export const itemOf = (data) => data.itemOf || "";

// The page a visitor sees: the template's content with this item's own details.
export function resolveExperience(db, row) {
  const own = JSON.parse(row.data);
  if (!itemOf(own))
    return { data: own, pageOptions: JSON.parse(row.page_options || "{}"), item: null, template: row };
  const template = db
    .prepare(
      "SELECT * FROM codes WHERE id=? AND workspace_id=? AND type='experience'",
    )
    .get(own.itemOf, row.workspace_id);
  if (!template || itemOf(JSON.parse(template.data))) return null;
  const parent = JSON.parse(template.data);
  return {
    data: {
      ...parent,
      title: own.title || row.name,
      itemOf: own.itemOf,
    },
    pageOptions: JSON.parse(template.page_options || "{}"),
    item: {
      name: own.title || row.name,
      serial: own.serial || "",
      warrantyUntil: own.warrantyUntil || "",
      history: db
        .prepare(
          "SELECT service_date date,note FROM experience_service WHERE code_id=? ORDER BY service_date DESC,id DESC LIMIT 50",
        )
        .all(row.id),
    },
    template,
  };
}

// The template and all of its items, so results and responses add up.
export function family(db, row) {
  return [
    row.id,
    ...db
      .prepare(
        "SELECT id FROM codes WHERE workspace_id=? AND type='experience' AND json_extract(data,'$.itemOf')=?",
      )
      .all(row.workspace_id, row.id)
      .map((r) => r.id),
  ];
}

export function registerItemRoutes(app, db, origin, entitlements) {
  const template = (req) => {
    const row = db
      .prepare(
        "SELECT * FROM codes WHERE id=? AND workspace_id=? AND type='experience'",
      )
      .get(req.params.id, req.workspace.id);
    if (!row) throw problem("Experience not found.", 404);
    if (itemOf(JSON.parse(row.data)))
      throw problem("This is an item page. Open its template to make changes.");
    return row;
  };
  const itemRow = (req, parent) => {
    const row = db
      .prepare(
        "SELECT * FROM codes WHERE id=? AND workspace_id=? AND type='experience' AND json_extract(data,'$.itemOf')=?",
      )
      .get(req.params.itemId, req.workspace.id, parent.id);
    if (!row) throw problem("Item not found.", 404);
    return row;
  };
  const view = (row) => {
    const data = JSON.parse(row.data);
    return {
      id: row.id,
      slug: row.slug,
      name: data.title || row.name,
      serial: data.serial || "",
      warrantyUntil: data.warrantyUntil || "",
      active: !!row.active,
      shortUrl: `${origin}/r/${row.slug}`,
      scans: db.prepare("SELECT COUNT(*) n FROM scans WHERE code_id=?").get(row.id).n,
      responses: db
        .prepare("SELECT COUNT(*) n FROM experience_submissions WHERE code_id=?")
        .get(row.id).n,
      service: db
        .prepare(
          "SELECT id,service_date date,note FROM experience_service WHERE code_id=? ORDER BY service_date DESC,id DESC",
        )
        .all(row.id),
    };
  };

  app.get("/api/codes/:id/experience/items", (req, res) => {
    const parent = template(req);
    res.json(
      db
        .prepare(
          "SELECT * FROM codes WHERE workspace_id=? AND type='experience' AND json_extract(data,'$.itemOf')=? ORDER BY created_at DESC,rowid DESC LIMIT 1000",
        )
        .all(req.workspace.id, parent.id)
        .map(view),
    );
  });
  app.post("/api/codes/:id/experience/items", (req, res) => {
    const parent = template(req),
      input = z
        .object({ items: z.array(itemInput).min(1).max(100) })
        .safeParse(req.body);
    if (!input.success)
      throw problem(
        "Each item needs a name (up to 100 characters), and warranty dates must look like 2027-03-31.",
      );
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const created = input.data.items.map((item) => {
        entitlements?.assertCodeCreate(req.workspace.id);
        const id = randomUUID(),
          slug = randomBytes(8).toString("base64url");
        db.prepare(
          "INSERT INTO codes (id,user_id,slug,name,type,dynamic,data,folder_id,color,active,created_at,design,campaign,workspace_id,page_options) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          req.user.id,
          slug,
          item.name,
          "experience",
          1,
          JSON.stringify({
            title: item.name,
            itemOf: parent.id,
            serial: item.serial,
            warrantyUntil: item.warrantyUntil,
          }),
          parent.folder_id,
          parent.color,
          parent.active,
          now,
          parent.design,
          parent.campaign,
          req.workspace.id,
          parent.page_options,
        );
        return db.prepare("SELECT * FROM codes WHERE id=?").get(id);
      });
      audit(db, req.workspace.id, req.user.id, "experience.items.created", parent.id, {
        name: parent.name,
        count: created.length,
      });
      db.exec("COMMIT");
      res.status(201).json(created.map(view));
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
  app.put("/api/codes/:id/experience/items/:itemId", (req, res) => {
    const parent = template(req),
      row = itemRow(req, parent),
      input = itemInput.safeParse(req.body);
    if (!input.success) throw problem("Check the item's name and warranty date.");
    const data = {
      ...JSON.parse(row.data),
      title: input.data.name,
      serial: input.data.serial,
      warrantyUntil: input.data.warrantyUntil,
    };
    db.prepare("UPDATE codes SET name=?,data=? WHERE id=?").run(
      input.data.name,
      JSON.stringify(data),
      row.id,
    );
    res.json(view(db.prepare("SELECT * FROM codes WHERE id=?").get(row.id)));
  });
  app.delete("/api/codes/:id/experience/items/:itemId", (req, res) => {
    const parent = template(req),
      row = itemRow(req, parent);
    db.prepare("DELETE FROM codes WHERE id=?").run(row.id);
    audit(db, req.workspace.id, req.user.id, "experience.item.deleted", parent.id, {
      name: row.name,
    });
    res.json({ ok: true });
  });
  app.post("/api/codes/:id/experience/items/:itemId/service", (req, res) => {
    const parent = template(req),
      row = itemRow(req, parent),
      input = z
        .object({ date, note: z.string().trim().min(1).max(300) })
        .safeParse(req.body);
    if (!input.success)
      throw problem("Enter a date like 2026-03-31 and a short note.");
    if (
      db
        .prepare("SELECT COUNT(*) n FROM experience_service WHERE code_id=?")
        .get(row.id).n >= 200
    )
      throw problem("This item already has 200 service entries.");
    db.prepare(
      "INSERT INTO experience_service (code_id,service_date,note,created_at) VALUES (?,?,?,?)",
    ).run(row.id, input.data.date, input.data.note, new Date().toISOString());
    res.status(201).json(view(row));
  });
  app.delete("/api/codes/:id/experience/items/:itemId/service/:sid", (req, res) => {
    const parent = template(req),
      row = itemRow(req, parent);
    db.prepare("DELETE FROM experience_service WHERE id=? AND code_id=?").run(
      Number(req.params.sid),
      row.id,
    );
    res.json(view(row));
  });
}
