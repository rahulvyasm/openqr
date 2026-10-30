import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { atomic, passwordMatches, problem } from "./security.js";
import { operatorRole, requireStaffAccess } from "./operator.js";

const caseCategories = [
  "billing",
  "subscription",
  "account",
  "technical",
  "other",
];
const caseStatuses = ["open", "pending", "resolved", "closed"];
const casePriorities = ["low", "normal", "high"];

export const maskEmail = (email = "") => {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
};
export const isSuspended = (db, userId) =>
  !!db.prepare("SELECT 1 FROM config WHERE key=?").get(`suspended:${userId}`);

export function registerSupportRoutes(app, db, entitlements) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_cases (number INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT REFERENCES users(id),category TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,subject TEXT NOT NULL,created_by TEXT REFERENCES users(id),assigned_to TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_notes (id INTEGER PRIMARY KEY,case_number INTEGER NOT NULL REFERENCES support_cases(number),author_id TEXT REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff_audit (id INTEGER PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS support_cases_status ON support_cases(status,updated_at);
    CREATE INDEX IF NOT EXISTS support_cases_workspace ON support_cases(workspace_id);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(support_notes)")
      .all()
      .some((column) => column.name === "visibility")
  )
    db.exec(
      "ALTER TABLE support_notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'internal'",
    );
  if (
    !db
      .prepare("PRAGMA table_info(support_cases)")
      .all()
      .some((column) => column.name === "customer_seen_at")
  )
    db.exec("ALTER TABLE support_cases ADD COLUMN customer_seen_at TEXT");
  const now = () => new Date().toISOString();
  // A case needs staff attention while it is open and the customer spoke last.
  const attention =
    "c.status='open' AND c.user_id IS NOT NULL AND (SELECT n.author_id FROM support_notes n WHERE n.case_number=c.number AND n.visibility='public' ORDER BY n.id DESC LIMIT 1)=c.user_id";
  const log = (actor, action, type, id, reason = "") =>
    db
      .prepare(
        "INSERT INTO staff_audit(actor_id,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(actor, action, type, String(id), reason, now());
  const need = (req, permission) => requireStaffAccess(db, req, permission);
  const allows = (req, permission) => {
    try {
      need(req, permission);
      return true;
    } catch {
      return false;
    }
  };
  const pageOf = (req) =>
    z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.page || 0);
  const number = (req) =>
    z.coerce.number().int().positive().parse(req.params.number);
  const reason = z
    .string()
    .trim()
    .min(8, "Give a reason of at least 8 characters.")
    .max(300);
  const limiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sensitive actions. Try again later." },
  });
  const confirm = async (req, password) => {
    const actor = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await passwordMatches(password, actor)))
      throw problem("The password is incorrect.", 403);
  };

  // Operational facts only: never QR content, visitor records, media files, or credentials.
  app.get("/api/operator/customers/:id", (req, res) => {
    need(req, "workspaces:read");
    const w = db
      .prepare(
        "SELECT id,name,created_at AS createdAt,owner_id AS ownerId FROM workspaces WHERE id=?",
      )
      .get(req.params.id);
    if (!w) throw problem("Workspace not found.", 404);
    const members = db
      .prepare(
        "SELECT u.id,u.name,u.email,m.role,m.joined_at AS joinedAt FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.joined_at LIMIT 100",
      )
      .all(w.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        joinedAt: m.joinedAt,
        owner: m.id === w.ownerId,
        email: maskEmail(m.email),
        suspended: isSuspended(db, m.id),
        staff: !!operatorRole(db, m.id),
      }));
    const cases = db
      .prepare(
        "SELECT number,category,priority,status,subject,updated_at AS updatedAt FROM support_cases WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 10",
      )
      .all(w.id);
    atomic(db, () => log(req.user.id, "customer.viewed", "workspace", w.id));
    res.json({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt,
      members,
      cases,
      billing: entitlements.summary(w.id),
      canReveal: allows(req, "users:read"),
      canManageAccounts: allows(req, "accounts:manage"),
      canManageCases: allows(req, "cases:manage"),
      canManageBilling: allows(req, "billing:manage"),
    });
  });

  app.post("/api/operator/users/:id/reveal-email", limiter, (req, res) => {
    need(req, "users:read");
    const input = z.object({ reason }).parse(req.body);
    const user = db
      .prepare("SELECT email FROM users WHERE id=?")
      .get(req.params.id);
    if (!user) throw problem("Account not found.", 404);
    atomic(db, () =>
      log(req.user.id, "contact.revealed", "user", req.params.id, input.reason),
    );
    res.json({ email: user.email });
  });

  app.post("/api/operator/users/:id/suspension", limiter, async (req, res) => {
    need(req, "accounts:manage");
    const input = z
      .object({
        suspended: z.boolean(),
        reason,
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    if (req.params.id === req.user.id)
      throw problem("You cannot change the status of your own account.");
    await confirm(req, input.password);
    need(req, "accounts:manage");
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id))
      throw problem("Account not found.", 404);
    if (operatorRole(db, req.params.id))
      throw problem(
        "Company staff accounts are managed in Company staff.",
        409,
      );
    const revoked = atomic(db, () => {
      let removed = 0;
      if (input.suspended) {
        db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES (?,?)").run(
          `suspended:${req.params.id}`,
          now(),
        );
        removed = db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(req.params.id).changes;
      } else
        db.prepare("DELETE FROM config WHERE key=?").run(
          `suspended:${req.params.id}`,
        );
      log(
        req.user.id,
        input.suspended ? "account.suspended" : "account.restored",
        "user",
        req.params.id,
        input.reason,
      );
      return removed;
    });
    res.json({ ok: true, suspended: input.suspended, revoked });
  });

  const caseRow = (id) => {
    const row = db
      .prepare(
        "SELECT c.number,c.workspace_id AS workspaceId,w.name AS workspace,c.user_id AS userId,c.category,c.priority,c.status,c.subject,c.created_at AS createdAt,c.updated_at AS updatedAt,c.assigned_to AS assignedTo,(SELECT name FROM users WHERE id=c.assigned_to) AS assignee,(SELECT name FROM users WHERE id=c.user_id) AS contact FROM support_cases c JOIN workspaces w ON w.id=c.workspace_id WHERE c.number=?",
      )
      .get(id);
    if (!row) throw problem("Case not found.", 404);
    return row;
  };
  app.get("/api/operator/cases/attention", (req, res) => {
    res.json({
      count: allows(req, "cases:manage")
        ? db
            .prepare(
              `SELECT COUNT(*) n FROM support_cases c WHERE ${attention}`,
            )
            .get().n
        : 0,
    });
  });
  app.get("/api/operator/cases", (req, res) => {
    need(req, "cases:manage");
    const q = z
        .string()
        .max(100)
        .parse(req.query.q || ""),
      status = z
        .enum(["all", "active", ...caseStatuses])
        .parse(req.query.status || "active"),
      p = pageOf(req),
      search = `%${q}%`,
      id = q.replace(/^#|^SUP-/i, ""),
      filter =
        status === "all"
          ? "1=1"
          : status === "active"
            ? "c.status IN ('open','pending')"
            : "c.status=?",
      args = status === "all" || status === "active" ? [] : [status],
      where = `${filter} AND (c.subject LIKE ? OR w.name LIKE ? OR CAST(c.number AS TEXT)=?)`;
    res.json({
      rows: db
        .prepare(
          `SELECT c.number,w.name AS workspace,c.workspace_id AS workspaceId,c.category,c.priority,c.status,c.subject,c.updated_at AS updatedAt,(${attention}) AS needsReply,(SELECT name FROM users WHERE id=c.assigned_to) AS assignee FROM support_cases c JOIN workspaces w ON w.id=c.workspace_id WHERE ${where} ORDER BY CASE c.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,c.updated_at DESC LIMIT 25 OFFSET ?`,
        )
        .all(...args, search, search, id, p * 25),
      total: db
        .prepare(
          `SELECT COUNT(*) n FROM support_cases c JOIN workspaces w ON w.id=c.workspace_id WHERE ${where}`,
        )
        .get(...args, search, search, id).n,
      page: p,
      pageSize: 25,
    });
  });
  app.post("/api/operator/cases", (req, res) => {
    need(req, "cases:manage");
    const input = z
      .object({
        workspaceId: z.string().min(1).max(80),
        userId: z.string().max(80).optional(),
        category: z.enum(caseCategories),
        priority: z.enum(casePriorities).default("normal"),
        subject: z.string().trim().min(3).max(120),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    if (
      !db.prepare("SELECT id FROM workspaces WHERE id=?").get(input.workspaceId)
    )
      throw problem("Workspace not found.", 404);
    if (
      input.userId &&
      !db
        .prepare("SELECT 1 FROM members WHERE workspace_id=? AND user_id=?")
        .get(input.workspaceId, input.userId)
    )
      throw problem("The contact must be a member of the workspace.");
    const created = atomic(db, () => {
      const at = now(),
        id = Number(
          db
            .prepare(
              "INSERT INTO support_cases(workspace_id,user_id,category,priority,status,subject,created_by,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              input.workspaceId,
              input.userId || null,
              input.category,
              input.priority,
              "open",
              input.subject,
              req.user.id,
              req.user.id,
              at,
              at,
            ).lastInsertRowid,
        );
      if (input.note)
        db.prepare(
          "INSERT INTO support_notes(case_number,author_id,body,created_at) VALUES (?,?,?,?)",
        ).run(id, req.user.id, input.note, at);
      log(req.user.id, "case.opened", "case", id);
      return id;
    });
    res.status(201).json(caseRow(created));
  });
  app.get("/api/operator/cases/:number", (req, res) => {
    need(req, "cases:manage");
    const id = number(req),
      row = caseRow(id);
    atomic(db, () => log(req.user.id, "case.viewed", "case", id));
    res.json({
      ...row,
      notes: db
        .prepare(
          "SELECT n.id,n.body,n.visibility,n.created_at AS at,COALESCE(u.name,'Removed account') AS author FROM support_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.case_number=? ORDER BY n.id DESC LIMIT 100",
        )
        .all(id),
    });
  });
  app.post("/api/operator/cases/:number/notes", (req, res) => {
    need(req, "cases:manage");
    const id = number(req),
      { body, visibility } = z
        .object({
          body: z.string().trim().min(1).max(2000),
          visibility: z.enum(["internal", "public"]).default("internal"),
        })
        .parse(req.body);
    caseRow(id);
    atomic(db, () => {
      db.prepare(
        "INSERT INTO support_notes(case_number,author_id,body,created_at,visibility) VALUES (?,?,?,?,?)",
      ).run(id, req.user.id, body, now(), visibility);
      db.prepare("UPDATE support_cases SET updated_at=? WHERE number=?").run(
        now(),
        id,
      );
      log(req.user.id, "case.note_added", "case", id);
    });
    res.status(201).json({ ok: true });
  });
  app.patch("/api/operator/cases/:number", (req, res) => {
    need(req, "cases:manage");
    const id = number(req),
      input = z
        .object({
          status: z.enum(caseStatuses).optional(),
          priority: z.enum(casePriorities).optional(),
          assign: z.enum(["me", "none"]).optional(),
        })
        .parse(req.body),
      before = caseRow(id);
    atomic(db, () => {
      db.prepare(
        "UPDATE support_cases SET status=?,priority=?,assigned_to=?,updated_at=? WHERE number=?",
      ).run(
        input.status ?? before.status,
        input.priority ?? before.priority,
        input.assign === "me"
          ? req.user.id
          : input.assign === "none"
            ? null
            : before.assignedTo,
        now(),
        id,
      );
      log(
        req.user.id,
        input.status && input.status !== before.status
          ? `case.${input.status}`
          : "case.updated",
        "case",
        id,
      );
    });
    res.json(caseRow(id));
  });

  // Customer-facing requests: members see only their own requests and staff replies marked public.
  const mine = (req, id) => {
    const row = db
      .prepare(
        "SELECT number,category,status,subject,created_at AS createdAt,updated_at AS updatedAt FROM support_cases WHERE number=? AND user_id=? AND workspace_id=?",
      )
      .get(id, req.user.id, req.workspace?.id);
    if (!row) throw problem("Request not found.", 404);
    return row;
  };
  const requestLimit = rateLimit({
    windowMs: 60 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many support requests. Try again later." },
  });
  app.get("/api/support/unread", (req, res) => {
    res.json({
      count: db
        .prepare(
          "SELECT COUNT(*) n FROM support_cases c WHERE c.user_id=? AND EXISTS(SELECT 1 FROM support_notes n WHERE n.case_number=c.number AND n.visibility='public' AND n.author_id IS NOT ? AND n.created_at>COALESCE(c.customer_seen_at,''))",
        )
        .get(req.user.id, req.user.id).n,
    });
  });
  app.get("/api/support/requests", (req, res) => {
    if (!req.workspace) throw problem("Choose a workspace first.", 403);
    res.json(
      db
        .prepare(
          "SELECT c.number,c.category,c.status,c.subject,c.updated_at AS updatedAt,EXISTS(SELECT 1 FROM support_notes n WHERE n.case_number=c.number AND n.visibility='public' AND n.author_id IS NOT ? AND n.created_at>COALESCE(c.customer_seen_at,'')) AS unread FROM support_cases c WHERE c.user_id=? AND c.workspace_id=? ORDER BY c.updated_at DESC LIMIT 50",
        )
        .all(req.user.id, req.user.id, req.workspace.id)
        .map((row) => ({ ...row, unread: !!row.unread })),
    );
  });
  app.post("/api/support/requests", requestLimit, (req, res) => {
    if (!req.workspace) throw problem("Choose a workspace first.", 403);
    const input = z
      .object({
        category: z.enum(caseCategories),
        subject: z.string().trim().min(3).max(120),
        message: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    const id = atomic(db, () => {
      const at = now(),
        created = Number(
          db
            .prepare(
              "INSERT INTO support_cases(workspace_id,user_id,category,priority,status,subject,created_by,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              req.workspace.id,
              req.user.id,
              input.category,
              "normal",
              "open",
              input.subject,
              req.user.id,
              null,
              at,
              at,
            ).lastInsertRowid,
        );
      db.prepare(
        "INSERT INTO support_notes(case_number,author_id,body,created_at,visibility) VALUES (?,?,?,?,'public')",
      ).run(created, req.user.id, input.message, at);
      return created;
    });
    res.status(201).json(mine(req, id));
  });
  app.get("/api/support/requests/:number", (req, res) => {
    const id = number(req),
      request = mine(req, id);
    db.prepare(
      "UPDATE support_cases SET customer_seen_at=? WHERE number=?",
    ).run(now(), id);
    res.json({
      ...request,
      replies: db
        .prepare(
          "SELECT n.id,n.body,n.created_at AS at,(n.author_id=?) AS you FROM support_notes n WHERE n.case_number=? AND n.visibility='public' ORDER BY n.id DESC LIMIT 100",
        )
        .all(req.user.id, id)
        .map((reply) => ({ ...reply, you: !!reply.you })),
    });
  });
  app.post(
    "/api/support/requests/:number/replies",
    requestLimit,
    (req, res) => {
      const id = number(req),
        request = mine(req, id),
        { message } = z
          .object({ message: z.string().trim().min(1).max(2000) })
          .parse(req.body);
      if (request.status === "closed")
        throw problem(
          "This request is closed. Please open a new request.",
          409,
        );
      atomic(db, () => {
        db.prepare(
          "INSERT INTO support_notes(case_number,author_id,body,created_at,visibility) VALUES (?,?,?,?,'public')",
        ).run(id, req.user.id, message, now());
        db.prepare(
          "UPDATE support_cases SET updated_at=?,status=CASE WHEN status IN ('resolved','pending') THEN 'open' ELSE status END WHERE number=?",
        ).run(now(), id);
      });
      res.status(201).json({ ok: true });
    },
  );

  app.get("/api/operator/audit", (req, res) => {
    need(req, "audit:read");
    const p = pageOf(req);
    res.json({
      rows: db
        .prepare(
          "SELECT a.id,a.action,a.target_type AS targetType,a.target_id AS targetId,a.reason,a.created_at AS at,COALESCE(u.name,'Removed account') AS actor FROM staff_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 50 OFFSET ?",
        )
        .all(p * 50),
      total: db.prepare("SELECT COUNT(*) n FROM staff_audit").get().n,
      page: p,
      pageSize: 50,
    });
  });
}
