// Deploys the hosted Edge Function and applies the branded auth emails.
// Needs a Supabase personal access token in SUPABASE_ACCESS_TOKEN; it is only
// sent to api.supabase.com and is never printed.
//   npm run build:hosted && npm run deploy:supabase
//   npm run deploy:supabase -- --dry-run
import { readFileSync } from "node:fs";
const ref = "abicsqdzzocayiquvepy";
const api = `https://api.supabase.com/v1/projects/${ref}`;
const dry = process.argv.includes("--dry-run");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!dry && !token)
  throw new Error("Set SUPABASE_ACCESS_TOKEN to a Supabase access token.");
const read = (path) => readFileSync(path, "utf8");

async function call(path, init) {
  const response = await fetch(api + path, {
    ...init,
    headers: { Authorization: "Bearer " + token, ...init.headers },
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${init.method} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function deployFunction() {
  const payload = JSON.parse(read(".hosted-build/edge-payload.json"));
  console.log(`Edge Function: ${payload.files.length} files, entry ${payload.entrypoint_path}`);
  if (dry) return;
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      name: "openqr-api",
      entrypoint_path: payload.entrypoint_path,
      import_map_path: payload.import_map_path,
      // The function checks the gateway token, origin and session itself.
      verify_jwt: false,
    }),
  );
  for (const file of payload.files)
    form.append("file", new Blob([file.content], { type: "application/octet-stream" }), file.name);
  const result = await call("/functions/deploy?slug=openqr-api", { method: "POST", body: form });
  console.log(`Deployed openqr-api version ${result?.version ?? "?"}`);
}

async function applyAuth() {
  const settings = {
    mailer_subjects_confirmation: "Confirm your OpenQR account",
    mailer_templates_confirmation_content: read("supabase/templates/confirm-signup.html"),
    mailer_subjects_recovery: "Reset your OpenQR password",
    mailer_templates_recovery_content: read("supabase/templates/reset-password.html"),
    // Two-step sign-in with an authenticator app.
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };
  console.log(`Auth: ${Object.keys(settings).join(", ")}`);
  if (dry) return;
  await call("/config/auth", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  console.log("Auth emails and two-step sign-in applied.");
}

if (!only || only === "function") await deployFunction();
if (!only || only === "auth") await applyAuth();
if (dry) console.log("Dry run: nothing was sent.");
