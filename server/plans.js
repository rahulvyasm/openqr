import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { hostedPlans, canonicalTier } from "../shared/plans.js";
import { atomic, audit, passwordMatches, problem } from "./security.js";
import { requireStaffAccess } from "./operator.js";
import { accountAccess } from "./account-access.js";

export function createEntitlements(db, storage, hosting = {}) {
  const enabled = !!hosting.enabled;
  const catalog = () =>
    hostedPlans.map((plan) => ({
      ...plan,
      monthlyINR: null,
      available: plan.id === "free",
    }));
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
    const owner = db
      .prepare("SELECT owner_id FROM workspaces WHERE id=?")
      .get(workspaceId);
    const grant = owner ? accountAccess(db, owner.owner_id) : null;
    const saved = grant || record(workspaceId),
      effective =
        saved && ["active", "trialing"].includes(saved.status)
          ? canonicalTier(saved.tier)
          : "free";
    const tier =
      effective === "unlimited"
        ? {
            id: "unlimited",
            name: "Unlimited",
            codes: null,
            members: null,
            storageBytes: Number.MAX_SAFE_INTEGER,
          }
        : hostedPlans.find((plan) => plan.id === effective) || hostedPlans[0];
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
    if (accountAccess(db, userId)?.tier === "unlimited") return;
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
  const summary = (workspaceId) => {
    const current = plan(workspaceId);
    return {
      hosted: enabled,
      currency: "INR",
      current,
      usage: usage(workspaceId),
      plans: catalog(),
      checkoutAvailable: false,
      checkoutMessage:
        "Free is available now. Plus and Pro are coming soon. Access can be granted by the service administrator.",
      maxOwnedWorkspaces:
        enabled && current.id !== "unlimited"
          ? (hosting.maxOwnedWorkspaces ?? 3)
          : null,
    };
  };
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
    const role = requireStaffAccess(db, req, "billing:manage");
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
        "SELECT w.id,w.name,w.owner_id AS ownerId,u.name AS ownerName FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.name LIKE ? OR u.name LIKE ? ORDER BY w.created_at DESC,w.id LIMIT 25 OFFSET ?",
      )
      .all(search, search, page * 25)
      .map((workspace) => ({
        ...workspace,
        ...entitlements.summary(workspace.id),
        accountAccess: accountAccess(db, workspace.ownerId),
      }));
    res.json({
      rows,
      total: db
        .prepare(
          "SELECT COUNT(*) n FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.name LIKE ? OR u.name LIKE ?",
        )
        .get(search, search).n,
      page,
      pageSize: 25,
      plans: entitlements.catalog(),
      hosted: entitlements.enabled,
      currency: "INR",
      canGrantAccountAccess: role === "super_admin",
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
          tier: z
            .enum(["free", "plus", "pro", "creator", "business"])
            .transform(canonicalTier),
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
        const owner = db
          .prepare("SELECT owner_id FROM workspaces WHERE id=?")
          .get(req.params.id);
        if (accountAccess(db, owner.owner_id))
          throw problem(
            "This workspace follows an account grant. A Super Admin must change or remove that grant first.",
            409,
          );
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
