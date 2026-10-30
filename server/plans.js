import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { hostedPlans } from "../shared/plans.js";
import { atomic, audit, passwordMatches, problem } from "./security.js";
import { requireStaffAccess } from "./operator.js";

export function createEntitlements(db, storage, hosting = {}) {
  const enabled = !!hosting.enabled;
  const prices = {
    free: 0,
    creator: hosting.creatorINR ?? null,
    business: hosting.businessINR ?? null,
  };
  const catalog = () =>
    hostedPlans.map((plan) => ({ ...plan, monthlyINR: prices[plan.id] }));
  const record = (workspaceId) => {
    try {
      return JSON.parse(
        db
          .prepare("SELECT value FROM config WHERE key=?")
          .get(`subscription:${workspaceId}`)?.value || "null",
      );
    } catch {
      return null;
    }
  };
  const plan = (workspaceId) => {
    const saved = record(workspaceId),
      effective =
        saved && ["active", "trialing"].includes(saved.status)
          ? saved.tier
          : "free";
    const tier =
      hostedPlans.find((plan) => plan.id === effective) || hostedPlans[0];
    return enabled
      ? {
          ...tier,
          status: saved?.status || "free",
          source: saved?.source || "free",
          updatedAt: saved?.updatedAt || null,
        }
      : {
          id: "selfhost",
          name: "Self-hosted",
          codes: null,
          members: null,
          storageBytes: storage.quota,
          status: "included",
          source: "selfhost",
          updatedAt: null,
        };
  };
  const usage = (workspaceId) => ({
    codes: db
      .prepare("SELECT COUNT(*) n FROM codes WHERE workspace_id=?")
      .get(workspaceId).n,
    storageBytes: db
      .prepare(
        "SELECT COALESCE(SUM(size),0) n FROM assets WHERE workspace_id=?",
      )
      .get(workspaceId).n,
    members: db
      .prepare("SELECT COUNT(*) n FROM members WHERE workspace_id=?")
      .get(workspaceId).n,
    pendingInvites: db
      .prepare(
        "SELECT COUNT(*) n FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires>?",
      )
      .get(workspaceId, Date.now()).n,
  });
  const quota = (workspaceId) => plan(workspaceId).storageBytes;
  const assertCodeCreate = (workspaceId) => {
    const current = plan(workspaceId);
    if (current.codes !== null && usage(workspaceId).codes >= current.codes)
      throw problem(
        `This workspace has reached its ${current.name} plan limit of ${current.codes} QR codes. Remove unused codes or ask the owner to review the hosted plan.`,
        402,
      );
  };
  const assertInvite = (workspaceId, excludeId = "") => {
    const current = plan(workspaceId);
    if (current.members === null) return;
    const members = db
      .prepare("SELECT COUNT(*) n FROM members WHERE workspace_id=?")
      .get(workspaceId).n;
    const pending = db
      .prepare(
        "SELECT COUNT(*) n FROM invitations WHERE workspace_id=? AND id<>? AND accepted_at IS NULL AND revoked_at IS NULL AND expires>?",
      )
      .get(workspaceId, excludeId, Date.now()).n;
    if (members + pending >= current.members)
      throw problem(
        `This ${current.name} workspace has no team seats available. Pending invitations reserve a seat.`,
        402,
      );
  };
  const assertAccept = (workspaceId) => {
    const current = plan(workspaceId);
    if (
      current.members !== null &&
      usage(workspaceId).members >= current.members
    )
      throw problem(
        "This workspace has no team seats available. Ask the owner to review the hosted plan.",
        402,
      );
  };
  const assertWorkspaceCreate = (userId) => {
    if (
      enabled &&
      db
        .prepare("SELECT COUNT(*) n FROM workspaces WHERE owner_id=?")
        .get(userId).n >= (hosting.maxOwnedWorkspaces ?? 3)
    )
      throw problem(
        "This hosted account has reached its workspace creation limit. Contact the service operator.",
        402,
      );
  };
  const summary = (workspaceId) => ({
    hosted: enabled,
    currency: "INR",
    current: plan(workspaceId),
    usage: usage(workspaceId),
    plans: catalog(),
    checkoutAvailable: false,
    checkoutMessage:
      "Online checkout is not configured. No payment is collected by this installation.",
    maxOwnedWorkspaces: enabled ? (hosting.maxOwnedWorkspaces ?? 3) : null,
  });
  return {
    enabled,
    plan,
    usage,
    quota,
    assertCodeCreate,
    assertInvite,
    assertAccept,
    assertWorkspaceCreate,
    summary,
    catalog,
  };
}

export function registerPlanRoutes(app, db, entitlements) {
  app.get("/api/billing", (req, res) =>
    res.json(entitlements.summary(req.workspace.id)),
  );
}
export function registerPlanAdminRoutes(app, db, entitlements) {
  app.get("/api/operator/plans", (req, res) => {
    requireStaffAccess(db, req, "billing:manage");
    const q = z
        .string()
        .max(100)
        .parse(req.query.q || ""),
      page = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(req.query.page || 0),
      search = `%${q}%`;
    const rows = db
      .prepare(
        "SELECT id,name FROM workspaces WHERE name LIKE ? ORDER BY created_at DESC,id LIMIT 25 OFFSET ?",
      )
      .all(search, page * 25)
      .map((workspace) => ({
        ...workspace,
        ...entitlements.summary(workspace.id),
      }));
    res.json({
      rows,
      total: db
        .prepare("SELECT COUNT(*) n FROM workspaces WHERE name LIKE ?")
        .get(search).n,
      page,
      pageSize: 25,
      plans: entitlements.catalog(),
      hosted: entitlements.enabled,
      currency: "INR",
    });
  });
  app.post(
    "/api/operator/workspaces/:id/plan",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many password attempts. Try again later." },
    }),
    async (req, res) => {
      requireStaffAccess(db, req, "billing:manage");
      const input = z
        .object({
          tier: z.enum(hostedPlans.map((plan) => plan.id)),
          status: z.enum(["active", "trialing", "canceled"]).default("active"),
          password: z.string().min(1).max(128),
        })
        .parse(req.body);
      if (!entitlements.enabled)
        throw problem(
          "Hosted plan enforcement is disabled on this self-hosted installation.",
          409,
        );
      const user = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(req.user.id);
      if (!(await passwordMatches(input.password, user)))
        throw problem("The password is incorrect.", 403);
      requireStaffAccess(db, req, "billing:manage");
      atomic(db, () => {
        if (
          !db.prepare("SELECT id FROM workspaces WHERE id=?").get(req.params.id)
        )
          throw problem("Workspace not found.", 404);
        const before = entitlements.plan(req.params.id);
        db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES (?,?)").run(
          `subscription:${req.params.id}`,
          JSON.stringify({
            tier: input.tier,
            status: input.status,
            source: "manual",
            updatedAt: new Date().toISOString(),
          }),
        );
        audit(
          db,
          req.params.id,
          req.user.id,
          "workspace.plan_changed",
          req.params.id,
          {
            from: before.id,
            to: input.status === "canceled" ? "free" : input.tier,
            status: input.status,
            source: "manual",
          },
        );
      });
      res.json(entitlements.summary(req.params.id));
    },
  );
}
