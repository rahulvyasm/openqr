import { useEffect, useState } from "react";
import { ImagePlus, FileText, Plus, Trash2, X } from "lucide-react";
import { api, type Asset, type CodeType, type PageOptions } from "../lib";
import { AssetPicker } from "./MediaLibrary";
type Props = {
  type: CodeType;
  data: Record<string, string>;
  onData: (key: string, value: string) => void;
  options: PageOptions;
  onOptions: (options: PageOptions) => void;
};
const platforms = [
  "website",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "x",
  "github",
];
export default function PublishingFields({
  type,
  data,
  onData,
  options,
  onOptions,
}: Props) {
  const [picker, setPicker] = useState<
      "pdfId" | "portraitId" | "coverId" | null
    >(null),
    [assets, setAssets] = useState<Asset[]>([]);
  const load = () =>
    api<Asset[]>("/assets")
      .then(setAssets)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const field = (
    key: string,
    label: string,
    inputType = "text",
    required = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={inputType}
        value={data[key] || ""}
        maxLength={
          key === "address"
            ? 300
            : key === "website"
              ? 2000
              : key === "email"
                ? 254
                : key === "phone"
                  ? 30
                  : 100
        }
        required={required}
        onChange={(e) => onData(key, e.target.value)}
        placeholder={key === "website" ? "https://example.com" : undefined}
      />
    </label>
  );
  const media = (key: "pdfId" | "portraitId" | "coverId", label: string) => {
    const a = assets.find((a) => a.id === data[key]);
    return (
      <div className="publishing-media">
        <button
          type="button"
          onClick={() => setPicker(key)}
          className="media-choice"
        >
          {a && key !== "pdfId" ? (
            <img src={a.url} alt="" />
          ) : key === "pdfId" ? (
            <FileText size={23} />
          ) : (
            <ImagePlus size={23} />
          )}
          <span>
            <strong>{a?.name || label}</strong>
            <small>
              {a
                ? `${Math.max(1, Math.round(a.size / 1024))} KB · Change file`
                : "Choose from library or upload"}
            </small>
          </span>
        </button>
        {data[key] && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onData(key, "")}
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  };
  let links: { title: string; url: string; platform?: string }[] = [];
  try {
    links = JSON.parse(data.links || "[]");
  } catch {}
  const updateLink = (i: number, key: string, value: string) =>
    onData(
      "links",
      JSON.stringify(
        links.map((l, j) => (j === i ? { ...l, [key]: value } : l)),
      ),
    );
  let hours: { closed: boolean; open: string; close: string }[] = Array.from(
    { length: 7 },
    (_, i) => ({ closed: i > 4, open: "09:00", close: "17:00" }),
  );
  try {
    if (data.hours) hours = JSON.parse(data.hours);
  } catch {}
  const updateHours = (i: number, key: string, value: string | boolean) =>
    onData(
      "hours",
      JSON.stringify(
        hours.map((h, j) => (j === i ? { ...h, [key]: value } : h)),
      ),
    );
  return (
    <div className="publishing-fields">
      {type === "contact" ? (
        <>
          {field("fullName", "Full name", "text", true)}
          <div className="field-pair">
            {field("jobTitle", "Job title")}
            {field("company", "Organization")}
          </div>
        </>
      ) : (
        field("title", "Page title", "text", true)
      )}
      <label>
        {type === "contact" ? "About you" : "Description"}
        <textarea
          value={data.description || ""}
          maxLength={1500}
          rows={3}
          onChange={(e) => onData("description", e.target.value)}
          placeholder="A little introduction goes a long way."
        />
      </label>
      {type === "pdf" && (
        <>
          {media("pdfId", "Choose a PDF")}
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={data.direct === "true"}
              onChange={(e) => onData("direct", String(e.target.checked))}
            />
            <span>
              <strong>Open the PDF directly</strong>
              <small>Skip the landing page when someone scans.</small>
            </span>
          </label>
          <p className="hint">
            Replace the document anytime. Your printed QR code keeps the same
            link.
          </p>
        </>
      )}
      {["contact", "business"].includes(type) && (
        <>
          <div className="field-pair">
            {field("phone", "Phone", "tel")}
            {field("email", "Email", "email")}
          </div>
          {field("website", "Website", "url")}
          {field("address", "Address")}
        </>
      )}
      {media(
        type === "contact" ? "portraitId" : "coverId",
        type === "contact" ? "Portrait image" : "Cover image",
      )}
      {["business", "social"].includes(type) && (
        <div className="publishing-links">
          <div className="editor-section-label">
            {type === "social" ? "YOUR CHANNELS" : "MORE WAYS TO CONNECT"}
          </div>
          {links.map((l, i) => (
            <div className="publishing-link-row" key={i}>
              <div className="field-pair">
                <label>
                  Platform
                  <select
                    aria-label={`Link ${i + 1} platform`}
                    value={l.platform || "website"}
                    onChange={(e) => updateLink(i, "platform", e.target.value)}
                  >
                    {platforms.map((p) => (
                      <option key={p} value={p}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Label
                  <input
                    aria-label={`Link ${i + 1} label`}
                    value={l.title}
                    maxLength={80}
                    onChange={(e) => updateLink(i, "title", e.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="link-url-row">
                <input
                  type="url"
                  aria-label={`Link ${i + 1} URL`}
                  value={l.url}
                  placeholder="https://…"
                  maxLength={2000}
                  required
                  onChange={(e) => updateLink(i, "url", e.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove link ${i + 1}`}
                  onClick={() =>
                    onData(
                      "links",
                      JSON.stringify(links.filter((_, j) => i !== j)),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="button secondary small"
            disabled={links.length >= 12}
            onClick={() =>
              onData(
                "links",
                JSON.stringify([
                  ...links,
                  { platform: "website", title: "", url: "" },
                ]),
              )
            }
          >
            <Plus size={14} />
            Add a link
          </button>
        </div>
      )}
      {type === "business" && (
        <fieldset className="hours-editor">
          <legend>Opening hours</legend>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={!!data.hours}
              onChange={(e) =>
                onData("hours", e.target.checked ? JSON.stringify(hours) : "")
              }
            />
            <span>Show opening hours</span>
          </label>
          {data.hours &&
            hours.map((h, i) => (
              <div className="hours-row" key={i}>
                <strong>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}
                </strong>
                <label>
                  <input
                    type="checkbox"
                    checked={!h.closed}
                    onChange={(e) =>
                      updateHours(i, "closed", !e.target.checked)
                    }
                  />
                  Open
                </label>
                <input
                  type="time"
                  aria-label={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]} opens`}
                  disabled={h.closed}
                  value={h.open}
                  onChange={(e) => updateHours(i, "open", e.target.value)}
                />
                <span>–</span>
                <input
                  type="time"
                  aria-label={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]} closes`}
                  disabled={h.closed}
                  value={h.close}
                  onChange={(e) => updateHours(i, "close", e.target.value)}
                />
              </div>
            ))}
        </fieldset>
      )}
      <fieldset className="page-theme">
        <legend>Make the page yours</legend>
        <div className="page-theme-options">
          {(["minimal", "soft", "bold"] as const).map((t) => (
            <button
              type="button"
              key={t}
              aria-pressed={options.theme === t}
              className={options.theme === t ? "active" : ""}
              onClick={() => onOptions({ ...options, theme: t })}
            >
              <span
                style={{
                  background:
                    t === "minimal"
                      ? "#fff"
                      : t === "soft"
                        ? "#eef1e8"
                        : options.accent,
                }}
              >
                <i style={{ background: options.accent }} />
              </span>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <label className="page-accent">
          Accent color
          <input
            type="color"
            aria-label="Page accent color"
            value={options.accent}
            onChange={(e) => onOptions({ ...options, accent: e.target.value })}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={options.showBrand}
            onChange={(e) =>
              onOptions({ ...options, showBrand: e.target.checked })
            }
          />
          <span>Show “Made with OpenQR”</span>
        </label>
      </fieldset>
      {picker && (
        <AssetPicker
          filter={picker === "pdfId" ? "pdf" : "image"}
          onClose={() => setPicker(null)}
          onSelect={(asset) => {
            onData(picker, asset.id);
            void load();
          }}
        />
      )}
    </div>
  );
}
export function PagePreview({
  type,
  data,
  options,
}: Pick<Props, "type" | "data" | "options">) {
  const [assets, setAssets] = useState<Asset[]>([]);
  useEffect(() => {
    api<Asset[]>("/assets")
      .then(setAssets)
      .catch(() => {});
  }, [data.coverId, data.portraitId, data.pdfId]);
  const cover = assets.find((a) => a.id === data.coverId),
    portrait = assets.find((a) => a.id === data.portraitId),
    pdf = assets.find((a) => a.id === data.pdfId);
  const title =
    (type === "contact" ? data.fullName : data.title) || "Your page title";
  let links: { title: string }[] = [];
  try {
    links = JSON.parse(data.links || "[]");
  } catch {}
  return (
    <div
      className={`page-live-preview theme-${options.theme}`}
      style={{ "--page-accent": options.accent } as React.CSSProperties}
    >
      <span className="small-label">LANDING PAGE PREVIEW</span>
      <div className="phone-page">
        {cover && (
          <img className="phone-cover" src={cover.url} alt="Cover preview" />
        )}
        <div className="phone-body">
          {portrait ? (
            <img
              className="phone-avatar"
              src={portrait.url}
              alt="Portrait preview"
            />
          ) : (
            <span className="phone-avatar">
              {title.slice(0, 2).toUpperCase()}
            </span>
          )}
          <h3>{title}</h3>
          {type === "contact" && (
            <small>
              {[data.jobTitle, data.company].filter(Boolean).join(" · ")}
            </small>
          )}
          <p>{data.description || "Your story starts with a scan."}</p>
          {type === "pdf" && (
            <>
              <div className="phone-document">
                <FileText size={19} />
                <span>
                  {pdf?.name || "Your document.pdf"}
                  <small>
                    {pdf
                      ? `${pdf.pages} ${pdf.pages === 1 ? "page" : "pages"} · ${Math.max(1, Math.round(pdf.size / 1024))} KB`
                      : "Choose a PDF to begin"}
                  </small>
                </span>
              </div>
              <div className="phone-action">Open PDF ↗</div>
              <div className="phone-action">Download PDF ↓</div>
            </>
          )}
          {type === "contact" && (
            <div className="phone-action primary">↓ Save contact</div>
          )}
          {["contact", "business"].includes(type) && (
            <>
              {data.phone && <div className="phone-action">Call us ↗</div>}
              {data.email && (
                <div className="phone-action">Send an email ↗</div>
              )}
              {data.website && (
                <div className="phone-action">Visit website ↗</div>
              )}
            </>
          )}
          {["business", "social"].includes(type) &&
            links.slice(0, 4).map((l, i) => (
              <div className="phone-action" key={i}>
                {l.title || "Your link"} ↗
              </div>
            ))}
          {type === "business" && data.address && <p>{data.address}</p>}
          {options.showBrand && <footer>Made with OpenQR</footer>}
        </div>
      </div>
      <p className="hint">Preview · Save to open the published page.</p>
    </div>
  );
}
