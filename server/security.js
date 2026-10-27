import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
const modernOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export const problem = (message, status = 400) =>
  Object.assign(new Error(message), { domain: true, status });
export function atomic(db, fn) {
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
export async function passwordHash(password) {
  const salt = "s2$" + randomBytes(16).toString("hex");
  return {
    salt,
    hash: (await derive(password, salt, 64, modernOptions)).toString("hex"),
  };
}
export async function passwordMatches(password, user) {
  const salt = user?.salt || "s2$invalid-account-salt";
  const hash = salt.startsWith("s2$")
    ? await derive(password, salt, 64, modernOptions)
    : await derive(password, salt, 64);
  return !!user && timingSafeEqual(hash, Buffer.from(user.password, "hex"));
}
export function audit(
  db,
  workspaceId,
  actorId,
  event,
  subject = "",
  details = {},
) {
  if (workspaceId)
    db.prepare(
      "INSERT INTO audit_events (workspace_id,actor_id,event,subject,details,created_at) VALUES (?,?,?,?,?,?)",
    ).run(
      workspaceId,
      actorId,
      event,
      subject,
      JSON.stringify(details),
      new Date().toISOString(),
    );
}
export const canEdit = (role) => ["owner", "admin", "editor"].includes(role);
export const canManage = (role) => ["owner", "admin"].includes(role);
export function access(db, userId, workspaceId, level = "read") {
  const row = db
    .prepare(
      "SELECT w.id,w.name,w.owner_id AS ownerId,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?",
    )
    .get(workspaceId, userId);
  if (
    !row ||
    (level === "edit" && !canEdit(row.role)) ||
    (level === "manage" && !canManage(row.role)) ||
    (level === "owner" && row.role !== "owner")
  )
    throw problem("You do not have permission for this workspace action.", 403);
  return row;
}
export function sessionLabel(req) {
  const ua = req.get("user-agent") || "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome|CriOS/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
