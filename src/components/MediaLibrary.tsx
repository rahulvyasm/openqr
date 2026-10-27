import { useEffect, useState } from "react";
import {
  FileText,
  ImagePlus,
  Upload,
  Trash2,
  Download,
  Search,
  Loader2,
  Check,
} from "lucide-react";
import { api, type Asset } from "../lib";
import Modal from "./Modal";

const sizeLabel = (size: number) =>
  size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
export async function uploadAsset(file: File, kind?: "logo"): Promise<Asset> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a file smaller than 20 MB.");
  const res = await fetch(`/api/assets${kind ? "?kind=logo" : ""}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not upload this file.");
  return data;
}
export function AssetBrowser({
  canEdit = true,
  filter,
  onSelect,
}: {
  canEdit?: boolean;
  filter?: "pdf" | "image" | "logo";
  onSelect?: (asset: Asset) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const load = () =>
    api<Asset[]>("/assets")
      .then(setAssets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);
  const visible = assets.filter(
    (a) =>
      (!filter || (filter === "pdf" ? a.kind === "pdf" : a.kind !== "pdf")) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
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
            {busy ? "Uploading…" : "Upload file"}
            <input
              type="file"
              disabled={busy}
              accept={
                filter === "pdf"
                  ? "application/pdf"
                  : filter
                    ? "image/png,image/jpeg"
                    : "application/pdf,image/png,image/jpeg"
              }
              aria-label="Upload media file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const asset = await uploadAsset(
                    file,
                    filter === "logo" ? "logo" : undefined,
                  );
                  await load();
                  if (
                    filter &&
                    (filter === "pdf"
                      ? asset.kind !== "pdf"
                      : asset.kind === "pdf")
                  )
                    throw new Error(
                      filter === "pdf"
                        ? "Choose a PDF for this page."
                        : "Choose a PNG or JPEG image.",
                    );
                  onSelect?.(asset);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        )}
      </div>
      <p className="hint">
        PDF, PNG, or JPEG · Up to 20 MB. Files belong to this workspace. Images
        are optimized on upload.
      </p>
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
          {visible.map((asset) => (
            <article className="asset-card" key={asset.id}>
              <button
                type="button"
                className="asset-select"
                disabled={!onSelect}
                onClick={() => onSelect?.(asset)}
                aria-label={`Select ${asset.name}`}
              >
                <div
                  className={`asset-preview ${asset.kind === "pdf" ? "pdf" : ""}`}
                >
                  {asset.kind === "pdf" ? (
                    <>
                      <FileText size={35} />
                      <span>PDF</span>
                    </>
                  ) : (
                    <img src={asset.url} alt={asset.name} />
                  )}
                </div>
                <strong>{asset.name}</strong>
                <small>
                  {asset.kind === "pdf"
                    ? `${asset.pages} ${asset.pages === 1 ? "page" : "pages"} · `
                    : ""}
                  {sizeLabel(asset.size)}
                  {asset.kind === "logo" ? " · Logo" : ""}
                </small>
                {onSelect && (
                  <span className="asset-choose">
                    <Check size={13} />
                    Use file
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
                        !confirm(`Remove “${asset.name}” from this workspace?`)
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
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <ImagePlus size={32} />
          <h3>
            {search ? "No matching files." : "Your next page starts here."}
          </h3>
          <p>
            Upload a document, portrait, cover image, or logo to use across your
            QR codes.
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
}: {
  filter: "pdf" | "image" | "logo";
  onSelect: (asset: Asset) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      wide
      title={
        filter === "pdf"
          ? "Choose a document."
          : filter === "logo"
            ? "Choose your logo."
            : "Choose an image."
      }
      onClose={onClose}
    >
      <div className="asset-modal-body">
        <AssetBrowser
          filter={filter}
          onSelect={(asset) => {
            onSelect(asset);
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}
export default function MediaLibrary({ canEdit }: { canEdit: boolean }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A HOME FOR YOUR CONTENT</span>
          <h1>
            Your media library<span>.</span>
          </h1>
          <p>One upload. A world of possibilities.</p>
        </div>
      </div>
      <section className="media-library">
        <AssetBrowser canEdit={canEdit} />
      </section>
    </>
  );
}
