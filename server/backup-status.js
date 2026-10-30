import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function readBackupStatus(directory) {
  if (!directory) return { state: "unavailable" };
  try {
    const value = JSON.parse(
      await readFile(join(directory, "backup-status.json"), "utf8"),
    );
    if (
      value.version !== 1 ||
      !["running", "succeeded", "failed"].includes(value.state)
    )
      throw new Error("Invalid backup status");
    const result = { state: value.state };
    for (const key of [
      "lastAttemptAt",
      "lastSuccessAt",
      "lastFailureAt",
      "localCompletedAt",
      "remoteCompletedAt",
    ])
      result[key] =
        typeof value[key] === "string" &&
        Number.isFinite(Date.parse(value[key]))
          ? value[key]
          : null;
    result.failureStage = ["snapshot", "remote"].includes(value.failureStage)
      ? value.failureStage
      : null;
    return result;
  } catch (error) {
    return { state: error.code === "ENOENT" ? "never" : "unavailable" };
  }
}

export async function writeBackupStatus(directory, status) {
  const temporary = join(directory, `.backup-status-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, ...status }), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, join(directory, "backup-status.json"));
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
