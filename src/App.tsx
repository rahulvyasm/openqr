import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Folder as FolderIcon,
  FolderPlus,
  LayoutGrid,
  Leaf,
  List,
  Loader2,
  Menu,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  Palette,
  Upload,
  ExternalLink,
  CalendarClock,
  RefreshCw,
} from "lucide-react";
import {
  api,
  codeContent,
  exportCsv,
  formatNumber,
  typeNames,
  type Analytics,
  type Code,
  type DesignTemplate,
  type Folder,
  type AuthState,
  mayEdit,
} from "./lib";
import "./styles.css";
import "./advanced.css";
import "./team.css";
import "./publishing.css";
import "./collections.css";
import MediaLibrary from "./components/MediaLibrary";
import AccessFlow, {
  readAccessLink,
  type AccessLink,
} from "./components/AccessFlow";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import SettingsView from "./components/SettingsView";
import Modal from "./components/Modal";
import QrImage from "./components/QrImage";
import Editor from "./components/Editor";
import BulkImport from "./components/BulkImport";
import DesignStudio from "./components/DesignStudio";
import BatchBar from "./components/BatchBar";
import DownloadDialog from "./components/DownloadDialog";
import AnalyticsDetails from "./components/AnalyticsDetails";
import StudioHero, { type StudioDraft } from "./components/StudioHero";
import CommandMenu from "./components/CommandMenu";
import CampaignPulse from "./components/CampaignPulse";
import ProfileMenu from "./components/ProfileMenu";
import PlansView from "./components/PlansView";
import ScanChart from "./components/ScanChart";
import "./studio.css";
import { typeIcons as icons } from "./components/codeTypes";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
const OperatorConsole = React.lazy(
  () => import("./components/OperatorConsole"),
);

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
function Auth({ setup, onSuccess }: { setup: boolean; onSuccess: () => void }) {
  const [recoveryHelp, setRecoveryHelp] = useState(false);
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
          <span className="small-label">OPENQR / YOUR CONNECTION STUDIO</span>
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
          {!setup && (
            <button
              className="text-button forgot-password"
              onClick={() => setRecoveryHelp(true)}
            >
              Forgot your password?
            </button>
          )}
          {recoveryHelp && (
            <Modal
              title="Let’s get you back in."
              onClose={() => setRecoveryHelp(false)}
            >
              <div className="simple-form">
                <p>
                  Ask your OpenQR server operator for a password recovery link.
                  The link works once and expires in 30 minutes. If you run this
                  server, follow the account recovery instructions in the
                  project README.
                </p>
                <button
                  className="button primary full"
                  onClick={() => setRecoveryHelp(false)}
                >
                  Got it
                </button>
              </div>
            </Modal>
          )}
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
export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [accessLink, setAccessLink] = useState<AccessLink | null>(
    readAccessLink,
  );
  const generation = useRef(0);
  const scopeId = useRef("");
  const [bootError, setBootError] = useState("");
  const [codes, setCodes] = useState<Code[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(() =>
    window.location.pathname === "/control-room" ? "operator" : "codes",
  );
  const [settingsTab, setSettingsTab] = useState("team");
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [supportAlerts, setSupportAlerts] = useState({ staff: 0, mine: 0 });
  useEffect(() => {
    if (!auth?.user) return;
    let active = true;
    const load = () =>
      Promise.all([
        api<{ count: number }>("/support/unread"),
        auth?.operator
          ? api<{ count: number }>("/operator/cases/attention")
          : Promise.resolve({ count: 0 }),
      ])
        .then(([mine, staff]) => {
          if (active)
            setSupportAlerts({ mine: mine.count, staff: staff.count });
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener("support-changed", load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("support-changed", load);
    };
  }, [auth?.user, auth?.operator]);
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
  const [compactNav, setCompactNav] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setCompactNav(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !compactNav) return;
    sidebarRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNav(false);
        navToggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [mobileNav, compactNav]);
  const [folderError, setFolderError] = useState("");
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [initialDesign, setInitialDesign] = useState<
    DesignTemplate | undefined
  >();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [download, setDownload] = useState<Code | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [commandOpen, setCommandOpen] = useState(false);
  const [draft, setDraft] = useState<StudioDraft | undefined>();
  const [sort, setSort] = useState("newest");
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!auth?.user || !auth.workspace) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("dialog[open]") && !commandOpen) return;
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      const target = event.target as HTMLElement;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog[open]',
        ) ||
        document.querySelector("dialog[open]")
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key.toLowerCase() === "n" && mayEdit(auth.workspace.role)) {
        event.preventDefault();
        setDraft(undefined);
        setInitialDesign(undefined);
        setEditor("new");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [auth?.user?.id, auth?.workspace?.id, auth?.workspace?.role, commandOpen]);
  const loadTemplates = () => {
    const run = generation.current;
    return api<DesignTemplate[]>("/templates")
      .then((data) => {
        if (run === generation.current) setTemplates(data);
      })
      .catch((e) => {
        if (run === generation.current) notify(e.message);
      });
  };
  const notify = (text: string) => setToast(text);
  const loadAuth = () =>
    api<AuthState>("/auth/status")
      .then((data) => {
        const scope = `${data.user?.id || ""}/${data.workspace?.id || ""}`;
        if (scope !== scopeId.current) {
          generation.current++;
          scopeId.current = scope;
          setCodes([]);
          setFolders([]);
          setTemplates([]);
          setAnalytics(null);
          setSelection([]);
          setFolder("");
          setDetail(null);
          setEditor(null);
          setCommandOpen(false);
          setDraft(undefined);
        }
        setAuth(data);
        if (
          data.user &&
          !data.operator &&
          window.location.pathname === "/control-room"
        ) {
          window.history.replaceState(null, "", "/");
          setPage("codes");
        } else if (data.operator && !data.workspace) setPage("operator");
      })
      .catch((e) => setBootError(e.message));
  const refresh = async () => {
    const run = generation.current;
    try {
      const [c, f] = await Promise.all([
        api<Code[]>("/codes"),
        api<Folder[]>("/folders"),
      ]);
      if (run !== generation.current) return;
      setCodes(c);
      setSelection((ids) =>
        ids.filter((id) => c.some((code) => code.id === id)),
      );
      setFolders(f);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const loadAnalytics = () => {
    const run = generation.current;
    return api<Analytics>(`/analytics?days=${days}`)
      .then((data) => {
        if (run === generation.current) setAnalytics(data);
      })
      .catch((e) => {
        if (run === generation.current) notify(e.message);
      });
  };
  useEffect(() => {
    loadAuth();
    const fromRoute = () => {
      setPage(
        window.location.pathname === "/control-room" ? "operator" : "codes",
      );
      setMobileNav(false);
    };
    window.addEventListener("popstate", fromRoute);
    const expire = () => setAuth((a) => (a ? { ...a, user: null } : a));
    window.addEventListener("session-expired", expire);
    const reloadAuth = () => {
      generation.current++;
      setCodes([]);
      setFolders([]);
      setTemplates([]);
      setAnalytics(null);
      setEditor(null);
      setSelection([]);
      loadAuth();
    };
    const fromHash = () => {
      const link = readAccessLink();
      if (link) {
        setAccessLink(link);
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("permissions-changed", reloadAuth);
    return () => {
      window.removeEventListener("popstate", fromRoute);
      window.removeEventListener("session-expired", expire);
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("permissions-changed", reloadAuth);
    };
  }, []);
  useEffect(() => {
    if (auth?.user && auth.workspace) {
      refresh();
      loadAnalytics();
      loadTemplates();
    }
  }, [auth?.user?.id, auth?.workspace?.id, auth?.workspace?.role, days]);
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
  useEffect(() => {
    setPageNumber(1);
    setSelection([]);
  }, [search, filter, folder, sort]);
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
  if (accessLink)
    return (
      <AccessFlow
        link={accessLink}
        user={auth.user}
        onAuthChange={loadAuth}
        onDone={() => {
          setAccessLink(null);
          setPage("codes");
          loadAuth();
        }}
      />
    );
  if (!auth.user)
    return <Auth setup={auth.setupRequired} onSuccess={loadAuth} />;
  const canEdit = mayEdit(auth.workspace?.role);
  const workspaceChanged = () => {
    generation.current++;
    setCodes([]);
    setFolders([]);
    setAnalytics(null);
    setTemplates([]);
    setSelection([]);
    setFolder("");
    setEditor(null);
    setDetail(null);
    setPage("codes");
    loadAuth();
  };
  const signOut = async () => {
    try {
      await api("/auth/logout", {});
      generation.current++;
      setCodes([]);
      setFolders([]);
      setAnalytics(null);
      setTemplates([]);
      loadAuth();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const totalScans = codes.reduce((n, c) => n + c.scans, 0);
  const active = codes.filter(
    (c) =>
      c.active &&
      (!c.campaign.startsAt || +new Date(c.campaign.startsAt) <= Date.now()) &&
      (!c.campaign.expiresAt || +new Date(c.campaign.expiresAt) > Date.now()) &&
      (!c.campaign.scanLimit || c.scans < c.campaign.scanLimit),
  ).length;
  const codeStatus = (c: Code) =>
    !c.active && c.dynamic
      ? "Paused"
      : c.campaign.startsAt && +new Date(c.campaign.startsAt) > Date.now()
        ? "Scheduled"
        : c.campaign.expiresAt && +new Date(c.campaign.expiresAt) <= Date.now()
          ? "Expired"
          : c.campaign.scanLimit && c.scans >= c.campaign.scanLimit
            ? "Limit reached"
            : "Active";
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
  filtered.sort((a, b) =>
    sort === "scans"
      ? b.scans - a.scans || a.name.localeCompare(b.name)
      : sort === "name"
        ? a.name.localeCompare(b.name)
        : Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const visibleCodes = filtered.slice((pageNumber - 1) * 20, pageNumber * 20);
  const createDraft = (value: StudioDraft) => {
    setDraft(value);
    setInitialDesign(undefined);
    setEditor("new");
  };
  const navigate = (next: string, f = "") => {
    const nextPath = next === "operator" ? "/control-room" : "/";
    if (window.location.pathname !== nextPath)
      window.history.pushState(null, "", nextPath);
    window.scrollTo(0, 0);
    setPage(next);
    setSelection([]);
    setFolder(f);
    setMobileNav(false);
    setSearch("");
    setFilter("all");
    if (next === "codes" || next === "analytics") {
      refresh();
      loadAnalytics();
    }
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
        ref={navToggleRef}
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        aria-expanded={mobileNav}
        aria-controls="workspace-navigation"
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu />
      </button>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => {
            setMobileNav(false);
            navToggleRef.current?.focus();
          }}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={sidebarRef}
        aria-label="Workspace navigation"
        inert={compactNav && !mobileNav}
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
        onKeyDown={(event) => {
          if (!mobileNav || !compactNav || event.key !== "Tab") return;
          const targets = Array.from(
            sidebarRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),a[href],input:not(:disabled)",
            ) || [],
          ).filter((element) => element.getClientRects().length > 0);
          const first = targets[0],
            last = targets.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <Brand />
        <WorkspaceSwitcher
          workspace={auth.workspace}
          workspaces={auth.workspaces}
          onChange={workspaceChanged}
          notify={notify}
        />
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {auth.operator && (
            <button
              className={`nav-item ${page === "operator" ? "selected" : ""}`}
              onClick={() => navigate("operator")}
            >
              <ShieldCheck size={19} />
              <span>Control room</span>
              {supportAlerts.staff > 0 ? (
                <span
                  className="nav-alert"
                  aria-label={`${supportAlerts.staff} support requests need a reply`}
                >
                  {supportAlerts.staff}
                </span>
              ) : (
                <span className="nav-new">PLATFORM</span>
              )}
            </button>
          )}
          <button
            className={
              page === "codes" && !folder ? "nav-item selected" : "nav-item"
            }
            onClick={() => navigate("codes")}
          >
            <QrCode size={19} />
            <span>QR workspace</span>
            <span className="nav-count">{codes.length}</span>
          </button>
          <button
            className={page === "analytics" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("analytics")}
          >
            <BarChart3 size={19} />
            <span>Analytics</span>
          </button>
          <button
            className={page === "designs" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("designs")}
          >
            <Palette size={19} />
            <span>Design studio</span>
            <span className="nav-new">CREATE</span>
          </button>
          <button
            className={page === "media" ? "nav-item selected" : "nav-item"}
            onClick={() => navigate("media")}
          >
            <Upload size={19} />
            <span>Media library</span>
          </button>
        </nav>
        <div className="nav-label folder-label">
          <span>FOLDERS</span>
          <button
            aria-label="Add folder"
            disabled={!canEdit}
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
              disabled={!canEdit}
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
            <strong>Yours. All the way.</strong>
            <p>
              Independent. Self-hosted.
              <br />
              Your connections, your control.
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
            {supportAlerts.mine > 0 && (
              <span
                className="nav-alert"
                aria-label={`${supportAlerts.mine} new support replies`}
              >
                {supportAlerts.mine}
              </span>
            )}
          </button>
          {auth.workspace && (
            <button
              className={`nav-item ${page === "plans" ? "selected" : ""}`}
              onClick={() => navigate("plans")}
            >
              <ShieldCheck size={18} />
              <span>Plans &amp; usage</span>
            </button>
          )}
          <ProfileMenu
            name={auth.user.name}
            role={auth.workspace?.role || "Account"}
            onAccount={() => {
              setSettingsTab("account");
              setSettingsVisit((v) => v + 1);
              navigate("settings");
            }}
            onWorkspace={() => {
              setSettingsTab("workspace");
              setSettingsVisit((v) => v + 1);
              navigate("settings");
            }}
            onTeam={() => {
              setSettingsTab("team");
              setSettingsVisit((v) => v + 1);
              navigate("settings");
            }}
            onSignOut={signOut}
          />
        </div>
      </aside>
      <div className="main-shell" inert={compactNav && mobileNav}>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace<span>/</span>
            <strong>
              {page === "operator"
                ? "Platform control room"
                : page === "plans"
                  ? "Plans & usage"
                  : page === "analytics"
                    ? "Analytics"
                    : page === "designs"
                      ? "Design studio"
                      : page === "media"
                        ? "Media library"
                        : page === "settings"
                          ? "Settings"
                          : folder
                            ? folders.find((f) => f.id === folder)?.name
                            : "QR workspace"}
            </strong>
          </div>
          <button
            className="command-trigger"
            onClick={() => setCommandOpen(true)}
            aria-label="Open command menu"
          >
            <Search size={15} />
            <span>Jump to anything</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="topbar-open">
            <span className="signal-dot" /> INDEPENDENT BY DESIGN
          </span>
        </header>
        <main className="main-content" key={page}>
          {page === "operator" && auth.operator ? (
            <React.Suspense
              fallback={
                <div className="operator-loading">
                  <Loader2 className="spin" />
                  Loading company console…
                </div>
              }
            >
              <OperatorConsole userId={auth.user.id} />
            </React.Suspense>
          ) : !auth.workspace && page !== "settings" ? (
            <section className="settings-panel workspace-welcome">
              <h2>A fresh workspace awaits.</h2>
              <p>
                Open the workspace menu to create a place for your next idea.
                Your account settings are always available.
              </p>
            </section>
          ) : page === "plans" ? (
            <PlansView key={auth.workspace?.id} />
          ) : page === "media" ? (
            <MediaLibrary key={auth.workspace?.id} canEdit={canEdit} />
          ) : page === "designs" ? (
            <DesignStudio
              canEdit={canEdit}
              templates={templates}
              onCreate={(t) => {
                setInitialDesign(t);
                setEditor("new");
              }}
              onRefresh={loadTemplates}
              notify={notify}
            />
          ) : page === "settings" ? (
            <SettingsView
              key={`${auth.workspace?.id}:${settingsTab}:${settingsVisit}`}
              initialTab={settingsTab}
              auth={auth}
              onAuthChange={loadAuth}
              onSignOut={signOut}
              notify={notify}
            />
          ) : (
            <>
              {page === "codes" && !folder ? (
                <StudioHero canEdit={canEdit} onCreate={createDraft} />
              ) : (
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">
                      {page === "analytics"
                        ? "THE SIGNAL BEHIND EVERY SCAN"
                        : "YOUR CAMPAIGN COLLECTION"}
                    </span>
                    <h1>
                      {page === "analytics"
                        ? "Follow the signal"
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
                  {canEdit ? (
                    <div className="heading-actions">
                      {page === "codes" && (
                        <button
                          className="button secondary"
                          onClick={() => setBulkOpen(true)}
                        >
                          <Upload size={16} />
                          Import CSV
                        </button>
                      )}
                      <button
                        className="button primary create-main"
                        onClick={() => {
                          setInitialDesign(undefined);
                          setEditor("new");
                        }}
                      >
                        <Plus size={18} />
                        Create QR code
                      </button>
                    </div>
                  ) : (
                    <span className="viewer-notice">
                      Viewer access · Browse and download
                    </span>
                  )}
                </div>
              )}
              <section className="stats-grid">
                <div className="stat-card">
                  <div>
                    <span>Total QR codes</span>
                    <strong>{formatNumber(codes.length)}</strong>
                    <small>Across your workspace</small>
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
                      <span className="status-dot" /> All-time dynamic link
                      visits
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
                    <small>Available to connect</small>
                  </div>
                  <span className="stat-icon lavender">
                    <Activity size={21} />
                  </span>
                </div>
              </section>
              <div className={page === "codes" ? "dashboard-signals" : ""}>
                <section className="activity-panel">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Scan activity{" "}
                        <span className="subtle-badge">DYNAMIC CODES</span>
                      </h2>
                      <p>
                        {analytics?.total
                          ? `Explore your traffic. Hover or use arrow keys on the chart.`
                          : "Every connection starts with a scan."}
                      </p>
                    </div>
                    <div className="chart-actions">
                      <button
                        className="icon-button"
                        aria-label="Refresh scan analytics"
                        title="Refresh scan analytics"
                        onClick={() => {
                          refresh();
                          loadAnalytics();
                        }}
                      >
                        <RefreshCw size={14} />
                      </button>
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
                  <CampaignPulse
                    analytics={analytics}
                    codes={codes}
                    onCode={setDetail}
                    onAnalytics={() => navigate("analytics")}
                  />
                )}
              </div>
              {page === "analytics" && (
                <AnalyticsDetails
                  data={analytics}
                  onCode={(id) =>
                    setDetail(codes.find((c) => c.id === id) || null)
                  }
                />
              )}
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
                      {canEdit && (
                        <button
                          className="button secondary small"
                          onClick={() => setBulkOpen(true)}
                        >
                          <Upload size={14} /> Import CSV
                        </button>
                      )}
                      <select
                        className="sort-codes"
                        aria-label="Sort QR codes"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="newest">Newest first</option>
                        <option value="scans">Most scanned</option>
                        <option value="name">Name A–Z</option>
                      </select>
                      {filtered.length > 0 && (
                        <label className="select-all">
                          <input
                            type="checkbox"
                            aria-label="Select all codes on this page"
                            checked={
                              visibleCodes.length > 0 &&
                              visibleCodes.every((c) =>
                                selection.includes(c.id),
                              )
                            }
                            onChange={(e) =>
                              setSelection(
                                e.target.checked
                                  ? [
                                      ...new Set([
                                        ...selection,
                                        ...visibleCodes.map((c) => c.id),
                                      ]),
                                    ].slice(0, 100)
                                  : selection.filter(
                                      (id) =>
                                        !visibleCodes.some((c) => c.id === id),
                                    ),
                              )
                            }
                          />
                          <span>Select page</span>
                        </label>
                      )}
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
                      <CheckCircle2 size={13} /> {filtered.length} in view
                    </span>
                  </div>
                  {selection.length > 0 && (
                    <BatchBar
                      canEdit={canEdit}
                      ids={selection}
                      codes={codes}
                      folders={folders}
                      onClear={() => setSelection([])}
                      onDone={() => {
                        setSelection([]);
                        refresh();
                        loadAnalytics();
                      }}
                      notify={notify}
                    />
                  )}
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
                          : "A blank canvas. A real opportunity."}
                      </h3>
                      <p>
                        {search
                          ? "Try a different name or clear your search."
                          : "Start with a website, document, or experience.\nYour first code is a few clicks away."}
                      </p>
                      <button
                        className="button primary"
                        disabled={!canEdit && !search}
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
                      {visibleCodes.map((code) => {
                        const Icon = icons[code.type];
                        return (
                          <article
                            className={`code-row ${selection.includes(code.id) ? "is-selected" : ""}`}
                            key={code.id}
                          >
                            <input
                              className="row-check"
                              type="checkbox"
                              aria-label={`Select ${code.name}`}
                              checked={selection.includes(code.id)}
                              disabled={
                                selection.length >= 100 &&
                                !selection.includes(code.id)
                              }
                              onChange={(e) =>
                                setSelection((ids) =>
                                  e.target.checked
                                    ? [...ids, code.id]
                                    : ids.filter((id) => id !== code.id),
                                )
                              }
                            />
                            <div className="code-qr">
                              <QrImage
                                content={codeContent(code)}
                                color={code.color}
                                design={code.design}
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
                                  {codeStatus(code)}
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
                                {(code.campaign.startsAt ||
                                  code.campaign.expiresAt ||
                                  code.campaign.scanLimit) && (
                                  <span title="Campaign rules enabled">
                                    <CalendarClock size={11} />
                                    Campaign
                                  </span>
                                )}
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
                              <button
                                className="button secondary small"
                                onClick={() => setDownload(code)}
                                title="Download QR code"
                              >
                                <ArrowDownToLine size={16} />
                                <span>Download</span>
                              </button>
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
                                    {canEdit && (
                                      <button
                                        onClick={() => {
                                          setEditor(code);
                                          setMenu("");
                                        }}
                                      >
                                        <Pencil size={15} />
                                        Edit code
                                      </button>
                                    )}
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
                                    <button
                                      disabled={!canEdit}
                                      onClick={async () => {
                                        try {
                                          await api(
                                            `/codes/${code.id}/duplicate`,
                                            {},
                                          );
                                          refresh();
                                          notify(
                                            "A fresh copy is ready, with its own tracking link.",
                                          );
                                        } catch (e) {
                                          notify((e as Error).message);
                                        }
                                        setMenu("");
                                      }}
                                    >
                                      <Copy size={15} />
                                      Duplicate code
                                    </button>
                                    {code.dynamic && (
                                      <>
                                        <a
                                          href={code.shortUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={() => setMenu("")}
                                        >
                                          <ExternalLink size={15} />
                                          Open destination
                                        </a>
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
                                          disabled={!canEdit}
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
                                      disabled={!canEdit}
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
                  {filtered.length > 20 && (
                    <div className="pagination">
                      <span>
                        {(pageNumber - 1) * 20 + 1}–
                        {Math.min(pageNumber * 20, filtered.length)} of{" "}
                        {filtered.length} codes
                      </span>
                      <div>
                        <button
                          className="button secondary small"
                          disabled={pageNumber === 1}
                          onClick={() => setPageNumber((n) => n - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {pageNumber}</span>
                        <button
                          className="button secondary small"
                          disabled={pageNumber * 20 >= filtered.length}
                          onClick={() => setPageNumber((n) => n + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
              <div className="bottom-banner">
                <span className="banner-icon">
                  <Leaf size={19} />
                </span>
                <p>
                  <strong>Small square. Open possibilities.</strong>
                  <span> Designed to connect the physical and digital.</span>
                </p>
                <span className="banner-tag">NO PAYWALLS. EVER.</span>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              openqr. <span> / THE CONNECTION STUDIO</span>
            </span>
            <span>
              Crafted for the open web <ArrowUpRight size={12} />
            </span>
          </footer>
        </main>
      </div>
      {commandOpen && (
        <CommandMenu
          codes={codes}
          canEdit={canEdit}
          onNavigate={navigate}
          onCreate={() => {
            setDraft(undefined);
            setInitialDesign(undefined);
            setEditor("new");
          }}
          onCode={(code) => {
            if (code.dynamic) setDetail(code);
            else if (canEdit) setEditor(code);
            else setDownload(code);
          }}
          onClose={() => setCommandOpen(false)}
        />
      )}
      {editor && (
        <Editor
          code={editor === "new" ? undefined : editor}
          folders={folders}
          publicUrl={auth.publicUrl}
          templates={templates}
          initialDesign={editor === "new" ? initialDesign : undefined}
          initialFolder={folder}
          initialDraft={editor === "new" ? draft : undefined}
          onTemplates={loadTemplates}
          onClose={() => {
            setEditor(null);
            setDraft(undefined);
          }}
          onSave={() => {
            notify(
              editor === "new"
                ? "Your QR code is ready. Download it and make a connection."
                : "Changes saved.",
            );
            setEditor(null);
            setDraft(undefined);
            setPage("codes");
            refresh();
            loadAnalytics();
          }}
        />
      )}{" "}
      {bulkOpen && (
        <BulkImport
          folders={folders}
          templates={templates}
          initialFolder={folder}
          onClose={() => setBulkOpen(false)}
          onSave={() => {
            setBulkOpen(false);
            refresh();
            loadAnalytics();
            notify(
              "Your QR collection is ready. Select your codes to download them together.",
            );
          }}
        />
      )}
      {download && (
        <DownloadDialog code={download} onClose={() => setDownload(null)} />
      )}
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
            <AnalyticsDetails data={detailData} onCode={() => {}} />
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
