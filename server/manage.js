import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { issueRecovery } from "./auth.js";
const args = process.argv.slice(2),
  emailIndex = args.indexOf("--email");
if (emailIndex < 0 || !args[emailIndex + 1]) {
  console.error("Usage: npm run recover -- --email owner@example.com");
  process.exitCode = 1;
} else {
  const dir = resolve(process.env.DATA_DIR || "data");
  mkdirSync(dir, { recursive: true });
  const { db } = createApp({
    dbPath: resolve(dir, "openqr.sqlite"),
    publicUrl: process.env.PUBLIC_URL || "http://localhost:5173",
  });
  try {
    const url = issueRecovery(
      db,
      args[emailIndex + 1],
      process.env.PUBLIC_URL || "http://localhost:5173",
    );
    console.log(
      "One-time password recovery link (expires in 30 minutes):\n" +
        url +
        "\nShare privately with the account owner. This link grants password-reset access.",
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
