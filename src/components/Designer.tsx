import { useState } from "react";
import {
  Undo2,
  Redo2,
  RotateCcw,
  BookmarkPlus,
  Loader2,
  X,
  ImagePlus,
} from "lucide-react";
import { api, type QRDesign, type DesignTemplate, type Asset } from "../lib";
import { defaultDesign, contrastRatio } from "../../shared/qr.js";
import type { FinderStyle } from "../../shared/qr.js";
import { presets } from "./designPresets";
import QrImage from "./QrImage";
import { AssetPicker, uploadAsset } from "./MediaLibrary";
type Look = { color: string; design: QRDesign };
const finders: FinderStyle[] = ["square", "rounded", "circle", "leaf"];
export default function Designer({
  design,
  color,
  onDesign,
  onColor,
  onApply,
  templates,
  onTemplates,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  design: QRDesign;
  color: string;
  onDesign: (d: QRDesign) => void;
  onColor: (c: string) => void;
  onApply: (look: Look) => void;
  templates: DesignTemplate[];
  onTemplates: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saveOpen, setSaveOpen] = useState(false),
    [templateName, setTemplateName] = useState(""),
    [library, setLibrary] = useState(false),
    [custom, setCustom] = useState(!!Object.keys(design.corners || {}).length),
    [corner, setCorner] = useState<"tl" | "tr" | "bl">("tl");
  const change = <K extends keyof QRDesign>(key: K, value: QRDesign[K]) =>
    onDesign({ ...design, [key]: value });
  const cornerDesign = design.corners?.[corner] || {};
  const cornerName = { tl: "Top left", tr: "Top right", bl: "Bottom left" }[
    corner
  ];
  const changeCorner = (
    key: "outer" | "inner" | "outerColor" | "innerColor",
    value: string,
  ) => {
    const next = { ...cornerDesign, [key]: value };
    if (!value) delete next[key];
    change("corners", { ...design.corners, [corner]: next });
  };
  const label = (s: string) => s[0].toUpperCase() + s.slice(1);
  const gallery = <K extends "module" | "eye" | "innerEye" | "frame">(
    key: K,
    title: string,
    values: QRDesign[K][],
  ) => (
    <fieldset className="control-group visual-options">
      <legend>{title}</legend>
      <div
        className={`design-options ${key === "frame" ? "frame-options" : ""}`}
      >
        {values.map((value) => (
          <button
            type="button"
            key={value}
            title={label(value)}
            aria-label={`${title}: ${label(value)}`}
            aria-pressed={design[key] === value}
            className={design[key] === value ? "active" : ""}
            onClick={() => change(key, value)}
          >
            <QrImage
              size={key === "frame" ? 65 : 48}
              content="https://example.com"
              color="#20392d"
              design={{
                ...defaultDesign,
                [key]: value,
                ...(key === "innerEye" ? { eye: "rounded" } : {}),
                caption: "SCAN ME",
              }}
            />
            <small>{value === "follow" ? "Match outer" : label(value)}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
  const colorField = (
    title: string,
    value: string,
    onChange: (c: string) => void,
    inherit?: () => void,
  ) => (
    <label>
      {title}
      <div className="color-field">
        <input
          type="color"
          aria-label={title}
          value={value || color}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{(value || color).toUpperCase()}</span>
        {inherit && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Reset ${title.toLowerCase()}`}
            onClick={inherit}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </label>
  );
  async function chooseLogo(asset: Asset) {
    try {
      let res = await fetch(asset.url);
      if (!res.ok) throw new Error("Could not load this logo.");
      let blob = await res.blob();
      if (asset.kind !== "logo") {
        const small = await uploadAsset(
          new File([blob], asset.name, { type: blob.type }),
          "logo",
        );
        res = await fetch(small.url);
        if (!res.ok) throw new Error("Could not load this logo.");
        blob = await res.blob();
      }
      const reader = new FileReader();
      reader.onload = () => {
        change("logo", String(reader.result));
        setError("");
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="design-controls rich-designer">
      <div className="designer-toolbar">
        <span className="editor-section-label">YOUR SIGNATURE LOOK</span>
        <div>
          <button
            type="button"
            className="icon-button"
            disabled={!canUndo}
            aria-label="Undo design change"
            onClick={onUndo}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!canRedo}
            aria-label="Redo design change"
            onClick={onRedo}
          >
            <Redo2 size={16} />
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onApply({ color: "#163f32", design: { ...defaultDesign } });
              setCustom(false);
            }}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>
      <div className="preset-swatches">
        {presets.map((p) => (
          <button
            type="button"
            key={p.name}
            onClick={() =>
              onApply({
                color: p.color,
                design: { ...p.design, logo: design.logo },
              })
            }
            aria-label={`Apply ${p.name} design`}
            style={{ "--swatch": p.color } as React.CSSProperties}
          >
            <span />
            <small>{p.name}</small>
          </button>
        ))}
      </div>
      {!!templates.length && (
        <label>
          Saved designs
          <select
            value=""
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t)
                onApply({
                  color: t.color,
                  design: { ...defaultDesign, ...t.design },
                });
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
      {gallery("frame", "Frame", [
        "none",
        "border",
        "banner",
        "pill",
        "speech",
        "ticket",
        "stamp",
      ])}
      {design.frame !== "none" && (
        <>
          <label>
            Call to action
            <input
              value={design.caption}
              maxLength={32}
              placeholder="SCAN ME"
              onChange={(e) => change("caption", e.target.value)}
            />
          </label>
          <div className="field-pair">
            <label>
              Caption position
              <select
                value={design.captionPosition}
                onChange={(e) =>
                  change(
                    "captionPosition",
                    e.target.value as QRDesign["captionPosition"],
                  )
                }
              >
                <option value="bottom">Below the code</option>
                <option value="top">Above the code</option>
              </select>
            </label>
            <label>
              Caption size
              <select
                value={design.captionSize}
                onChange={(e) =>
                  change(
                    "captionSize",
                    e.target.value as QRDesign["captionSize"],
                  )
                }
              >
                {["small", "normal", "large"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {gallery("module", "Module shape", [
        "square",
        "gapped",
        "rounded",
        "dots",
        "vertical",
        "horizontal",
        "connected",
      ])}
      <div className="field-pair">
        {colorField("Foreground color", color, onColor)}
        {colorField("Background color", design.background, (c) =>
          change("background", c),
        )}
      </div>
      {contrastRatio(color, design.background) < 4.5 && (
        <p className="inline-warning">
          Increase contrast to at least 4.5:1 for reliable scanning.
        </p>
      )}
      {gallery("eye", "Outer finder", finders)}
      {gallery("innerEye", "Inner finder", ["follow", ...finders])}
      <div className="field-pair">
        {colorField(
          "Outer finder color",
          design.outerColor,
          (c) => change("outerColor", c),
          () => change("outerColor", ""),
        )}
        {colorField(
          "Inner finder color",
          design.innerColor,
          (c) => change("innerColor", c),
          () => change("innerColor", ""),
        )}
      </div>
      <fieldset className="individual-corners">
        <legend>Individual corners</legend>
        <div className="segmented">
          <button
            type="button"
            className={!custom ? "active" : ""}
            onClick={() => {
              setCustom(false);
              change("corners", {});
            }}
          >
            All together
          </button>
          <button
            type="button"
            className={custom ? "active" : ""}
            onClick={() => setCustom(true)}
          >
            Customize each
          </button>
        </div>
        {custom && (
          <>
            <div className="corner-tabs">
              {(["tl", "tr", "bl"] as const).map((c, i) => (
                <button
                  type="button"
                  key={c}
                  className={c === corner ? "active" : ""}
                  onClick={() => setCorner(c)}
                >
                  {["Top left", "Top right", "Bottom left"][i]}
                </button>
              ))}
            </div>
            <div className="field-pair">
              {(["outer", "inner"] as const).map((key) => (
                <label key={key}>
                  {label(key)} shape
                  <select
                    value={cornerDesign[key] || ""}
                    onChange={(e) => changeCorner(key, e.target.value)}
                  >
                    <option value="">Use global style</option>
                    {finders.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="field-pair">
              {colorField(
                `${cornerName} outer color`,
                cornerDesign.outerColor || design.outerColor,
                (c) => changeCorner("outerColor", c),
                () => changeCorner("outerColor", ""),
              )}
              {colorField(
                `${cornerName} inner color`,
                cornerDesign.innerColor || design.innerColor,
                (c) => changeCorner("innerColor", c),
                () => changeCorner("innerColor", ""),
              )}
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const corners = { ...design.corners };
                delete corners[corner];
                change("corners", corners);
              }}
            >
              Reset this corner
            </button>
          </>
        )}
      </fieldset>
      <fieldset className="control-group">
        <legend>Logo or symbol</legend>
        <div className="symbol-options">
          {(["none", "globe", "arrow", "heart", "scan"] as const).map(
            (m, i) => (
              <button
                type="button"
                key={m}
                aria-label={`Center symbol: ${m}`}
                aria-pressed={!design.logo && design.mark === m}
                className={!design.logo && design.mark === m ? "active" : ""}
                onClick={() => onDesign({ ...design, logo: "", mark: m })}
              >
                <span>{["∅", "◎", "↗", "♡", "⊞"][i]}</span>
                {label(m)}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="media-choice logo-choice"
          onClick={() => setLibrary(true)}
        >
          {design.logo ? (
            <img src={design.logo} alt="Your logo" />
          ) : (
            <ImagePlus size={23} />
          )}
          <span>
            <strong>
              {design.logo ? "Replace logo" : "Choose or upload your logo"}
            </strong>
            <small>Reusable across your codes · PNG or JPEG</small>
          </span>
        </button>
        {design.logo && (
          <button
            type="button"
            className="text-button"
            onClick={() => change("logo", "")}
          >
            <X size={12} />
            Remove logo
          </button>
        )}
        {(design.logo || design.mark !== "none") && (
          <label>
            Logo size
            <input
              aria-label="Logo size"
              type="range"
              min={12}
              max={18}
              step={1}
              value={Math.round(design.logoScale * 100)}
              onChange={(e) => change("logoScale", +e.target.value / 100)}
            />
            <small>{Math.round(design.logoScale * 100)}% of code width</small>
          </label>
        )}
      </fieldset>
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
              maxLength={60}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Our brand"
            />
            <button
              type="button"
              className="button primary small"
              disabled={saving || !templateName.trim()}
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
        High error correction and a protected quiet zone are built in. Test a
        printed sample on your target phones.
      </p>
      {library && (
        <AssetPicker
          filter="logo"
          onClose={() => setLibrary(false)}
          onSelect={(asset) => {
            void chooseLogo(asset);
          }}
        />
      )}
    </div>
  );
}
