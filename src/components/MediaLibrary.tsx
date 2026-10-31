import { useEffect, useRef, useState } from "react";
import {
  FileText,
  ImagePlus,
  Upload,
  Trash2,
  Download,
  Search,
  Loader2,
  Check,
  Music,
  Video,
  X,
} from "lucide-react";
import { api, demoHooks, type Asset } from "../lib";
import Modal from "./Modal";
export type AssetFilter = "pdf" | "image" | "logo" | "audio" | "video";
export type StorageSummary = {
  usedBytes: number;
  limitBytes: number;
  maxUploadBytes: number;
  backend: string;
};
const sizeLabel = (size: number) =>
  size === Number.MAX_SAFE_INTEGER ? "No plan cap" : size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
const matches = (asset: Asset, filter?: AssetFilter) =>
  !filter ||
  (["image", "logo"].includes(filter)
    ? ["image", "logo"].includes(asset.kind)
    : asset.kind === filter);
export async function uploadAsset(
  file: File,
  kind?: "logo",
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  if (demoHooks.upload) return demoHooks.upload(file, kind);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/assets${kind ? "?kind=logo" : ""}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("The upload could not reach the server."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new Error("Upload cancelled."));
    };
    xhr.onload = () => {
      cleanup();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("The server could not accept this file."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        if (xhr.status === 403)
          window.dispatchEvent(new Event("permissions-changed"));
        reject(new Error(data.error || "Could not upload this file."));
      }
    };
    if (signal?.aborted) {
      reject(new Error("Upload cancelled."));
      return;
    }
    xhr.send(file);
  });
}
export function AssetBrowser({
  canEdit = true,
  filter,
  onSelect,
  multiple = false,
  selected = [],
}: {
  canEdit?: boolean;
  filter?: AssetFilter;
  onSelect?: (asset: Asset) => void;
  multiple?: boolean;
  selected?: string[];
}) {
  const [assets, setAssets] = useState<Asset[]>([]),
    [summary, setSummary] = useState<StorageSummary | null>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const load = async () => {
    try {
      const [files, storage] = await Promise.all([
        api<Asset[]>("/assets"),
        api<StorageSummary>("/storage"),
      ]);
      setAssets(files);
      setSummary(storage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, []);
  const visible = assets.filter(
    (a) =>
      matches(a, filter) && a.name.toLowerCase().includes(search.toLowerCase()),
  );
  const accept =
    filter === "pdf"
      ? "application/pdf"
      : filter === "audio"
        ? "audio/mpeg"
        : filter === "video"
          ? "video/mp4,video/webm"
          : filter
            ? "image/png,image/jpeg"
            : "application/pdf,image/png,image/jpeg,audio/mpeg,video/mp4,video/webm";
  return (
    <div className="asset-browser">
      <div className="media-toolbar">
        <div className="media-search">
          <Search size={16} />
          <input
            aria-label="Search files"
            placeholder="Find a file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canEdit && (
          <label
            className={`button primary small upload-button ${busy ? "busy" : ""}`}
          >
            <Upload size={15} />
            {busy ? `${progress}%` : "Upload file"}
            <input
              type="file"
              multiple={multiple || !onSelect}
              disabled={busy}
              accept={accept}
              aria-label="Upload media file"
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (!files.length) return;
                setBusy(true);
                setError("");
                abort.current = new AbortController();
                try {
                  for (const file of files) {
                    setProgress(0);
                    if (
                      file.size > (summary?.maxUploadBytes || 100 * 1024 * 1024)
                    )
                      throw new Error(
                        `Choose a file smaller than ${sizeLabel(summary?.maxUploadBytes || 100 * 1024 * 1024)}.`,
                      );
                    const asset = await uploadAsset(
                      file,
                      filter === "logo" ? "logo" : undefined,
                      setProgress,
                      abort.current.signal,
                    );
                    if (!matches(asset, filter))
                      throw new Error("Choose a file matching this page type.");
                    onSelect?.(asset);
                  }
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                  await load();
                } finally {
                  setBusy(false);
                  abort.current = null;
                }
              }}
            />
          </label>
        )}
        {busy && (
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel upload"
            onClick={() => abort.current?.abort()}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <p className="hint">
        PDF, PNG, JPEG · 20 MB. MP3, MP4, WebM ·{" "}
        {sizeLabel(summary?.maxUploadBytes || 100 * 1024 * 1024)}. Files belong
        to this workspace.
      </p>
      {summary && (
        <div className="storage-usage">
          <span>
            {sizeLabel(summary.usedBytes)} used · {summary.limitBytes === Number.MAX_SAFE_INTEGER
              ? "No plan cap" : `${sizeLabel(summary.limitBytes)} available`}
          </span>
          <span>
            {summary.backend === "s3" ? "Object storage" : "Local storage"}
          </span>
          {summary.limitBytes !== Number.MAX_SAFE_INTEGER && <progress
            aria-label="Workspace storage used"
            value={summary.usedBytes}
            max={summary.limitBytes}
          />}
        </div>
      )}
      {busy && (
        <p className="upload-status" role="status">
          {progress < 100
            ? `Uploading · ${progress}%`
            : "Checking and saving your file…"}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="media-empty">
          <Loader2 className="spin" />
          Loading your library…
        </div>
      ) : visible.length ? (
        <div className="asset-grid">
          {visible.map((asset) => {
            const Icon =
              asset.kind === "audio"
                ? Music
                : asset.kind === "video"
                  ? Video
                  : FileText;
            return (
              <article
                className={`asset-card ${selected.includes(asset.id) ? "selected" : ""}`}
                key={asset.id}
              >
                <button
                  type="button"
                  className="asset-select"
                  disabled={!onSelect}
                  onClick={() => onSelect?.(asset)}
                  aria-label={`Select ${asset.name}`}
                  aria-pressed={
                    multiple ? selected.includes(asset.id) : undefined
                  }
                >
                  <div
                    className={`asset-preview ${!["image", "logo"].includes(asset.kind) ? "pdf" : ""}`}
                  >
                    {["image", "logo"].includes(asset.kind) ? (
                      <img src={asset.url} alt={asset.name} />
                    ) : (
                      <>
                        <Icon size={35} />
                        <span>{asset.kind.toUpperCase()}</span>
                      </>
                    )}
                  </div>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.kind === "pdf"
                      ? `${asset.pages} ${asset.pages === 1 ? "page" : "pages"} · `
                      : ""}
                    {sizeLabel(asset.size)}
                    {asset.metadata.duration
                      ? ` · ${Math.floor(asset.metadata.duration / 60)}:${String(Math.floor(asset.metadata.duration % 60)).padStart(2, "0")}`
                      : ""}
                    {asset.kind === "logo" ? " · Logo" : ""}
                  </small>
                  {onSelect && (
                    <span className="asset-choose">
                      <Check size={13} />
                      {selected.includes(asset.id)
                        ? "Selected"
                        : multiple
                          ? "Select file"
                          : "Use file"}
                    </span>
                  )}
                </button>
                <div className="asset-actions">
                  <a
                    href={asset.url}
                    download={asset.name}
                    className="text-button"
                    aria-label={`Download ${asset.name}`}
                  >
                    <Download size={13} />
                    Download
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${asset.name}`}
                      onClick={async () => {
                        if (
                          !confirm(
                            `Remove “${asset.name}” from this workspace?`,
                          )
                        )
                          return;
                        try {
                          await api(`/assets/${asset.id}`, undefined, "DELETE");
                          await load();
                          setError("");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="media-empty">
          <ImagePlus size={32} />
          <h3>
            {search ? "No matching files." : "Your next page starts here."}
          </h3>
          <p>
            Upload a document, image, audio file, video, or logo to use across
            your QR codes.
          </p>
        </div>
      )}
    </div>
  );
}
export function AssetPicker({
  filter,
  onSelect,
  onClose,
  multiple = false,
  onSelectMany,
}: {
  filter: AssetFilter;
  onSelect?: (asset: Asset) => void;
  onClose: () => void;
  multiple?: boolean;
  onSelectMany?: (assets: Asset[]) => void;
}) {
  const [selected, setSelected] = useState<Asset[]>([]);
  return (
    <Modal
      wide
      title={
        filter === "pdf"
          ? "Choose a document."
          : filter === "logo"
            ? "Choose your logo."
            : filter === "audio"
              ? "Choose your audio."
              : filter === "video"
                ? "Choose your video."
                : multiple
                  ? "Choose your images."
                  : "Choose an image."
      }
      onClose={onClose}
    >
      <div className="asset-modal-body">
        <AssetBrowser
          filter={filter}
          multiple={multiple}
          selected={selected.map((a) => a.id)}
          onSelect={(asset) => {
            if (multiple)
              setSelected((current) =>
                current.some((a) => a.id === asset.id)
                  ? current.filter((a) => a.id !== asset.id)
                  : [...current, asset],
              );
            else {
              onSelect?.(asset);
              onClose();
            }
          }}
        />
      </div>
      {multiple && (
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!selected.length}
            onClick={() => {
              onSelectMany?.(selected);
              onClose();
            }}
          >
            Add {selected.length} images
          </button>
        </div>
      )}
    </Modal>
  );
}
export default function MediaLibrary({ canEdit }: { canEdit: boolean }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR CONTENT, IN GOOD COMPANY</span>
          <h1>
            Your media library<span>.</span>
          </h1>
          <p>Documents, images, and media. Ready for your next connection.</p>
        </div>
      </div>
      <section className="media-library">
        <AssetBrowser canEdit={canEdit} />
      </section>
    </>
  );
}
