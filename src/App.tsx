import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Folder as FolderIcon,
  FolderPlus,
  Globe,
  LayoutGrid,
  Leaf,
  List,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MousePointer2,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  Users,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  codeContent,
  exportCsv,
  formatNumber,
  typeNames,
  type Analytics,
  type Code,
  type CodeType,
  type Folder,
  type User,
} from "./lib";
import "./styles.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";

const icons = {
  url: Globe,
  text: Type,
  wifi: Wifi,
  email: Mail,
  phone: Phone,
  vcard: Users,
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <QrCode size={23} />
      </span>
      <span>
        open<span className="brand-light">qr</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function QrImage({
  content,
  color = "#163f32",
  size = 128,
}: {
  content: string;
  color?: string;
  size?: number;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setError(false);
    QRCode.toDataURL(content || "OpenQR", {
      width: size * 2,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: color, light: "#ffffff" },
    })
      .then((url) => {
        if (current) setSrc(url);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [content, color, size]);
  return error ? (
    <div className="qr-error">Content is too long for a QR code.</div>
  ) : src ? (
    <img src={src} width={size} height={size} alt="Scannable QR code" />
  ) : (
    <div style={{ width: size, height: size }} className="qr-loading">
      <Loader2 className="spin" />
    </div>
  );
}
function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Auth({ setup, onSuccess }: { setup: boolean; onSuccess: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api(`/auth/${setup ? "setup" : "login"}`, Object.fromEntries(form));
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">
            <span className="tiny-dot" /> OPEN SOURCE. OPEN POSSIBILITIES.
          </span>
          <h1>
            A small square.
            <br />A world of
            <br />
            <em>connections.</em>
          </h1>
          <p>
            Create beautiful QR codes. Keep your links flexible.
            <br />
            Make every connection count.
          </p>
          <div className="auth-art">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-qr">
              <QrImage content="https://example.com" size={164} />
            </div>
            <span className="art-badge">
              <Leaf size={16} /> Yours to build on
            </span>
            <span className="art-spark">✳</span>
          </div>
        </div>
        <span className="auth-footer">
          Your codes. Your data. Your platform.
        </span>
      </div>
      <main className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="small-label">
            YOUR OWN LITTLE CORNER OF THE INTERNET
          </span>
          <h2>{setup ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {setup
              ? "Create the owner account for your OpenQR workspace."
              : "Sign in and pick up where you left off."}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={setup ? "new-password" : "current-password"}
                placeholder={setup ? "At least 12 characters" : "Your password"}
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <>
                  {setup ? "Create your workspace" : "Sign in"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="auth-note">
            <ShieldCheck size={17} />
            <span>Self-hosted. No subscriptions. No scan limits.</span>
          </div>
        </div>
        <span className="auth-bottom">
          <Code2 size={15} /> Built in the open. Made for everyone.
        </span>
      </main>
    </div>
  );
}
function ScanChart({ analytics }: { analytics: Analytics | null }) {
  if (!analytics)
    return (
      <div className="chart-loading">
        <Loader2 className="spin" />
      </div>
    );
  const values = analytics.daily;
  const max = Math.max(4, ...values.map((d) => d.scans));
  const width = 800;
  const height = 150;
  const points = values
    .map(
      (d, i) =>
        `${(i / Math.max(1, values.length - 1)) * width},${height - (d.scans / max) * (height - 15)}`,
    )
    .join(" ");
  return (
    <div className="chart-wrap">
      <div className="chart-axis">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="chart-body">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Scan activity: ${analytics.total} scans in the last ${analytics.days} days`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#87bda3" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#87bda3" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((n) => (
            <line
              key={n}
              x1="0"
              x2={width}
              y1={height * n}
              y2={height * n}
              stroke="#e8ece7"
              strokeDasharray="4 5"
            />
          ))}
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill="url(#chart-fill)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#42785c"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="chart-dates">
          {[
            values[0],
            values[Math.floor(values.length / 2)],
            values.at(-1),
          ].map((d, i) => (
            <span key={i}>
              {d &&
                new Date(d.date + "T12:00:00Z").toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
function Editor({
  code,
  folders,
  publicUrl,
  onClose,
  onSave,
}: {
  code?: Code;
  folders: Folder[];
  publicUrl: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [type, setType] = useState<CodeType>(code?.type || "url");
  const [dynamic, setDynamic] = useState(code?.dynamic ?? true);
  const [name, setName] = useState(code?.name || "");
  const [data, setData] = useState<Record<string, string>>(
    code?.data || { security: "WPA" },
  );
  const [color, setColor] = useState(code?.color || "#163f32");
  const [folderId, setFolderId] = useState(code?.folderId || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!code && !code.dynamic;
  const changeData = (key: string, value: string) =>
    setData((d) => ({ ...d, [key]: value }));
  const field = (
    key: string,
    label: string,
    placeholder: string,
    inputType = "text",
    required = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={inputType}
        value={data[key] || ""}
        onChange={(e) => changeData(key, e.target.value)}
        placeholder={placeholder}
        disabled={locked}
        required={required}
        maxLength={key === "text" ? 1500 : 1000}
      />
    </label>
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        code ? `/codes/${code.id}` : "/codes",
        {
          name,
          type,
          dynamic: type === "url" && dynamic,
          data,
          color,
          folderId: folderId || null,
          active: code?.active ?? true,
        },
        code ? "PUT" : "POST",
      );
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={code ? "Edit QR code" : "Create something worth scanning."}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="editor-layout">
          <div className="editor-fields">
            <span className="small-label">01 / CHOOSE YOUR CONTENT</span>
            <div className="type-picker">
              {(Object.keys(typeNames) as CodeType[]).map((t) => {
                const Icon = icons[t];
                return (
                  <button
                    type="button"
                    disabled={!!code}
                    key={t}
                    className={`type-option ${type === t ? "selected" : ""}`}
                    onClick={() => {
                      setType(t);
                      setDynamic(t === "url");
                      setError("");
                    }}
                  >
                    <Icon size={18} />
                    {typeNames[t]}
                  </button>
                );
              })}
            </div>
            <label>
              Code name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Our new website"
                required
                maxLength={100}
                autoFocus
              />
            </label>
            {type === "url" && (
              <>
                {field(
                  "url",
                  "Website URL",
                  "https://your-website.com",
                  "url",
                  true,
                )}
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={dynamic}
                    onChange={(e) => setDynamic(e.target.checked)}
                    disabled={!!code}
                  />
                  <span>
                    <strong>Make it dynamic</strong>
                    <small>Update the destination and track scans.</small>
                  </span>
                  <span className="mini-badge">RECOMMENDED</span>
                </label>
              </>
            )}
            {type === "text" && (
              <label>
                Your text
                <textarea
                  value={data.text || ""}
                  onChange={(e) => changeData("text", e.target.value)}
                  required
                  maxLength={1500}
                  disabled={locked}
                  placeholder="Something you want to share…"
                />
              </label>
            )}
            {type === "wifi" && (
              <>
                {field(
                  "ssid",
                  "Network name",
                  "Your Wi-Fi network",
                  "text",
                  true,
                )}
                <label>
                  Security
                  <select
                    value={data.security || "WPA"}
                    onChange={(e) => changeData("security", e.target.value)}
                    disabled={locked}
                  >
                    <option value="WPA">WPA / WPA2 / WPA3</option>
                    <option value="WEP">WEP</option>
                    <option value="nopass">Open network</option>
                  </select>
                </label>
                {data.security !== "nopass" &&
                  field(
                    "password",
                    "Network password",
                    "Wi-Fi password",
                    "password",
                  )}
              </>
            )}
            {type === "email" && (
              <>
                {field(
                  "email",
                  "Email address",
                  "hello@example.com",
                  "email",
                  true,
                )}
                {field("subject", "Subject", "Let’s connect")}
                {field("body", "Message", "Hello there!")}
              </>
            )}
            {type === "phone" &&
              field("phone", "Phone number", "+1 555 123 4567", "tel", true)}
            {type === "vcard" && (
              <>
                {field("fullName", "Full name", "Alex Morgan", "text", true)}
                {field("company", "Organization", "Your company")}
                {field("phone", "Phone", "+1 555 123 4567", "tel")}
                {field("email", "Email", "alex@example.com", "email")}
              </>
            )}
            {locked && (
              <p className="hint">
                Static content is permanent. You can update its name, folder,
                and color.
              </p>
            )}
            <div className="field-pair">
              <label>
                Folder
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                >
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Code color
                <div className="color-field">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <span>{color.toUpperCase()}</span>
                </div>
              </label>
            </div>
          </div>
          <aside className="editor-preview">
            <span className="small-label">YOUR LIVE PREVIEW</span>
            <div className="preview-paper">
              <QrImage
                size={208}
                content={codeContent({
                  type,
                  data,
                  dynamic: type === "url" && dynamic,
                  shortUrl: code?.shortUrl || `${publicUrl}/r/preview`,
                })}
                color={color}
              />
              <span>{name || "Something wonderful"}</span>
            </div>
            <span className="preview-caption">
              <Smartphone size={15} /> A little code. A big connection.
            </span>
            <div className="preview-tip">
              <Sparkles size={18} />
              <p>
                {type === "url" && dynamic
                  ? "Print it once. Change the destination whenever you need to."
                  : "Your content is stored right in the QR code. No connection to OpenQR required."}
              </p>
            </div>
            {!code && type === "url" && dynamic && (
              <p className="hint">
                The final tracking link is assigned when you save. Download the
                saved code for printing.
              </p>
            )}
            <p className="hint">
              Keep a dark code on a white background and test before printing.
            </p>
          </aside>
        </div>
        <div className="modal-footer">
          {error && (
            <span role="alert" className="form-error">
              {error}
            </span>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <>
                <QrCode size={17} />
                {code ? "Save changes" : "Create QR code"}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function App() {
  const [auth, setAuth] = useState<{
    setupRequired: boolean;
    user: User | null;
    publicUrl: string;
  } | null>(null);
  const [bootError, setBootError] = useState("");
  const [codes, setCodes] = useState<Code[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState("codes");
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("list");
  const [editor, setEditor] = useState<Code | "new" | null>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Code | null>(null);
  const [detail, setDetail] = useState<Code | null>(null);
  const [detailData, setDetailData] = useState<Analytics | null>(null);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [folderError, setFolderError] = useState("");
  const notify = (text: string) => setToast(text);
  const loadAuth = () =>
    api<{ setupRequired: boolean; user: User | null; publicUrl: string }>(
      "/auth/status",
    )
      .then(setAuth)
      .catch((e) => setBootError(e.message));
  const refresh = async () => {
    try {
      const [c, f] = await Promise.all([
        api<Code[]>("/codes"),
        api<Folder[]>("/folders"),
      ]);
      setCodes(c);
      setFolders(f);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const loadAnalytics = () =>
    api<Analytics>(`/analytics?days=${days}`)
      .then(setAnalytics)
      .catch((e) => notify(e.message));
  useEffect(() => {
    loadAuth();
    const expire = () => setAuth((a) => (a ? { ...a, user: null } : a));
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (auth?.user) {
      refresh();
      loadAnalytics();
    }
  }, [auth?.user?.id, days]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!detail) {
      setDetailData(null);
      return;
    }
    let current = true;
    api<Analytics>(`/analytics?days=${days}&codeId=${detail.id}`)
      .then((d) => {
        if (current) setDetailData(d);
      })
      .catch((e) => notify(e.message));
    return () => {
      current = false;
    };
  }, [detail, days]);
  useEffect(() => {
    const close = () => setMenu("");
    if (menu) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);
  if (bootError)
    return (
      <div className="boot">
        <Brand />
        <p role="alert">{bootError}</p>
        <button
          className="button primary"
          onClick={() => {
            setBootError("");
            loadAuth();
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!auth)
    return (
      <div className="boot">
        <Brand />
        <Loader2 className="spin" />
      </div>
    );
  if (!auth.user)
    return <Auth setup={auth.setupRequired} onSuccess={loadAuth} />;
  const totalScans = codes.reduce((n, c) => n + c.scans, 0);
  const active = codes.filter((c) => c.active).length;
  const filtered = codes.filter(
    (c) =>
      (!folder || c.folderId === folder) &&
      (filter === "all" ||
        (filter === "dynamic"
          ? c.dynamic
          : filter === "static"
            ? !c.dynamic
            : !c.active)) &&
      `${c.name} ${Object.values(c.data).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const navigate = (next: string, f = "") => {
    setPage(next);
    setFolder(f);
    setMobileNav(false);
    setSearch("");
    setFilter("all");
  };
  async function toggle(code: Code) {
    try {
      await api(`/codes/${code.id}`, { ...code, active: !code.active }, "PUT");
      await refresh();
      notify(code.active ? "Dynamic link paused." : "Dynamic link is active.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function copy(code: Code) {
    try {
      await navigator.clipboard.writeText(
        code.dynamic ? code.shortUrl : codeContent(code),
      );
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard is unavailable. Use an HTTPS connection.");
    }
  }
  async function remove() {
    if (!deleteTarget) return;
    try {
      await api(`/codes/${deleteTarget.id}`, undefined, "DELETE");
      setDeleteTarget(null);
      await refresh();
      await loadAnalytics();
      notify("QR code deleted.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const analyticsPanel = (data: Analytics | null) => (
    <>
      <ScanChart analytics={data} />
      <div className="analytics-breakdown">
        <div>
          <span className="small-label">DAILY UNIQUE VISITORS</span>
          <strong>{formatNumber(data?.uniqueDailyVisitors || 0)}</strong>
          <p>Approximate visitors, counted separately each day.</p>
        </div>
        <div>
          <span className="small-label">SCANS BY DEVICE</span>
          {Object.entries(
            data?.devices || { Mobile: 0, Desktop: 0, Tablet: 0 },
          ).map(([name, n]) => (
            <div className="device-row" key={name}>
              <span>{name}</span>
              <div>
                <i
                  style={{
                    width: `${data?.total ? (n / data.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <b>{n}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <button
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu />
      </button>
      {mobileNav && (
        <div className="nav-backdrop" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <Brand />
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-avatar">
            {auth.user.name[0].toUpperCase()}
          </span>
          <span>
            <strong>My workspace</strong>
            <small>Personal workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          <button
            className={
              page === "codes" && !folder ? "nav-item selected" : "nav-item"
            }
            onClick={() => navigate("codes")}
          >
            <QrCode size={19} />
            <span>My QR codes</span>
            <span className="nav-count">{codes.length}</span>
          </button>
          <button
            className={page === "analytics" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("analytics")}
          >
            <BarChart3 size={19} />
            <span>Analytics</span>
          </button>
        </nav>
        <div className="nav-label folder-label">
          <span>FOLDERS</span>
          <button
            aria-label="Add folder"
            className="icon-button"
            onClick={() => {
              setFolderError("");
              setFolderModal(true);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="folder-nav">
          {folders.length ? (
            folders.map((f) => (
              <button
                className={`nav-item ${folder === f.id ? "selected" : ""}`}
                key={f.id}
                onClick={() => navigate("codes", f.id)}
              >
                <FolderIcon size={17} />
                <span>{f.name}</span>
                <small>{codes.filter((c) => c.folderId === f.id).length}</small>
              </button>
            ))
          ) : (
            <button
              className="empty-folder"
              onClick={() => setFolderModal(true)}
            >
              <FolderPlus size={17} />
              <span>
                A place for every project.
                <br />
                <strong>Create your first folder</strong>
              </span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="open-card">
            <span className="open-icon">
              <Code2 size={19} />
            </span>
            <strong>Good things are open.</strong>
            <p>
              No subscriptions. No limits.
              <br />
              Just you and your next idea.
            </p>
            <span className="open-license">
              <span className="tiny-dot" /> MIT LICENSED
            </span>
          </div>
          <button
            className={`nav-item ${page === "settings" ? "selected" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} />
            <span>Workspace settings</span>
          </button>
          <button className="profile" onClick={() => navigate("settings")}>
            <span className="profile-avatar">
              {auth.user.name[0].toUpperCase()}
            </span>
            <span>
              <strong>{auth.user.name}</strong>
              <small>Workspace owner</small>
            </span>
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace<span>/</span>
            <strong>
              {page === "analytics"
                ? "Analytics"
                : page === "settings"
                  ? "Settings"
                  : folder
                    ? folders.find((f) => f.id === folder)?.name
                    : "My QR codes"}
            </strong>
          </div>
          <span className="topbar-open">
            <span className="tiny-dot" /> Open source, always
          </span>
        </header>
        <main className="main-content">
          {page === "settings" ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MAKE IT YOURS</span>
                  <h1>
                    Workspace settings<span>.</span>
                  </h1>
                  <p>A home for your codes. Owned by you.</p>
                </div>
              </div>
              <section className="settings-card">
                <div className="section-heading">
                  <h2>Your workspace</h2>
                  <ShieldCheck size={20} />
                </div>
                <dl>
                  <dt>Owner</dt>
                  <dd>{auth.user.name}</dd>
                  <dt>Email</dt>
                  <dd>{auth.user.email}</dd>
                  <dt>Public URL</dt>
                  <dd>{auth.publicUrl}</dd>
                  <dt>License</dt>
                  <dd>MIT · Open source</dd>
                  <dt>Storage</dt>
                  <dd>Self-hosted SQLite</dd>
                </dl>
                <div className="info-note">
                  <LockKeyhole size={19} />
                  <p>
                    QR codes and scan data stay on your server. Dynamic codes
                    need this server to remain online. Set a permanent public
                    URL before printing.
                  </p>
                </div>
                {/localhost|127\.0\.0\.1/.test(auth.publicUrl) && (
                  <div className="info-note amber">
                    <Globe size={19} />
                    <p>
                      This workspace uses a local URL. To scan dynamic codes
                      with a phone, configure PUBLIC_URL to a reachable address
                      and restart the server.
                    </p>
                  </div>
                )}
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await api("/auth/logout", {});
                      setCodes([]);
                      setFolders([]);
                      setAnalytics(null);
                      loadAuth();
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </section>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {page === "analytics"
                      ? "A CLOSER LOOK AT YOUR CONNECTIONS"
                      : "SMALL CODES. BIG POSSIBILITIES."}
                  </span>
                  <h1>
                    {page === "analytics"
                      ? "Every scan tells a story"
                      : folder
                        ? folders.find((f) => f.id === folder)?.name
                        : "Your connections start here"}
                    <span>.</span>
                  </h1>
                  <p>
                    {page === "analytics"
                      ? "See how people connect with your dynamic QR codes."
                      : "Create, manage, and see where your QR codes take people."}
                  </p>
                </div>
                <button
                  className="button primary create-main"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={18} />
                  Create QR code
                </button>
              </div>
              <section className="stats-grid">
                <div className="stat-card">
                  <div>
                    <span>Total QR codes</span>
                    <strong>{formatNumber(codes.length)}</strong>
                    <small>Little gateways to your world</small>
                  </div>
                  <span className="stat-icon green">
                    <QrCode size={21} />
                  </span>
                </div>
                <div className="stat-card">
                  <div>
                    <span>Total scans</span>
                    <strong>{formatNumber(totalScans)}</strong>
                    <small>
                      <span className="status-dot" /> All-time connections made
                    </small>
                  </div>
                  <span className="stat-icon peach">
                    <MousePointer2 size={21} />
                  </span>
                </div>
                <div className="stat-card">
                  <div>
                    <span>Active QR codes</span>
                    <strong>{formatNumber(active)}</strong>
                    <small>Ready for their next scan</small>
                  </div>
                  <span className="stat-icon lavender">
                    <Activity size={21} />
                  </span>
                </div>
              </section>
              <section className="activity-panel">
                <div className="section-heading">
                  <div>
                    <h2>
                      Scan activity{" "}
                      <span className="subtle-badge">DYNAMIC CODES</span>
                    </h2>
                    <p>
                      {analytics?.total
                        ? `${formatNumber(analytics.total)} connections in the last ${days} days`
                        : "Your next connection is just a scan away."}
                    </p>
                  </div>
                  <div className="chart-actions">
                    {page === "analytics" && (
                      <button
                        className="button secondary small"
                        onClick={() => analytics && exportCsv(analytics)}
                        disabled={!analytics}
                      >
                        <Download size={15} />
                        Export CSV
                      </button>
                    )}
                    <select
                      aria-label="Analytics time range"
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    >
                      <option value={7}>Last 7 days</option>
                      <option value={30}>Last 30 days</option>
                      <option value={90}>Last 90 days</option>
                    </select>
                  </div>
                </div>
                {page === "analytics" ? (
                  analyticsPanel(analytics)
                ) : (
                  <ScanChart analytics={analytics} />
                )}
              </section>
              {page === "codes" && (
                <section className="codes-section">
                  <div className="section-heading codes-heading">
                    <div className="codes-title">
                      <h2>
                        {folder
                          ? folders.find((f) => f.id === folder)?.name
                          : "Your QR codes"}
                      </h2>
                      <span className="count-badge">{filtered.length}</span>
                    </div>
                    <div className="codes-tools">
                      <div className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search QR codes"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search your codes…"
                        />
                      </div>
                      <div className="view-switch">
                        <button
                          aria-label="List view"
                          aria-pressed={view === "list"}
                          className={view === "list" ? "active" : ""}
                          onClick={() => setView("list")}
                        >
                          <List size={17} />
                        </button>
                        <button
                          aria-label="Grid view"
                          aria-pressed={view === "grid"}
                          className={view === "grid" ? "active" : ""}
                          onClick={() => setView("grid")}
                        >
                          <LayoutGrid size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="filter-tabs">
                    {[
                      ["all", "All codes"],
                      ["dynamic", "Dynamic"],
                      ["static", "Static"],
                      ["paused", "Paused"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={filter === id ? "active" : ""}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                        {id === "all" && (
                          <span>
                            {
                              codes.filter(
                                (c) => !folder || c.folderId === folder,
                              ).length
                            }
                          </span>
                        )}
                      </button>
                    ))}
                    <span className="saved-note">
                      <CheckCircle2 size={13} /> All changes saved
                    </span>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-illustration">
                        <div className="empty-mini-card">
                          <QrCode size={45} />
                        </div>
                        <span className="empty-leaf">✳</span>
                        <span className="empty-dot" />
                      </div>
                      <h3>
                        {codes.length
                          ? "No codes here just yet."
                          : "Your first connection is waiting."}
                      </h3>
                      <p>
                        {search
                          ? "Try a different name or clear your search."
                          : "A website, a Wi-Fi network, a little hello.\nTurn something you love into a QR code."}
                      </p>
                      <button
                        className="button primary"
                        onClick={() =>
                          search ? setSearch("") : setEditor("new")
                        }
                      >
                        {search ? (
                          <>
                            <X size={16} />
                            Clear search
                          </>
                        ) : (
                          <>
                            <Plus size={17} />
                            Create your first QR code
                          </>
                        )}
                      </button>
                      <span className="empty-footnote">
                        Free to create. Yours to keep.
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`code-list ${view === "grid" ? "grid-view" : ""}`}
                    >
                      {filtered.map((code) => {
                        const Icon = icons[code.type];
                        return (
                          <article className="code-row" key={code.id}>
                            <div className="code-qr">
                              <QrImage
                                content={codeContent(code)}
                                color={code.color}
                                size={76}
                              />
                            </div>
                            <div className="code-info">
                              <div className="code-name">
                                <h3>{code.name}</h3>
                                <span
                                  className={`code-status ${!code.active && code.dynamic ? "paused" : ""}`}
                                >
                                  <span />
                                  {!code.active && code.dynamic
                                    ? "Paused"
                                    : "Active"}
                                </span>
                              </div>
                              <div className="code-link">
                                <Icon size={13} />
                                <span>
                                  {code.type === "url"
                                    ? code.data.url
                                    : typeNames[code.type]}
                                </span>
                              </div>
                              <div className="code-meta">
                                <span
                                  className={`mode-badge ${!code.dynamic ? "static" : ""}`}
                                >
                                  {code.dynamic ? "Dynamic" : "Static"}
                                </span>
                                {code.folderId && (
                                  <span>
                                    <FolderIcon size={11} />
                                    {
                                      folders.find(
                                        (f) => f.id === code.folderId,
                                      )?.name
                                    }
                                  </span>
                                )}
                                <span>
                                  {new Date(code.createdAt).toLocaleDateString(
                                    undefined,
                                    { month: "short", day: "numeric" },
                                  )}
                                </span>
                              </div>
                            </div>
                            <button
                              className="scan-count"
                              disabled={!code.dynamic}
                              onClick={() => setDetail(code)}
                              title={
                                code.dynamic
                                  ? "View scan analytics"
                                  : "Static codes are not tracked"
                              }
                            >
                              <strong>
                                {code.dynamic ? formatNumber(code.scans) : "—"}
                              </strong>
                              <span>
                                {code.dynamic ? "scans" : "untracked"}
                              </span>
                            </button>
                            <div className="row-actions">
                              <a
                                className="button secondary small"
                                href={`/api/codes/${code.id}/download?format=png`}
                                title="Download PNG"
                              >
                                <ArrowDownToLine size={16} />
                                <span>Download</span>
                              </a>
                              <div className="menu-anchor">
                                <button
                                  className="icon-button"
                                  aria-label={`Actions for ${code.name}`}
                                  aria-expanded={menu === code.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenu(menu === code.id ? "" : code.id);
                                  }}
                                >
                                  <Ellipsis size={20} />
                                </button>
                                {menu === code.id && (
                                  <div
                                    className="dropdown"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={() => {
                                        setEditor(code);
                                        setMenu("");
                                      }}
                                    >
                                      <Pencil size={15} />
                                      Edit code
                                    </button>
                                    <button
                                      onClick={() => {
                                        copy(code);
                                        setMenu("");
                                      }}
                                    >
                                      <Copy size={15} />
                                      Copy{" "}
                                      {code.dynamic ? "short link" : "content"}
                                    </button>
                                    <a
                                      href={`/api/codes/${code.id}/download?format=svg`}
                                      onClick={() => setMenu("")}
                                    >
                                      <Download size={15} />
                                      Download SVG
                                    </a>
                                    {code.dynamic && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setDetail(code);
                                            setMenu("");
                                          }}
                                        >
                                          <BarChart3 size={15} />
                                          Scan analytics
                                        </button>
                                        <button
                                          onClick={() => {
                                            toggle(code);
                                            setMenu("");
                                          }}
                                        >
                                          {code.active ? (
                                            <Pause size={15} />
                                          ) : (
                                            <Play size={15} />
                                          )}{" "}
                                          {code.active ? "Pause" : "Resume"}{" "}
                                          link
                                        </button>
                                      </>
                                    )}
                                    <button
                                      className="danger"
                                      onClick={() => {
                                        setDeleteTarget(code);
                                        setMenu("");
                                      }}
                                    >
                                      <Trash2 size={15} />
                                      Delete code
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
              <div className="bottom-banner">
                <span className="banner-icon">
                  <Leaf size={19} />
                </span>
                <p>
                  <strong>Made for your ideas. Built on your terms.</strong>
                  <span>
                    {" "}
                    Open source, self-hosted, and a little more human.
                  </span>
                </p>
                <span className="banner-tag">NO PAYWALLS. EVER.</span>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              openqr. <span>· A little code goes a long way.</span>
            </span>
            <span>
              Crafted for the open web <ArrowUpRight size={12} />
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <Editor
          code={editor === "new" ? undefined : editor}
          folders={folders}
          publicUrl={auth.publicUrl}
          onClose={() => setEditor(null)}
          onSave={() => {
            notify(
              editor === "new"
                ? "Your QR code is ready. Download it and make a connection."
                : "Changes saved.",
            );
            setEditor(null);
            refresh();
            loadAnalytics();
          }}
        />
      )}{" "}
      {folderModal && (
        <Modal
          title="A home for your codes."
          onClose={() => setFolderModal(false)}
        >
          <form
            className="simple-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              try {
                await api("/folders", { name });
                setFolderModal(false);
                refresh();
                notify("Folder created.");
              } catch (e) {
                setFolderError((e as Error).message);
              }
            }}
          >
            <p>
              Keep your campaigns, projects, and little experiments together.
            </p>
            <label>
              Folder name
              <input
                name="name"
                required
                maxLength={60}
                placeholder="e.g. Marketing"
                autoFocus
              />
            </label>
            {folderError && (
              <p className="form-error" role="alert">
                {folderError}
              </p>
            )}
            <button className="button primary full">
              <FolderPlus size={17} />
              Create folder
            </button>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title="Delete this QR code?"
          onClose={() => setDeleteTarget(null)}
        >
          <div className="simple-form">
            <p>
              <strong>{deleteTarget.name}</strong> and its scan history will be
              permanently deleted.
              {deleteTarget.dynamic
                ? " Printed copies will stop working."
                : " Printed static copies will still contain their original content."}
            </p>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Keep it
              </button>
              <button className="button danger-button" onClick={remove}>
                <Trash2 size={16} />
                Delete code
              </button>
            </div>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal wide title={detail.name} onClose={() => setDetail(null)}>
          <div className="detail-content">
            <div className="detail-summary">
              <div>
                <span className="small-label">
                  SCANS IN THE LAST {days} DAYS
                </span>
                <h2>{formatNumber(detailData?.total || 0)}</h2>
              </div>
              <button
                className="button secondary small"
                onClick={() => detailData && exportCsv(detailData)}
                disabled={!detailData}
              >
                <Download size={16} />
                Export CSV
              </button>
            </div>
            {analyticsPanel(detailData)}
            <p className="hint">
              Times are grouped by UTC date. Visits to the tracking link count
              as scans; bots may be included.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
