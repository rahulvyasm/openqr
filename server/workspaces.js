import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  access,
  atomic,
  audit,
  canManage,
  digest,
  passwordMatches,
  problem,
  secret,
} from "./security.js";

export function migrateWorkspaces(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version >= 3) return;
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    atomic(db, () => {
      db.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
      CREATE TABLE members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),joined_at TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
      CREATE TABLE invitations (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),token TEXT UNIQUE NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,expires INTEGER NOT NULL,accepted_at TEXT,revoked_at TEXT);
      CREATE TABLE password_resets (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),actor_id TEXT REFERENCES users(id),event TEXT NOT NULL,subject TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX audit_workspace_date ON audit_events(workspace_id,created_at);
      ALTER TABLE codes ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
      ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
      ALTER TABLE sessions ADD COLUMN created_at TEXT;
      ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Existing session';
      CREATE TABLE folders_v3 (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,workspace_id TEXT REFERENCES workspaces(id),UNIQUE(workspace_id,name));
      INSERT INTO folders_v3 (id,user_id,name) SELECT id,user_id,name FROM folders;
      DROP TABLE folders; ALTER TABLE folders_v3 RENAME TO folders;
      CREATE TABLE templates_v3 (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,color TEXT NOT NULL,design TEXT NOT NULL,workspace_id TEXT REFERENCES workspaces(id),UNIQUE(workspace_id,name));
      INSERT INTO templates_v3 (id,user_id,name,color,design) SELECT id,user_id,name,color,design FROM templates;
      DROP TABLE templates; ALTER TABLE templates_v3 RENAME TO templates;
      CREATE INDEX codes_workspace ON codes(workspace_id);`);
      for (const user of db.prepare("SELECT id,name FROM users").all()) {
        const workspaceId = createWorkspace(
          db,
          user.id,
          `${user.name}'s workspace`.slice(0, 80),
        );
        for (const table of ["codes", "folders", "templates", "sessions"])
          db.prepare(`UPDATE ${table} SET workspace_id=? WHERE user_id=?`).run(
            workspaceId,
            user.id,
          );
      }
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error(
          "Workspace migration failed its foreign-key integrity check.",
        );
      db.exec("PRAGMA user_version=3");
    });
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}
export function createWorkspace(db, userId, name) {
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare("INSERT INTO workspaces VALUES (?,?,?,?)").run(
    id,
    name,
    userId,
    now,
  );
  db.prepare("INSERT INTO members VALUES (?,?,?,?)").run(
    id,
    userId,
    "owner",
    now,
  );
  audit(db, id, userId, "workspace.created", id);
  return id;
}
export const workspaceList = (db, userId) =>
  db
    .prepare(
      "SELECT w.id,w.name,w.owner_id AS ownerId,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,w.created_at,w.id",
    )
    .all(userId);

export function registerWorkspaceRoutes(app, db, origin) {
  const current = (req, level = "read") => {
    if (!req.workspace) throw problem("Choose a workspace first.", 403);
    return access(db, req.user.id, req.workspace.id, level);
  };
  const allowedRole = (actor, role) => {
    if (role === "admin" && actor.role !== "owner")
      throw problem("Only the owner can appoint an admin.", 403);
  };
  const inviteReply = (id, token) => ({
    id,
    url: `${origin}/#invite=${token}`,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  app.get("/api/workspaces", (req, res) =>
    res.json(workspaceList(db, req.user.id)),
  );
  app.post("/api/workspaces", (req, res) => {
    const name = z.string().trim().min(1).max(80).parse(req.body.name);
    const id = atomic(db, () => createWorkspace(db, req.user.id, name));
    db.prepare("UPDATE sessions SET workspace_id=? WHERE token=?").run(
      id,
      req.sessionId,
    );
    res.status(201).json(access(db, req.user.id, id));
  });
  app.post("/api/workspaces/:id/select", (req, res) => {
    const workspace = access(db, req.user.id, req.params.id);
    db.prepare("UPDATE sessions SET workspace_id=? WHERE token=?").run(
      workspace.id,
      req.sessionId,
    );
    res.json(workspace);
  });
  app.patch("/api/workspace", (req, res) => {
    const w = current(req, "manage"),
      name = z.string().trim().min(1).max(80).parse(req.body.name);
    db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(name, w.id);
    audit(db, w.id, req.user.id, "workspace.renamed", w.id, { name });
    res.json({ ...w, name });
  });
  app.get("/api/team", (req, res) => {
    const w = current(req);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name,u.email,m.role,m.joined_at AS joinedAt FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name",
        )
        .all(w.id),
    );
  });
  app.get("/api/invitations", (req, res) => {
    const w = current(req, "manage");
    res.json(
      db
        .prepare(
          "SELECT id,email,role,created_at AS createdAt,expires,accepted_at AS acceptedAt,revoked_at AS revokedAt FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC",
        )
        .all(w.id),
    );
  });
  app.post("/api/invitations", (req, res) => {
    const w = current(req, "manage"),
      { email, role } = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          role: z.enum(["admin", "editor", "viewer"]),
        })
        .parse(req.body);
    allowedRole(w, role);
    if (
      db
        .prepare(
          "SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?",
        )
        .get(w.id, email)
    )
      throw problem("This person is already a workspace member.", 409);
    if (
      db
        .prepare(
          "SELECT id FROM invitations WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires>?",
        )
        .get(w.id, email, Date.now())
    )
      throw problem(
        "An invitation is already pending. Renew or revoke it first.",
        409,
      );
    const token = secret(),
      id = randomUUID();
    db.prepare("INSERT INTO invitations VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id,
      w.id,
      email,
      role,
      digest(token),
      req.user.id,
      new Date().toISOString(),
      Date.now() + 7 * 86400000,
      null,
      null,
    );
    audit(db, w.id, req.user.id, "invitation.created", email, { role });
    res.status(201).json(inviteReply(id, token));
  });
  app.post("/api/invitations/:id/renew", (req, res) => {
    const w = current(req, "manage"),
      row = db
        .prepare(
          "SELECT * FROM invitations WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .get(req.params.id, w.id);
    if (!row) throw problem("Invitation not found.", 404);
    allowedRole(w, row.role);
    const token = secret();
    db.prepare("UPDATE invitations SET token=?,expires=? WHERE id=?").run(
      digest(token),
      Date.now() + 7 * 86400000,
      row.id,
    );
    audit(db, w.id, req.user.id, "invitation.renewed", row.email);
    res.json(inviteReply(row.id, token));
  });
  app.delete("/api/invitations/:id", (req, res) => {
    const w = current(req, "manage"),
      row = db
        .prepare(
          "SELECT * FROM invitations WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .get(req.params.id, w.id);
    if (!row) throw problem("Invitation not found.", 404);
    allowedRole(w, row.role);
    db.prepare("UPDATE invitations SET revoked_at=? WHERE id=?").run(
      new Date().toISOString(),
      row.id,
    );
    audit(db, w.id, req.user.id, "invitation.revoked", row.email);
    res.json({ ok: true });
  });
  const manageableMember = (req) => {
    const w = current(req, "manage"),
      target = db
        .prepare(
          "SELECT user_id,role FROM members WHERE workspace_id=? AND user_id=?",
        )
        .get(w.id, req.params.id);
    if (!target) throw problem("Member not found.", 404);
    if (target.role === "owner")
      throw problem(
        "Transfer ownership before changing or removing the owner.",
        403,
      );
    if (w.role === "admin" && ["owner", "admin"].includes(target.role))
      throw problem("Only the owner can manage admins.", 403);
    return { w, target };
  };
  app.patch("/api/team/:id", (req, res) => {
    const { w, target } = manageableMember(req),
      role = z.enum(["admin", "editor", "viewer"]).parse(req.body.role);
    allowedRole(w, role);
    atomic(db, () => {
      db.prepare(
        "UPDATE members SET role=? WHERE workspace_id=? AND user_id=?",
      ).run(role, w.id, target.user_id);
      if (!canManage(role))
        db.prepare(
          "UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND created_by=? AND accepted_at IS NULL AND revoked_at IS NULL",
        ).run(new Date().toISOString(), w.id, target.user_id);
      audit(db, w.id, req.user.id, "member.role_changed", target.user_id, {
        from: target.role,
        to: role,
      });
    });
    res.json({ ok: true });
  });
  app.delete("/api/team/:id", (req, res) => {
    const { w, target } = manageableMember(req);
    atomic(db, () => {
      db.prepare("DELETE FROM members WHERE workspace_id=? AND user_id=?").run(
        w.id,
        target.user_id,
      );
      db.prepare(
        "UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND created_by=? AND accepted_at IS NULL AND revoked_at IS NULL",
      ).run(new Date().toISOString(), w.id, target.user_id);
      audit(db, w.id, req.user.id, "member.removed", target.user_id);
    });
    res.json({ ok: true });
  });
  app.post("/api/workspace/transfer", async (req, res) => {
    const w = current(req, "owner"),
      input = z
        .object({ userId: z.string(), password: z.string().min(1).max(128) })
        .parse(req.body),
      user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await passwordMatches(input.password, user)))
      throw problem("Your current password is incorrect.", 400);
    atomic(db, () => {
      if (
        db.prepare("SELECT password FROM users WHERE id=?").get(req.user.id)
          ?.password !== user.password ||
        !db
          .prepare("SELECT 1 FROM sessions WHERE token=? AND expires>?")
          .get(req.sessionId, Date.now())
      )
        throw problem(
          "Please sign in again before transferring ownership.",
          401,
        );
      access(db, req.user.id, w.id, "owner");
      if (
        input.userId === req.user.id ||
        !db
          .prepare("SELECT 1 FROM members WHERE workspace_id=? AND user_id=?")
          .get(w.id, input.userId)
      )
        throw problem("Choose another existing member.");
      db.prepare(
        "UPDATE members SET role='admin' WHERE workspace_id=? AND user_id=?",
      ).run(w.id, req.user.id);
      db.prepare(
        "UPDATE members SET role='owner' WHERE workspace_id=? AND user_id=?",
      ).run(w.id, input.userId);
      db.prepare("UPDATE workspaces SET owner_id=? WHERE id=?").run(
        input.userId,
        w.id,
      );
      audit(
        db,
        w.id,
        req.user.id,
        "workspace.ownership_transferred",
        input.userId,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/audit", (req, res) => {
    const w = current(req, "manage");
    res.json(
      db
        .prepare(
          "SELECT a.id,a.event,a.subject,a.details,a.created_at AS createdAt,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 100",
        )
        .all(w.id)
        .map((row) => ({ ...row, details: JSON.parse(row.details) })),
    );
  });
}
