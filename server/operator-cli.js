import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { setOperator, isOperator, operatorRole } from "./operator.js";
const args = process.argv.slice(2),
  operation = args[0],
  emailIndex = args.indexOf("--email");
let db;
try {
  if (
    !["grant", "revoke", "list"].includes(operation) ||
    (operation !== "list" && (emailIndex < 0 || !args[emailIndex + 1]))
  )
    throw new Error(
      "Usage: npm run operator -- grant|revoke --email owner@example.com (or: list)",
    );
  const path = resolve(process.env.DATA_DIR || "data", "openqr.sqlite");
  if (!existsSync(path))
    throw new Error(
      "OpenQR data was not found. Use the running installation DATA_DIR.",
    );
  db = new DatabaseSync(path);
  if (operation === "list")
    for (const user of db
      .prepare("SELECT id,name,email FROM users")
      .all()
      .filter((user) => isOperator(db, user.id)))
      console.log(
        `${user.name} <${user.email}> · ${operatorRole(db, user.id)}`,
      );
  else {
    const user = db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(args[emailIndex + 1].toLowerCase());
    if (!user) throw new Error("Account not found. Create the account first.");
    const roleIndex = args.indexOf("--role");
    setOperator(
      db,
      user.id,
      operation === "grant",
      roleIndex >= 0 ? args[roleIndex + 1] : "super_admin",
    );
    console.log(
      `Platform operator access ${operation === "grant" ? "granted" : "revoked"}. Refresh the application.`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
