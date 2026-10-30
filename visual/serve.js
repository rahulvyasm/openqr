// Starts OpenQR on an empty throwaway data folder for the visual tests.
import { rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const port = process.env.VISUAL_PORT || "3210";
const dataDir = resolve(".visual-data");
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const child = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    BACKUP_INTERVAL_HOURS: "0",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
