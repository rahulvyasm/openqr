import { useState } from "react";
import { ImagePlus, Palette, BookmarkPlus, X, Loader2 } from "lucide-react";
import { api, type QRDesign, type DesignTemplate } from "../lib";
import { defaultDesign, contrastRatio } from "../../shared/qr.js";
export const presets = [
  {
    name: "Forest",
    color: "#285b48",
    design: { ...defaultDesign, module: "rounded", eye: "rounded" },
  },
  {
    name: "Midnight",
    color: "#202b50",
    design: { ...defaultDesign, module: "dots", eye: "rounded" },
  },
  {
    name: "Terracotta",
    color: "#924e3c",
    design: {
      ...defaultDesign,
      module: "rounded",
      frame: "border",
      caption: "MEET SOMETHING GOOD",
    },
  },
  {
    name: "Berry",
    color: "#733855",
    design: { ...defaultDesign, module: "dots", eye: "circle" },
  },
  { name: "Classic", color: "#1e2521", design: { ...defaultDesign } },
] as { name: string; color: string; design: QRDesign }[];
export default function DesignControls({
  design,
  color,
  onDesign,
  onColor,
  templates,
  onTemplates,
}: {
  design: QRDesign;
  color: string;
  onDesign: (d: QRDesign) => void;
  onColor: (c: string) => void;
  templates: DesignTemplate[];
  onTemplates: () => void;
}) {
  const [error, setError] = useState(""),
    [templateName, setTemplateName] = useState(""),
    [saving, setSaving] = useState(false),
    [saveOpen, setSaveOpen] = useState(false);
  const change = <K extends keyof QRDesign>(key: K, value: QRDesign[K]) =>
    onDesign({ ...design, [key]: value });
  return (
    <div className="design-controls">
      <div className="editor-section-label">
        <Palette size={16} />
        <span>START WITH A LOOK</span>
      </div>
      <div className="preset-swatches">
        {presets.map((p) => (
          <button
            type="button"
            key={p.name}
            onClick={() => {
              onColor(p.color);
              onDesign({ ...p.design, logo: design.logo });
            }}
            title={p.name}
            aria-label={`Apply ${p.name} design`}
            style={{ "--swatch": p.color } as React.CSSProperties}
          >
            <span />
            <small>{p.name}</small>
          </button>
        ))}
      </div>
      {templates.length > 0 && (
        <label>
          Saved designs
          <select
            value=""
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t) {
                onDesign(t.design);
                onColor(t.color);
              }
            }}
          >
            <option value="">Choose a saved design…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field-pair">
        <label>
          Foreground
          <div className="color-field">
            <input
              type="color"
              aria-label="Foreground color"
              value={color}
              onChange={(e) => onColor(e.target.value)}
            />
            <span>{color.toUpperCase()}</span>
          </div>
        </label>
        <label>
          Background
          <div className="color-field">
            <input
              type="color"
              aria-label="Background color"
              value={design.background}
              onChange={(e) => change("background", e.target.value)}
            />
            <span>{design.background.toUpperCase()}</span>
          </div>
        </label>
      </div>
      {contrastRatio(color, design.background) < 4.5 && (
        <p className="inline-warning" role="status">
          Increase the contrast to at least 4.5:1 so this code can scan
          reliably.
        </p>
      )}
      <fieldset className="control-group">
        <legend>Module shape</legend>
        <div className="segmented">
          {(["square", "rounded", "dots"] as const).map((s) => (
            <button
              type="button"
              className={design.module === s ? "active" : ""}
              aria-pressed={design.module === s}
              onClick={() => change("module", s)}
              key={s}
            >
              {s === "dots"
                ? "● Dots"
                : s === "rounded"
                  ? "▢ Rounded"
                  : "■ Square"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="control-group">
        <legend>Finder shape</legend>
        <div className="segmented">
          {(["square", "rounded", "circle"] as const).map((s) => (
            <button
              type="button"
              className={design.eye === s ? "active" : ""}
              aria-pressed={design.eye === s}
              onClick={() => change("eye", s)}
              key={s}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field-pair">
        <label>
          Frame
          <select
            value={design.frame}
            onChange={(e) =>
              change("frame", e.target.value as QRDesign["frame"])
            }
          >
            <option value="none">No frame</option>
            <option value="border">Outline + caption</option>
            <option value="banner">Caption banner</option>
          </select>
        </label>
        {design.frame !== "none" && (
          <label>
            Call to action
            <input
              value={design.caption}
              onChange={(e) => change("caption", e.target.value)}
              maxLength={32}
              placeholder="SCAN ME"
            />
          </label>
        )}
      </div>
      <label className="logo-upload">
        <ImagePlus size={20} />
        <span>
          <strong>
            {design.logo ? "Replace your logo" : "Make it unmistakably yours"}
          </strong>
          <small>PNG or JPEG · Up to 128 KB</small>
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Upload a logo"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (
              file.size > 131072 ||
              !["image/png", "image/jpeg"].includes(file.type)
            ) {
              setError("Choose a PNG or JPEG smaller than 128 KB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              change("logo", String(reader.result));
              setError("");
            };
            reader.readAsDataURL(file);
            e.target.value = "";
          }}
        />
      </label>
      {design.logo && (
        <button
          type="button"
          className="text-button"
          onClick={() => change("logo", "")}
        >
          <X size={13} />
          Remove logo
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="save-design">
        <button
          type="button"
          className="button secondary small"
          onClick={() => setSaveOpen(!saveOpen)}
        >
          <BookmarkPlus size={15} />
          Save as a reusable design
        </button>
        {saveOpen && (
          <div className="save-design-form">
            <input
              aria-label="Design name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Our brand"
              maxLength={60}
            />
            <button
              type="button"
              className="button primary small"
              disabled={!templateName.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api("/templates", {
                    name: templateName,
                    design,
                    color,
                  });
                  onTemplates();
                  setSaveOpen(false);
                  setTemplateName("");
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 size={14} className="spin" /> : "Save design"}
            </button>
          </div>
        )}
      </div>
      <p className="hint">
        High error correction protects your logo area. Always test a printed
        sample on more than one phone.
      </p>
    </div>
  );
}
