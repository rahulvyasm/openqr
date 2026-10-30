import { randomUUID } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { atomic, passwordMatches, problem } from "./security.js";
import { createBackup } from "./backup.js";
import { readBackupStatus } from "./backup-status.js";
import { staffRoles, staffPermissions } from "../shared/operator-access.js";

export function operatorRole(db, userId) {
  if (!userId) return null;
  const value = db
    .prepare("SELECT value FROM config WHERE key=?")
    .get(`operator:${userId}`)?.value;
  if (value === "true") return "super_admin";
  return staffRoles.some((role) => role.id === value) ? value : null;
}
export const isOperator = (db, userId) => !!operatorRole(db, userId);
export function requireStaffAccess(db, req, permission = "overview:read") {
  if (
    !req.user ||
    !db
      .prepare(
        "SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires>?",
      )
      .get(req.sessionId, req.user.id, Date.now())
  )
    throw problem("Please sign in.", 401);
  const role = operatorRole(db, req.user.id);
  if (!role || !staffPermissions(role).includes(permission))
    throw problem("Your company staff role does not allow this action.", 403);
  return role;
}
function operatorEvents(db) {
  try {
    const value = JSON.parse(
      db.prepare("SELECT value FROM config WHERE key='operator_events'").get()
        ?.value || "[]",
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function record(db, actorId, event, targetId = null, count = null) {
  const events = [
    {
      id: randomUUID(),
      at: new Date().toISOString(),
      actorId,
      event,
      targetId,
      count,
    },
    ...operatorEvents(db),
  ].slice(0, 100);
  db.prepare(
    "INSERT OR REPLACE INTO config(key,value) VALUES ('operator_events',?)",
  ).run(JSON.stringify(events));
}
export function setOperator(
  db,
  userId,
  enabled,
  role = "super_admin",
  actorId = null,
) {
  if (enabled && !staffRoles.some((item) => item.id === role))
    throw problem("Choose a supported company staff role.");
  if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId))
    throw problem("Account not found.", 404);
  atomic(db, () => {
    if (enabled)
      db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES (?,?)").run(
        `operator:${userId}`,
        role,
      );
    else db.prepare("DELETE FROM config WHERE key=?").run(`operator:${userId}`);
    record(
      db,
      actorId,
      actorId
        ? enabled
          ? `staff.${role}_assigned`
          : "staff.removed"
        : enabled
          ? "operator.granted"
          : "operator.revoked",
      userId,
    );
  });
}

export function registerOperatorRoutes(
  app,
  db,
  storage,
  { dbPath, publicUrl, backupPolicy },
) {
  db.exec("CREATE INDEX IF NOT EXISTS scans_time ON scans(scanned_at)");
  const directory =
    dbPath === ":memory:" ? null : join(dirname(resolve(dbPath)), "backups");
  const requireOperator = (req, permission) =>
    requireStaffAccess(db, req, permission);
  app.use("/api/operator", (req, _res, next) => {
    requireOperator(req);
    next();
  });
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  app.get("/api/operator/overview", async (req, res) => {
    const now = Date.now(),
      since = new Date(now - 30 * 86400000).toISOString(),
      day = new Date(now - 86400000).toISOString();
    const dailyRows = db
      .prepare(
        "SELECT substr(scanned_at,1,10) date,COUNT(*) scans FROM scans WHERE scanned_at>=? GROUP BY date",
      )
      .all(since);
    const hourlyRows = db
      .prepare(
        "SELECT substr(scanned_at,1,13) hour,COUNT(*) scans FROM scans WHERE scanned_at>=? GROUP BY hour",
      )
      .all(day);
    const daily = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now - (29 - i) * 86400000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        scans: dailyRows.find((row) => row.date === date)?.scans || 0,
      };
    });
    const hourly = Array.from({ length: 25 }, (_, i) => {
      const hour = new Date(now - (24 - i) * 3600000)
        .toISOString()
        .slice(0, 13);
      return {
        hour,
        scans: hourlyRows.find((row) => row.hour === hour)?.scans || 0,
      };
    });
    const events = db
      .prepare(
        "SELECT a.id,a.event,a.created_at AS at,w.name AS workspace,u.name AS actor,a.details FROM audit_events a JOIN workspaces w ON w.id=a.workspace_id LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 40",
      )
      .all()
      .map((row) => {
        let name = "";
        try {
          name = JSON.parse(row.details).name || "";
        } catch {}
        return {
          id: row.id,
          event: row.event,
          at: row.at,
          workspace: row.workspace,
          actor: row.actor || "Server operator",
          name,
        };
      });
    const backup = await readBackupStatus(directory);
    requireOperator(req);
    const role = operatorRole(db, req.user.id),
      permissions = staffPermissions(role);
    res.json({
      access: {
        role,
        permissions,
        label: staffRoles.find((item) => item.id === role).label,
      },
      at: new Date().toISOString(),
      refreshSeconds: 5,
      totals: {
        users: count("SELECT COUNT(*) n FROM users"),
        workspaces: count("SELECT COUNT(*) n FROM workspaces"),
        codes: count("SELECT COUNT(*) n FROM codes"),
        scans: count("SELECT COUNT(*) n FROM scans"),
        scans24h: count(
          "SELECT COUNT(*) n FROM scans WHERE scanned_at>=?",
          day,
        ),
        scans15m: count(
          "SELECT COUNT(*) n FROM scans WHERE scanned_at>=?",
          new Date(now - 15 * 60000).toISOString(),
        ),
        sessions: count("SELECT COUNT(*) n FROM sessions WHERE expires>?", now),
        mediaBytes: count("SELECT COALESCE(SUM(size),0) n FROM assets"),
        mediaFiles: count("SELECT COUNT(*) n FROM assets"),
        paused: count(
          "SELECT COUNT(*) n FROM codes WHERE dynamic=1 AND active=0",
        ),
      },
      daily,
      hourly,
      types: db
        .prepare(
          "SELECT type,COUNT(*) count FROM codes GROUP BY type ORDER BY count DESC",
        )
        .all(),
      roles: db
        .prepare("SELECT role,COUNT(*) count FROM members GROUP BY role")
        .all(),
      events: permissions.includes("activity:read") ? events : [],
      operations: permissions.includes("operations:read")
        ? {
            uptimeSeconds: Math.floor(process.uptime()),
            storageBackend: storage.kind,
            workspaceQuotaBytes: storage.quota,
            maxUploadBytes: storage.maxUpload,
            publicUrl,
            backup: {
              ...backup,
              intervalHours: backupPolicy?.intervalHours ?? null,
              retention: backupPolicy?.retention ?? null,
              remoteEnabled: !!(
                storage.backupStore ||
                (storage.backupBucket && storage.objectStore)
              ),
              available: !!directory,
            },
          }
        : null,
      operatorEvents: (permissions.includes("staff:manage")
        ? operatorEvents(db)
        : []
      )
        .slice(0, 25)
        .map((event) => ({
          ...event,
          actor: event.actorId
            ? db.prepare("SELECT name FROM users WHERE id=?").get(event.actorId)
                ?.name || "Removed account"
            : "Server operator",
        })),
    });
  });
  const paging = (req) => ({
    q: z
      .string()
      .max(100)
      .parse(req.query.q || ""),
    page: z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.page || 0),
  });
  app.get("/api/operator/workspaces", (req, res) => {
    requireOperator(req, "workspaces:read");
    const { q, page } = paging(req),
      search = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT w.id,w.name,w.created_at AS createdAt,u.name AS ownerName,(SELECT COUNT(*) FROM members m WHERE m.workspace_id=w.id) AS members,(SELECT COUNT(*) FROM codes c WHERE c.workspace_id=w.id) AS codes,(SELECT COUNT(*) FROM scans s JOIN codes c ON c.id=s.code_id WHERE c.workspace_id=w.id) AS scans,(SELECT COALESCE(SUM(size),0) FROM assets a WHERE a.workspace_id=w.id) AS mediaBytes FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.name LIKE ? OR u.name LIKE ? ORDER BY w.created_at DESC,w.id LIMIT 25 OFFSET ?`,
      )
      .all(search, search, page * 25);
    res.json({
      rows,
      total: count(
        "SELECT COUNT(*) n FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.name LIKE ? OR u.name LIKE ?",
        search,
        search,
      ),
      page,
      pageSize: 25,
    });
  });
  app.get("/api/operator/users", (req, res) => {
    requireOperator(req, "users:read");
    const { q, page } = paging(req),
      search = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT u.id,u.name,u.email,(SELECT COUNT(*) FROM members m WHERE m.user_id=u.id) AS workspaces,(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires>?) AS sessions FROM users u WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.rowid DESC LIMIT 25 OFFSET ?`,
      )
      .all(Date.now(), search, search, page * 25)
      .map((user) => ({ ...user, operator: isOperator(db, user.id) }));
    res.json({
      rows,
      total: count(
        "SELECT COUNT(*) n FROM users WHERE name LIKE ? OR email LIKE ?",
        search,
        search,
      ),
      page,
      pageSize: 25,
    });
  });
  app.post(
    "/api/operator/users/:id/revoke-sessions",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many password attempts. Try again later." },
    }),
    async (req, res) => {
      requireOperator(req, "sessions:revoke");
      const { password } = z
        .object({ password: z.string().min(1).max(128) })
        .parse(req.body);
      if (req.params.id === req.user.id)
        throw problem("Use My account to manage your own sessions.");
      const actor = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(req.user.id);
      if (!(await passwordMatches(password, actor)))
        throw problem("The password is incorrect.", 403);
      requireOperator(req, "sessions:revoke");
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id))
        throw problem("Account not found.", 404);
      const revoked = atomic(db, () => {
        const result = db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(req.params.id);
        record(
          db,
          req.user.id,
          "operator.sessions_revoked",
          req.params.id,
          result.changes,
        );
        return result.changes;
      });
      res.json({ ok: true, revoked });
    },
  );
  let manualBackupRunning = false;
  app.post("/api/operator/backups", async (req, res) => {
    requireOperator(req, "backup:create");
    if (!directory)
      throw problem("Backups require a disk-backed installation.", 503);
    if (manualBackupRunning)
      throw problem("An operator backup is already in progress.", 409);
    manualBackupRunning = true;
    try {
      await createBackup({
        db,
        storage,
        directory,
        publicUrl,
        retention: backupPolicy?.retention || 7,
      });
      atomic(db, () => record(db, req.user.id, "operator.backup_created"));
      res.json({ ok: true });
    } catch (error) {
      atomic(db, () => record(db, req.user.id, "operator.backup_failed"));
      throw error;
    } finally {
      manualBackupRunning = false;
    }
  });
  app.get("/api/operator/staff", (req, res) => {
    requireOperator(req, "staff:manage");
    const rows = db
      .prepare(
        "SELECT u.id,u.name,u.email FROM users u JOIN config c ON c.key='operator:'||u.id ORDER BY u.name",
      )
      .all()
      .map((user) => ({ ...user, role: operatorRole(db, user.id) }))
      .filter((user) => user.role);
    res.json(rows);
  });
  const reauthenticate = async (req) => {
    requireOperator(req, "staff:manage");
    const password = z.string().min(1).max(128).parse(req.body?.password);
    if (
      !(await passwordMatches(
        password,
        db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
      ))
    )
      throw problem("The password is incorrect.", 403);
    requireOperator(req, "staff:manage");
  };
  const protectSuperAdmin = (userId, nextRole) => {
    if (
      operatorRole(db, userId) === "super_admin" &&
      nextRole !== "super_admin" &&
      db
        .prepare(
          "SELECT COUNT(*) n FROM config WHERE key LIKE 'operator:%' AND value IN ('true','super_admin')",
        )
        .get().n <= 1
    )
      throw problem(
        "Keep at least one company Super Admin. Add another before changing this role.",
      );
  };
  const staffLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.post("/api/operator/staff", staffLimiter, async (req, res) => {
    await reauthenticate(req);
    const input = z
      .object({
        email: z.email().max(254),
        role: z.enum(staffRoles.map((item) => item.id)),
      })
      .parse(req.body);
    const target = db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(input.email.toLowerCase());
    if (!target)
      throw problem(
        "Create or invite this account before assigning company access.",
        404,
      );
    protectSuperAdmin(target.id, input.role);
    setOperator(db, target.id, true, input.role, req.user.id);
    res.json({ ok: true });
  });
  app.delete("/api/operator/staff/:id", staffLimiter, async (req, res) => {
    await reauthenticate(req);
    protectSuperAdmin(req.params.id, null);
    setOperator(db, req.params.id, false, "super_admin", req.user.id);
    res.json({ ok: true });
  });
}
