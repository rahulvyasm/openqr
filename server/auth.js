import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  atomic,
  audit,
  digest,
  passwordHash,
  passwordMatches,
  problem,
  secret,
  sessionLabel,
} from "./security.js";
import { createWorkspace, workspaceList } from "./workspaces.js";
import { isOperator, operatorRole } from "./operator.js";

const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const nameSchema = z.string().trim().min(1).max(80);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export function issueRecovery(db, email, origin) {
  const user = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.toLowerCase());
  if (!user) throw problem("No account was found for that email.");
  const token = secret();
  atomic(db, () => {
    db.prepare("DELETE FROM password_resets WHERE user_id=? OR expires<?").run(
      user.id,
      Date.now(),
    );
    db.prepare("INSERT INTO password_resets VALUES (?,?,?)").run(
      digest(token),
      user.id,
      Date.now() + 30 * 60000,
    );
    for (const w of workspaceList(db, user.id))
      audit(db, w.id, null, "account.recovery_issued", user.id, {
        method: "server-operator",
      });
  });
  return `${new URL(origin).origin}/#reset=${token}`;
}
export function registerAuth(app, db, origin, secureCookie, authLimit) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie,
    path: "/",
  };
  const clearCookie = (res) => res.clearCookie("openqr_session", cookieOptions);
  const session = (req, res, userId, workspaceId) => {
    if (req.sessionId)
      db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionId);
    const token = secret();
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const w = workspaceId || workspaceList(db, userId)[0]?.id || null;
    db.prepare(
      "INSERT INTO sessions (token,user_id,expires,workspace_id,created_at,label) VALUES (?,?,?,?,?,?)",
    ).run(
      digest(token),
      userId,
      Date.now() + 7 * 86400000,
      w,
      new Date().toISOString(),
      sessionLabel(req),
    );
    res.cookie("openqr_session", token, {
      ...cookieOptions,
      maxAge: 7 * 86400000,
    });
  };
  app.use("/api", (req, _res, next) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("openqr_session="))
      ?.slice(15);
    if (raw) {
      const s = db
        .prepare(
          "SELECT u.id,u.email,u.name,s.workspace_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        )
        .get(digest(raw), Date.now());
      if (s) {
        req.user = { id: s.id, email: s.email, name: s.name };
        req.sessionId = digest(raw);
        const ws = workspaceList(db, s.id);
        req.workspace =
          ws.find((w) => w.id === s.workspace_id) || ws[0] || null;
        if ((req.workspace?.id || null) !== s.workspace_id)
          db.prepare("UPDATE sessions SET workspace_id=? WHERE token=?").run(
            req.workspace?.id || null,
            req.sessionId,
          );
      }
    }
    next();
  });
  const requireAuth = (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: "Please sign in." });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/status", (req, res) =>
    res.json({
      setupRequired: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      user: req.user || null,
      operator: isOperator(db, req.user?.id),
      operatorRole: operatorRole(db, req.user?.id),
      publicUrl: origin,
      workspace: req.workspace || null,
      workspaces: req.user ? workspaceList(db, req.user.id) : [],
    }),
  );
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      throw problem("This instance already has an owner. Please sign in.", 409);
    const input = z
      .object({
        email: emailSchema,
        password: passwordSchema,
        name: nameSchema,
      })
      .safeParse(req.body);
    if (!input.success)
      throw problem(
        "Enter your name, a valid email, and a password of 12–128 characters.",
      );
    const { email, password, name } = input.data,
      { salt, hash } = await passwordHash(password),
      id = randomUUID();
    const workspaceId = atomic(db, () => {
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        throw problem("An owner already claimed this instance.", 409);
      db.prepare(
        "INSERT INTO users (id,email,name,salt,password) VALUES (?,?,?,?,?)",
      ).run(id, email, name, salt, hash);
      return createWorkspace(db, id, `${name}'s workspace`.slice(0, 80));
    });
    session(req, res, id, workspaceId);
    res.status(201).json({ id, email, name });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = z
      .object({ email: emailSchema, password: passwordSchema })
      .safeParse(req.body);
    if (!input.success) throw problem("Enter a valid email and password.");
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(input.data.email);
    if (!(await passwordMatches(input.data.password, user)))
      throw problem("Email or password is incorrect.", 401);
    // Do not let a pre-reset password create a session after an asynchronous verification.
    if (
      db.prepare("SELECT password FROM users WHERE id=?").get(user.id)
        ?.password !== user.password
    )
      throw problem("Please sign in again.", 401);
    session(req, res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  });
  const invitation = (token) => {
    const row = db
      .prepare(
        "SELECT i.*,w.name AS workspaceName FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token=? AND i.expires>? AND i.accepted_at IS NULL AND i.revoked_at IS NULL",
      )
      .get(digest(token), Date.now());
    if (!row)
      throw problem(
        "This invitation is invalid, expired, or already used.",
        410,
      );
    return row;
  };
  app.post("/api/auth/invite/inspect", authLimit, (req, res) => {
    const token = tokenSchema.parse(req.body.token),
      row = invitation(token);
    res.json({
      email: row.email,
      role: row.role,
      workspaceName: row.workspaceName,
      existingAccount: !!db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(row.email),
    });
  });
  app.post("/api/auth/invite/accept", authLimit, async (req, res) => {
    const token = tokenSchema.parse(req.body.token),
      invite = invitation(token),
      existing = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(invite.email);
    let credentials;
    if (existing) {
      if (!req.user || req.user.id !== existing.id)
        throw problem(
          "Sign in with the invited email before joining this workspace.",
          403,
        );
    } else {
      if (req.user)
        throw problem("Sign out before creating the invited account.", 403);
      const input = z
        .object({ name: nameSchema, password: passwordSchema })
        .parse(req.body);
      credentials = { ...input, ...(await passwordHash(input.password)) };
    }
    const id = atomic(db, () => {
      const live = invitation(token);
      let userId = existing?.id;
      if (!userId) {
        if (db.prepare("SELECT id FROM users WHERE email=?").get(live.email))
          throw problem(
            "An account now exists for this email. Sign in to join.",
            409,
          );
        userId = randomUUID();
        db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(
          userId,
          live.email,
          credentials.name,
          credentials.salt,
          credentials.hash,
        );
      }
      if (
        db
          .prepare("SELECT 1 FROM members WHERE workspace_id=? AND user_id=?")
          .get(live.workspace_id, userId)
      )
        throw problem("You are already a member of this workspace.", 409);
      db.prepare("INSERT INTO members VALUES (?,?,?,?)").run(
        live.workspace_id,
        userId,
        live.role,
        new Date().toISOString(),
      );
      db.prepare("UPDATE invitations SET accepted_at=? WHERE id=?").run(
        new Date().toISOString(),
        live.id,
      );
      audit(db, live.workspace_id, userId, "invitation.accepted", live.id, {
        role: live.role,
      });
      return userId;
    });
    // Rotate any existing cookie when the invitation establishes workspace access.
    if (req.sessionId)
      db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionId);
    session(req, res, id, invite.workspace_id);
    res.json({ ok: true });
  });
  app.post("/api/auth/reset", authLimit, async (req, res) => {
    const { token, password } = z
        .object({ token: tokenSchema, password: passwordSchema })
        .parse(req.body),
      record = db
        .prepare(
          "SELECT user_id FROM password_resets WHERE token=? AND expires>?",
        )
        .get(digest(token), Date.now());
    if (!record)
      throw problem(
        "This recovery link is invalid, expired, or already used.",
        410,
      );
    const { salt, hash } = await passwordHash(password);
    atomic(db, () => {
      if (
        !db
          .prepare("SELECT 1 FROM password_resets WHERE token=? AND expires>?")
          .get(digest(token), Date.now())
      )
        throw problem(
          "This recovery link is invalid, expired, or already used.",
          410,
        );
      db.prepare("UPDATE users SET salt=?,password=? WHERE id=?").run(
        salt,
        hash,
        record.user_id,
      );
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(
        record.user_id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(record.user_id);
      for (const w of workspaceList(db, record.user_id))
        audit(
          db,
          w.id,
          record.user_id,
          "account.password_recovered",
          record.user_id,
        );
    });
    clearCookie(res);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", requireAuth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionId);
    clearCookie(res);
    res.json({ ok: true });
  });
  app.patch("/api/auth/profile", requireAuth, (req, res) => {
    const name = nameSchema.parse(req.body.name);
    db.prepare("UPDATE users SET name=? WHERE id=?").run(name, req.user.id);
    audit(
      db,
      req.workspace?.id,
      req.user.id,
      "account.profile_updated",
      req.user.id,
    );
    res.json({ ...req.user, name });
  });
  app.post("/api/auth/password", requireAuth, authLimit, async (req, res) => {
    const input = z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: passwordSchema,
        })
        .parse(req.body),
      user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await passwordMatches(input.currentPassword, user)))
      throw problem("Your current password is incorrect.");
    const { salt, hash } = await passwordHash(input.newPassword);
    atomic(db, () => {
      if (
        db.prepare("SELECT password FROM users WHERE id=?").get(user.id)
          ?.password !== user.password
      )
        throw problem("Your password changed. Sign in again.", 401);
      db.prepare("UPDATE users SET salt=?,password=? WHERE id=?").run(
        salt,
        hash,
        user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      db.prepare("DELETE FROM password_resets WHERE user_id=?").run(user.id);
      for (const w of workspaceList(db, user.id))
        audit(db, w.id, user.id, "account.password_changed", user.id);
    });
    session(req, res, user.id, req.workspace?.id);
    res.json({ ok: true });
  });
  app.get("/api/auth/sessions", requireAuth, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT token AS id,created_at AS createdAt,expires,label FROM sessions WHERE user_id=? AND expires>? ORDER BY created_at DESC",
        )
        .all(req.user.id, Date.now())
        .map((s) => ({ ...s, current: s.id === req.sessionId })),
    ),
  );
  app.delete("/api/auth/sessions/:id", requireAuth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=? AND user_id=?").run(
      req.params.id,
      req.user.id,
    );
    audit(
      db,
      req.workspace?.id,
      req.user.id,
      "account.session_revoked",
      req.user.id,
    );
    if (req.params.id === req.sessionId) clearCookie(res);
    res.json({ ok: true });
  });
  app.post("/api/auth/sessions/revoke-others", requireAuth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token!=?").run(
      req.user.id,
      req.sessionId,
    );
    audit(
      db,
      req.workspace?.id,
      req.user.id,
      "account.other_sessions_revoked",
      req.user.id,
    );
    res.json({ ok: true });
  });
  return { requireAuth };
}
