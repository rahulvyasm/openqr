import { useDeferredValue, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Globe,
  Radio,
  ScanLine,
  FileText,
  Link,
  CalendarDays,
  Blocks,
} from "lucide-react";
import QrImage from "./QrImage";
import type { CodeType } from "../lib";

export type StudioDraft = {
  type: CodeType;
  data?: Record<string, string>;
  color?: string;
};
export default function StudioHero({
  canEdit,
  onCreate,
}: {
  canEdit: boolean;
  onCreate: (draft: StudioDraft) => void;
}) {
  const [url, setUrl] = useState("https://example.com");
  const [color, setColor] = useState("#182521");
  const deferredUrl = useDeferredValue(url);
  let valid = false;
  try {
    const parsed = new URL(url);
    valid =
      ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password;
  } catch {
    /* incomplete sketch */
  }
  return (
    <>
      <section className="studio-hero" aria-label="QR launch studio">
        <div className="hero-editorial" data-stagger>
          <span className="studio-kicker">
            <span className="signal-dot" /> YOUR NEXT CONNECTION STARTS HERE
          </span>
          <h1>
            Make the physical
            <br />
            <span>clickable.</span>
            <ArrowDownRight aria-hidden="true" />
          </h1>
          <p>
            A label. A storefront. An entire campaign.
            <br />
            Turn every touchpoint into somewhere worth going.
          </p>
          <div className="hero-actions">
            <button
              className="button primary"
              data-magnetic
              title="New QR code (N)"
              disabled={!canEdit}
              onClick={() => onCreate({ type: "url" })}
            >
              Create a QR code <ArrowUpRight size={19} />
            </button>
            <span>
              <Radio size={14} /> Editable links. Lasting connections.
            </span>
          </div>
          <div className="hero-index">
            <span>OPENQR / INDEPENDENT BY DESIGN</span>
            <span>01 — ∞</span>
          </div>
        </div>
        <div className="qr-sketchpad" data-tilt>
          <div className="sketchpad-top">
            <span>
              <ScanLine size={15} /> THE QUICK STUDIO
            </span>
            <span>TRY IT OUT ↗</span>
          </div>
          <div className="sketchpad-canvas">
            <span className="canvas-coordinate">
              X: CONNECT
              <br />
              Y: ANYWHERE
            </span>
            <div className="sketchpad-orbit" aria-hidden="true" />
            <div className="sketchpad-paper">
              <QrImage
                content={deferredUrl || "https://example.com"}
                color={color}
                size={172}
              />
              <span>ONE SQUARE. ENDLESS POSSIBILITIES.</span>
            </div>
            <span className="canvas-edition">
              QR
              <br />
              /001
            </span>
          </div>
          <div className="sketchpad-controls">
            <label htmlFor="sketch-url">
              <Globe size={15} />
              <input
                id="sketch-url"
                aria-label="Sketchpad website URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                maxLength={1000}
                spellCheck={false}
                placeholder="https://your-website.com"
              />
            </label>
            <div className="sketchpad-bottom">
              <div className="ink-swatches" aria-label="QR ink color">
                {[
                  ["#182521", "Ink"],
                  ["#254bdb", "Cobalt"],
                  ["#85452f", "Terracotta"],
                ].map(([value, name]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${name} ink`}
                    aria-pressed={color === value}
                    style={{ background: value }}
                    onClick={() => setColor(value)}
                  >
                    {color === value && <Check size={12} />}
                  </button>
                ))}
              </div>
              <button
                className="sketch-continue"
                disabled={!canEdit || !valid}
                onClick={() => onCreate({ type: "url", data: { url }, color })}
              >
                Make it yours <ArrowUpRight size={16} />
              </button>
            </div>
            {!valid && (
              <p className="sketch-error" role="status">
                Enter a full http:// or https:// website address.
              </p>
            )}
            <span className="sketch-disclaimer">
              Unsaved sketch · Create a code to save and track it.
            </span>
          </div>
        </div>
      </section>
      <section className="launch-strip" aria-label="Start with a QR type">
        <span>
          WHAT ARE WE
          <br />
          <strong>CONNECTING?</strong>
        </span>
        {[
          { type: "experience", name: "An experience", icon: Blocks },
          { type: "url", name: "A website", icon: Globe },
          { type: "pdf", name: "A document", icon: FileText },
          { type: "links", name: "Your links", icon: Link },
          { type: "hosted-event", name: "An event", icon: CalendarDays },
        ].map(({ type, name, icon: Icon }) => (
          <button
            disabled={!canEdit}
            key={type}
            onClick={() => onCreate({ type: type as CodeType })}
          >
            <Icon size={18} />
            <span>{name}</span>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </section>
    </>
  );
}
