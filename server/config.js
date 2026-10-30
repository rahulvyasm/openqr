import { resolve, parse } from "node:path";
import { storageOptionsFromEnv } from "./object-store.js";

function integer(env, name, fallback, min, max) {
  const raw = env[name] ?? String(fallback);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < min ||
    Number(raw) > max
  )
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(raw);
}

function flag(env, name, fallback, yes = "true", no = "false") {
  const raw = env[name] ?? fallback;
  if (raw !== yes && raw !== no)
    throw new Error(`${name} must be ${yes} or ${no}.`);
  return raw === yes;
}

function notificationsFromEnv(env) {
  const smtpUrl = env.SMTP_URL?.trim() || "",
    webhookUrl = env.SUPPORT_WEBHOOK_URL?.trim() || "",
    staffEmails = (env.SUPPORT_ALERT_EMAIL || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  if (smtpUrl && !/^smtps?:\/\//.test(smtpUrl))
    throw new Error("SMTP_URL must start with smtp:// or smtps://.");
  if (webhookUrl && !/^https?:\/\//.test(webhookUrl))
    throw new Error("SUPPORT_WEBHOOK_URL must be an http(s) URL.");
  if (staffEmails.some((value) => !/^[^\s@]+@[^\s@]+$/.test(value)))
    throw new Error("SUPPORT_ALERT_EMAIL must list email addresses.");
  if (staffEmails.length && !smtpUrl)
    throw new Error("SUPPORT_ALERT_EMAIL requires SMTP_URL.");
  const webhookSecret = env.SUPPORT_WEBHOOK_SECRET?.trim() || "";
  if (webhookSecret && !webhookUrl)
    throw new Error("SUPPORT_WEBHOOK_SECRET requires SUPPORT_WEBHOOK_URL.");
  if (webhookSecret && webhookSecret.length < 16)
    throw new Error("SUPPORT_WEBHOOK_SECRET must be at least 16 characters.");
  return {
    smtpUrl,
    webhookUrl,
    webhookSecret,
    staffEmails,
    from: env.SMTP_FROM?.trim() || "",
  };
}

// Validate everything before creating directories, opening SQLite or listening.
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const rawUrl = env.PUBLIC_URL ?? (production ? "" : "http://localhost:5173");
  let url;
  try {
    if (!/^https?:\/\/[^/\\?#\s]+\/?$/.test(rawUrl)) throw new Error();
    url = new URL(rawUrl);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      ["0.0.0.0", "[::]"].includes(url.hostname)
    )
      throw new Error();
  } catch {
    throw new Error(
      "PUBLIC_URL must be an explicit HTTP(S) origin without credentials, a path, query or fragment.",
    );
  }
  const secureCookie = flag(env, "COOKIE_SECURE", "false");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (production && !loopback && url.protocol !== "https:")
    throw new Error(
      "PUBLIC_URL must use HTTPS in production; loopback HTTP is allowed for local testing.",
    );
  if (production && url.protocol === "https:" && !secureCookie)
    throw new Error(
      "COOKIE_SECURE must be true for HTTPS production deployments.",
    );
  if (secureCookie && url.protocol !== "https:")
    throw new Error("COOKIE_SECURE=true requires an HTTPS PUBLIC_URL.");
  const dataDir = resolve(env.DATA_DIR ?? "data");
  if (env.DATA_DIR?.trim() === "" || dataDir === parse(dataDir).root)
    throw new Error("DATA_DIR must name a dedicated data directory.");
  const host = env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
  if (!host || /\s|[\/@?#]/.test(host))
    throw new Error("HOST must be a bind address or hostname.");
  const backupHours = Number(env.BACKUP_INTERVAL_HOURS ?? 24);
  if (
    env.BACKUP_INTERVAL_HOURS?.trim() === "" ||
    !Number.isFinite(backupHours) ||
    backupHours < 0 ||
    backupHours > 576
  )
    throw new Error("BACKUP_INTERVAL_HOURS must be a number from 0 to 576.");
  return {
    port: integer(env, "PORT", 3001, 1, 65535),
    host,
    dataDir,
    publicUrl: url.origin,
    secureCookie,
    trustProxy: flag(env, "TRUST_PROXY", "0", "1", "0"),
    backupHours,
    retention: integer(env, "BACKUP_RETENTION", 7, 1, Number.MAX_SAFE_INTEGER),
    hosting: {
      enabled: flag(env, "HOSTED_MODE", "false"),
      maxOwnedWorkspaces: integer(
        env,
        "HOSTED_MAX_OWNED_WORKSPACES",
        3,
        1,
        10000,
      ),
      creatorINR:
        env.PLAN_CREATOR_MONTHLY_INR === undefined
          ? null
          : integer(env, "PLAN_CREATOR_MONTHLY_INR", 0, 1, 10000000),
      businessINR:
        env.PLAN_BUSINESS_MONTHLY_INR === undefined
          ? null
          : integer(env, "PLAN_BUSINESS_MONTHLY_INR", 0, 1, 10000000),
    },
    storageOptions: storageOptionsFromEnv(env),
    notifications: notificationsFromEnv(env),
    logRequests: flag(env, "LOG_REQUESTS", production ? "true" : "false"),
  };
}
