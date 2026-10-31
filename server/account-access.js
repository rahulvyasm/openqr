import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { atomic, passwordMatches, problem } from "./security.js";
import { requireStaffAccess } from "./operator.js";

export function accountAccess(db, userId) {
  const raw = db
    .prepare("SELECT value FROM config WHERE key=?")
    .get(`account-access:${userId}`)?.value;
  if (!raw) return null;
  try {
    const grant = JSON.parse(raw);
    if (!["free", "plus", "pro", "unlimited"].includes(grant.tier)) return null;
    return grant;
  } catch {
    return null;
  }
}

export function registerAccountAccessRoutes(app, db, entitlements) {
  const limit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again later." },
  });
  app.post("/api/operator/accounts/:id/access", limit, async (req, res) => {
    requireStaffAccess(db, req, "entitlements:override");
    const input = z
      .object({
        tier: z.enum(["free", "plus", "pro", "unlimited", "inherit"]),
        reason: z.string().trim().min(5).max(500),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    if (!entitlements.enabled)
      throw problem(
        "Hosted plan enforcement is disabled on this installation.",
        409,
      );
    const actor = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await passwordMatches(input.password, actor)))
      throw problem("The password is incorrect.", 403);
    // Password verification yields; staff permissions and the account are rechecked afterwards.
    requireStaffAccess(db, req, "entitlements:override");
    atomic(db, () => {
      if (
        db.prepare("SELECT password FROM users WHERE id=?").get(req.user.id)
          ?.password !== actor.password
      )
        throw problem("Your password changed. Sign in again.", 403);
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(req.params.id))
        throw problem("Account not found.", 404);
      const key = `account-access:${req.params.id}`;
      if (input.tier === "inherit")
        db.prepare("DELETE FROM config WHERE key=?").run(key);
      else
        db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES (?,?)").run(
          key,
          JSON.stringify({
            tier: input.tier,
            source: "account_grant",
            status: "active",
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.id,
          }),
        );
      // Audit the decision, including its reason, atomically with the grant.
      db.prepare(
        "INSERT INTO staff_audit(actor_id,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        req.user.id,
        `account.access_${input.tier}`,
        "account",
        req.params.id,
        input.reason,
        new Date().toISOString(),
      );
    });
    res.json({ ok: true, access: accountAccess(db, req.params.id) });
  });
}
