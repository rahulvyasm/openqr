import { useEffect, useState } from "react";
import { Database, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../lib";

type Storage = {
  usedBytes: number;
  limitBytes: number;
  maxUploadBytes: number;
  backend: string;
};
type Backup = {
  state: "never" | "unavailable" | "running" | "succeeded" | "failed";
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  localCompletedAt?: string | null;
  remoteCompletedAt?: string | null;
  failureStage?: "snapshot" | "remote" | null;
  intervalHours: number | null;
  retention: number | null;
  remoteEnabled: boolean;
};
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GB`
    : `${(value / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "None recorded";

export default function StorageStatus({ manager }: { manager: boolean }) {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [storageError, setStorageError] = useState("");
  const [backupError, setBackupError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    function load() {
      api<Storage>("/storage")
        .then((value) => {
          if (active) {
            setStorage(value);
            setStorageError("");
          }
        })
        .catch(() => {
          if (active) setStorageError("Storage usage could not be refreshed.");
        });
      if (manager)
        api<Backup>("/backups/status")
          .then((value) => {
            if (active) {
              setBackup(value);
              setBackupError("");
            }
          })
          .catch(() => {
            if (active) setBackupError("Backup status could not be refreshed.");
          });
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [manager, refresh]);
  const ratio = storage ? storage.usedBytes / storage.limitBytes : 0;
  return (
    <section className="settings-panel">
      <div className="settings-panel-heading">
        <div>
          <h2>Storage and backups</h2>
          <p>Usage for this workspace. Updated every 30 seconds.</p>
        </div>
        <Database size={21} />
      </div>
      <button
        className="button small"
        type="button"
        onClick={() => setRefresh((value) => value + 1)}
      >
        <RefreshCw size={15} />
        Refresh status
      </button>
      {storageError && (
        <p className="form-error" role="alert">
          {storageError} Any values shown are from the last successful refresh.
        </p>
      )}
      {storage ? (
        <>
          <div className="storage-usage">
            <span>
              {bytes(storage.usedBytes)} of {bytes(storage.limitBytes)} used ·{" "}
              {Math.round(ratio * 100)}%
            </span>
            <span>
              {storage.backend === "s3" ? "Object storage" : "Local storage"}
            </span>
            <progress
              aria-label="Workspace storage used"
              value={Math.min(storage.usedBytes, storage.limitBytes)}
              max={storage.limitBytes}
            />
          </div>
          <p className="hint">
            Maximum upload: {bytes(storage.maxUploadBytes)}. File types may have
            smaller limits. Backups are stored separately and do not count
            toward this quota.
          </p>
          {ratio >= 0.8 && (
            <div className="info-note amber" role="status">
              <p>
                {ratio >= 1
                  ? "Your workspace has reached its storage limit."
                  : "Your workspace is close to its storage limit."}{" "}
                Remove unused media or ask the server operator for more space.
              </p>
            </div>
          )}
        </>
      ) : (
        !storageError && <p role="status">Loading storage usage…</p>
      )}
      {manager && (
        <>
          <h3>Instance backups</h3>
          <p className="hint">
            Backups cover all workspaces on this installation. The server
            operator manages backups and restores.
          </p>
          {backupError && (
            <p className="form-error" role="alert">
              {backupError} Any values shown are from the last successful
              refresh.
            </p>
          )}
          {backup ? (
            <>
              <dl>
                <dt>Latest result</dt>
                <dd>
                  {
                    {
                      never: "No backup recorded",
                      unavailable: "Status unavailable",
                      running: "Backup started; completion not recorded",
                      succeeded: "Completed",
                      failed: "Failed",
                    }[backup.state]
                  }
                </dd>
                <dt>Automatic backups</dt>
                <dd>
                  {backup.intervalHours === null
                    ? "Schedule unavailable"
                    : backup.intervalHours === 0
                      ? "Disabled"
                      : `Every ${backup.intervalHours} hours of uptime`}
                </dd>
                <dt>Local retention</dt>
                <dd>
                  {backup.retention === null
                    ? "Unavailable"
                    : `${backup.retention} archives`}
                </dd>
                <dt>Last attempt</dt>
                <dd>{when(backup.lastAttemptAt)}</dd>
                <dt>Last completed backup</dt>
                <dd>{when(backup.lastSuccessAt)}</dd>
                <dt>Last local archive</dt>
                <dd>{when(backup.localCompletedAt)}</dd>
                <dt>Off-server copies</dt>
                <dd>
                  {backup.remoteEnabled ? "Configured" : "Not configured"}
                </dd>
                {backup.remoteEnabled && (
                  <>
                    <dt>Last off-server copy</dt>
                    <dd>{when(backup.remoteCompletedAt)}</dd>
                  </>
                )}
                {backup.lastFailureAt && (
                  <>
                    <dt>Last failure</dt>
                    <dd>{when(backup.lastFailureAt)}</dd>
                  </>
                )}
              </dl>
              {backup.state !== "succeeded" && (
                <div className="info-note amber" role="status">
                  <ShieldCheck size={18} />
                  <p>
                    {backup.state === "failed"
                      ? backup.failureStage === "remote"
                        ? "The off-server copy failed. A local archive was created; ask the server operator to check the backup destination and retry."
                        : "The backup did not complete. Ask the server operator to check the backup logs and retry."
                      : backup.state === "running"
                        ? "The last attempt may still be running or may have been interrupted. Ask the server operator to check if completion is not recorded."
                        : backup.state === "never"
                          ? "No backup has been recorded here. Ask the server operator to create one and rehearse recovery."
                          : "Backup status cannot be read. Ask the server operator to check the backup directory."}
                  </p>
                </div>
              )}
              <p className="hint">
                Recorded results do not verify that archives still exist or that
                recovery has been rehearsed. Automatic timing restarts with the
                server.
              </p>
            </>
          ) : (
            !backupError && <p role="status">Loading backup status…</p>
          )}
        </>
      )}
    </section>
  );
}
