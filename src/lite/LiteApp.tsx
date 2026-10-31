import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  Download,
  FileCode2,
  FileImage,
  Lock,
  Sparkles,
} from "lucide-react";
import { defaultDesign, renderSvg } from "../../shared/qr.js";
import { api, codeContent, saveBlob, type CodeType, type DesignTemplate, type QRDesign } from "../lib";
import Designer from "../components/Designer";
import QrImage from "../components/QrImage";
import { useDesignHistory } from "../components/useDesignHistory";
import { svgToPng } from "../demo/png";
import { joinWaitlist, waitlistEnabled } from "./waitlist";
import GithubLink from "../components/GithubLink";

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "url" | "tel" | "email" | "textarea" | "datetime-local" | "select";
  options?: [string, string][];
  required?: boolean;
};
const kinds: { type: CodeType; label: string; fields: Field[] }[] = [
  { type: "url", label: "Website", fields: [{ key: "url", label: "Website address", placeholder: "https://example.com", type: "url", required: true }] },
  { type: "text", label: "Text", fields: [{ key: "text", label: "Your text", placeholder: "A message that travels offline", type: "textarea", required: true }] },
  {
    type: "wifi",
    label: "Wi-Fi",
    fields: [
      { key: "ssid", label: "Network name", placeholder: "Guest Wi-Fi", required: true },
      { key: "security", label: "Security", type: "select", options: [["WPA", "WPA / WPA2 / WPA3"], ["WEP", "WEP"], ["nopass", "Open network"]] },
      { key: "password", label: "Password", placeholder: "Wi-Fi password" },
    ],
  },
  {
    type: "email",
    label: "Email",
    fields: [
      { key: "email", label: "Email address", placeholder: "hello@example.com", type: "email", required: true },
      { key: "subject", label: "Subject" },
      { key: "body", label: "Message", type: "textarea" },
    ],
  },
  { type: "phone", label: "Phone", fields: [{ key: "phone", label: "Phone number", placeholder: "+91 98765 43210", type: "tel", required: true }] },
  {
    type: "sms",
    label: "SMS",
    fields: [
      { key: "phone", label: "Phone number", type: "tel", required: true },
      { key: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    type: "whatsapp",
    label: "WhatsApp",
    fields: [
      { key: "phone", label: "WhatsApp number", placeholder: "+91 98765 43210", type: "tel", required: true },
      { key: "message", label: "Prefilled message", type: "textarea" },
    ],
  },
  {
    type: "vcard",
    label: "Contact card",
    fields: [
      { key: "fullName", label: "Full name", required: true },
      { key: "company", label: "Organisation" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "email", label: "Email", type: "email" },
    ],
  },
  {
    type: "location",
    label: "Location",
    fields: [
      { key: "latitude", label: "Latitude", placeholder: "18.5204", required: true },
      { key: "longitude", label: "Longitude", placeholder: "73.8567", required: true },
    ],
  },
  {
    type: "event",
    label: "Event",
    fields: [
      { key: "title", label: "Event title", required: true },
      { key: "startsAt", label: "Starts", type: "datetime-local", required: true },
      { key: "endsAt", label: "Ends", type: "datetime-local", required: true },
      { key: "location", label: "Where" },
      { key: "description", label: "Details", type: "textarea" },
    ],
  },
];

const localInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function Waitlist() {
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (!waitlistEnabled) return null;
  return (
    <form
      className="lite-waitlist"
      onSubmit={async (e) => {
        e.preventDefault();
        if (trap) return setState("done");
        setState("busy");
        setError("");
        try {
          await joinWaitlist(email);
          setState("done");
        } catch (err) {
          setError((err as Error).message);
          setState("idle");
        }
      }}
    >
      {state === "done" ? (
        <p role="status">You are on the list. We will email you once, when it opens.</p>
      ) : (
        <>
          <label>
            Get early access to the hosted version
            <span>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                maxLength={200}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="xs-trap"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={trap}
                onChange={(e) => setTrap(e.target.value)}
              />
              <button className="button primary" disabled={state === "busy"}>
                Notify me
              </button>
            </span>
          </label>
          {error && <small role="alert" className="form-error">{error}</small>}
          <small className="hint">One email when it opens. Nothing else. Ask us to delete it any time.</small>
        </>
      )}
    </form>
  );
}

export default function LiteApp() {
  const [kind, setKind] = useState(kinds[0]);
  const [data, setData] = useState<Record<string, string>>({ security: "WPA" });
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [size, setSize] = useState(1024);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [look, setLook] = useState(false);
  const history = useDesignHistory({ color: "#163f32", design: { ...defaultDesign } as QRDesign });
  const { color, design } = history.current;

  const loadTemplates = () => api<DesignTemplate[]>("/templates").then(setTemplates).catch(() => {});
  useEffect(() => {
    void loadTemplates();
  }, []);

  const ready = kind.fields.every((f) => !f.required || (data[f.key] || "").trim());
  const content = useMemo(
    () =>
      ready
        ? codeContent({ type: kind.type, data, dynamic: false, shortUrl: "" })
        : "https://openqr.riolet.si",
    [ready, kind, data],
  );
  const set = (key: string, value: string) => setData((d) => ({ ...d, [key]: value }));

  async function download() {
    setBusy(true);
    try {
      const qr = QRCode.create(content, { errorCorrectionLevel: "H" });
      const svg = renderSvg(qr.modules.data, qr.modules.size, design, color, qr.modules.reservedBit);
      const name = `openqr-${kind.type}`;
      saveBlob(
        format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg, size),
        `${name}.${format}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lite">
      <header className="lite-nav">
        <a className="brand" href="/" aria-label="OpenQR home">
          <img className="brand-logo" src="/logo.svg" alt="" width={37} height={37} />
          <span>openqr<b>.</b></span>
        </a>
        <nav>
          <GithubLink label="Source" size={16} />
          <a className="lite-pill" href="/demo/">See full potential <ArrowUpRight size={15} /></a>
        </nav>
      </header>

      <main>
        <section className="lite-hero">
          <span className="lite-kicker"><i /> FREE QR GENERATOR</span>
          <h1>Make a QR code.<br /><em>It never leaves your browser.</em></h1>
          <p>No account, no tracking, no expiry. Style it, then download a crisp PNG or a vector SVG.</p>
        </section>

        <section className="lite-tool" aria-label="QR code generator">
          <div className="lite-form">
            <div className="lite-kinds" role="tablist" aria-label="What should it open?">
              {kinds.map((k) => (
                <button
                  key={k.type}
                  role="tab"
                  aria-selected={kind.type === k.type}
                  className={kind.type === k.type ? "on" : ""}
                  onClick={() => {
                    setKind(k);
                    setData((d) => ({ security: d.security || "WPA" }));
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className="lite-fields">
              {kind.fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.type === "textarea" ? (
                    <textarea value={data[f.key] || ""} placeholder={f.placeholder} maxLength={1200} onChange={(e) => set(f.key, e.target.value)} />
                  ) : f.type === "select" ? (
                    <select value={data[f.key] || f.options![0][0]} onChange={(e) => set(f.key, e.target.value)}>
                      {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : f.type === "datetime-local" ? (
                    <input type="datetime-local" value={localInput(data[f.key])} onChange={(e) => set(f.key, e.target.value ? new Date(e.target.value).toISOString() : "")} />
                  ) : (
                    <input type={f.type || "text"} value={data[f.key] || ""} placeholder={f.placeholder} maxLength={1000} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
            <button type="button" className="lite-toggle" aria-expanded={look} onClick={() => setLook(!look)}>
              <Sparkles size={15} /> {look ? "Hide styling" : "Style it: shapes, colours, frames, logo"}
            </button>
            {look && (
              <div className="lite-designer">
                <Designer
                  color={color}
                  design={design}
                  onColor={(c) => history.change({ color: c, design })}
                  onDesign={(d) => history.change({ color, design: d })}
                  onApply={history.change}
                  templates={templates}
                  onTemplates={() => void loadTemplates()}
                  onUndo={history.undo}
                  onRedo={history.redo}
                  canUndo={history.canUndo}
                  canRedo={history.canRedo}
                />
              </div>
            )}
          </div>

          <aside className="lite-preview" aria-label="Preview and download">
            <div className="lite-paper">
              <QrImage size={260} content={content} color={color} design={design} />
            </div>
            {!ready && <p className="hint">Fill in the highlighted details to make your code.</p>}
            <div className="lite-format" role="group" aria-label="File type">
              <button className={format === "png" ? "on" : ""} onClick={() => setFormat("png")}><FileImage size={16} /> PNG</button>
              <button className={format === "svg" ? "on" : ""} onClick={() => setFormat("svg")}><FileCode2 size={16} /> SVG</button>
            </div>
            {format === "png" && (
              <select aria-label="Image width" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                <option value={512}>512 px · sharing</option>
                <option value={1024}>1024 px · high resolution</option>
                <option value={2048}>2048 px · large prints</option>
              </select>
            )}
            <button className="button primary lite-download" disabled={!ready || busy} onClick={download}>
              <Download size={17} /> Download {format.toUpperCase()}
            </button>
            <p className="lite-note"><Lock size={13} /> Made in your browser. Nothing is uploaded.</p>
          </aside>
        </section>

        <section className="lite-more" aria-labelledby="more-title">
          <span className="lite-kicker"><i /> BEYOND STATIC CODES</span>
          <h2 id="more-title">Print once. <em>Keep improving.</em></h2>
          <div className="lite-cards">
            {[
              ["Editable after printing", "Change where a code goes without reprinting it. Pause it, schedule it, retire it."],
              ["Experiences, not just links", "Build a mobile page from blocks, collect responses, and show different things at different times of day."],
              ["Know what happened", "Scans, devices, referrers and what visitors did next, in one place that you own."],
              ["One page, hundreds of items", "Give every product its own code with its serial, warranty and service history."],
            ].map(([title, text]) => (
              <article key={title}><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
          <a className="lite-cta" href="/demo/">See full potential <ArrowUpRight size={20} /></a>
          <p className="lite-note">An interactive demo of the full app. Nothing is saved.</p>
          <Waitlist />
        </section>
      </main>

      <footer className="lite-foot">
        <span>openqr. MIT licensed. Self-host it, or wait for the hosted version.</span>
        <span>
          <GithubLink label="GitHub" size={14} />
          {" · "}
          <a href="https://github.com/rahulvyasm/openqr/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security</a>
        </span>
      </footer>
    </div>
  );
}
