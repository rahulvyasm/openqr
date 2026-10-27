import { useState } from "react";
import Papa from "papaparse";
import { Download, Loader2, Pause, Play, Trash2, X } from "lucide-react";
import { api, downloadBatch, saveBlob, type Code, type Folder } from "../lib";
import Modal from "./Modal";
export default function BatchBar({
  ids,
  codes,
  folders,
  onClear,
  onDone,
  notify,
}: {
  ids: string[];
  codes: Code[];
  folders: Folder[];
  onClear: () => void;
  onDone: () => void;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [error, setError] = useState(""),
    [format, setFormat] = useState<"svg" | "png">("svg");
  async function action(action: string, folderId?: string | null) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ affected: number }>("/codes/batch", {
        ids,
        action,
        folderId,
      });
      setConfirmDelete(false);
      onDone();
      notify(
        `${result.affected} code${result.affected === 1 ? "" : "s"} ${action === "pause" ? "paused" : action === "resume" ? "resumed" : action === "move" ? "moved" : "deleted"}.`,
      );
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="batch-bar">
      <label>
        <span className="selected-count">{ids.length}</span>selected
      </label>
      <div className="batch-actions">
        <select
          aria-label="Move selected codes to folder"
          value=""
          disabled={busy}
          onChange={(e) =>
            action("move", e.target.value === "none" ? null : e.target.value)
          }
        >
          <option value="" disabled>
            Move to folder…
          </option>
          <option value="none">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          title="Pause selected dynamic links"
          aria-label="Pause selected dynamic links"
          disabled={busy}
          onClick={() => action("pause")}
        >
          <Pause size={15} />
        </button>
        <button
          title="Resume selected dynamic links"
          aria-label="Resume selected dynamic links"
          disabled={busy}
          onClick={() => action("resume")}
        >
          <Play size={15} />
        </button>
        <span className="batch-divider" />
        <select
          aria-label="Batch download format"
          value={format}
          disabled={busy}
          onChange={(e) => setFormat(e.target.value as "svg" | "png")}
        >
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
        </select>
        <button
          className="batch-download"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadBatch(ids, format);
              notify("Your QR collection is ready.");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          <span>ZIP</span>
        </button>
        <button
          title="Export selected code information as CSV"
          onClick={() => {
            const rows = codes
              .filter((c) => ids.includes(c.id))
              .map((c) => ({
                name: c.name,
                type: c.type,
                dynamic: c.dynamic,
                short_url: c.dynamic ? c.shortUrl : "",
                destination: c.type === "url" ? c.data.url : "",
                scans: c.scans,
              }));
            saveBlob(
              new Blob([Papa.unparse(rows, { escapeFormulae: true })], {
                type: "text/csv",
              }),
              "openqr-code-information.csv",
            );
          }}
        >
          CSV
        </button>
        <button
          aria-label="Delete selected codes"
          className="danger"
          disabled={busy}
          onClick={() => {
            setError("");
            setConfirmDelete(true);
          }}
        >
          <Trash2 size={15} />
        </button>
        <button
          title="Clear selection"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X size={16} />
        </button>
      </div>
      {confirmDelete && (
        <Modal
          title={`Delete ${ids.length} QR codes?`}
          onClose={() => setConfirmDelete(false)}
        >
          <div className="simple-form">
            <p>
              These codes and their scan history will be permanently deleted.
              Printed dynamic QR codes will stop working. Printed static codes
              keep their original content.
            </p>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Keep them
              </button>
              <button
                className="button danger-button"
                disabled={busy}
                onClick={() => action("delete")}
              >
                Delete {ids.length} codes
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
