import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Building2,
  Check,
  Database,
  Eye,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api, formatNumber } from "../lib";
import Modal from "./Modal";
import StaffPanel from "./StaffPanel";
import OperatorBilling from "./OperatorBilling";
import {
  CustomerDialog,
  OperatorAudit,
  OperatorCases,
} from "./OperatorSupport";
import { staffRoles } from "../../shared/operator-access.js";

type WorkspaceRow = {
  id: string;
  name: string;
  ownerName: string;
  members: number;
  codes: number;
  scans: number;
  mediaBytes: number;
  createdAt: string;
};
type UserRow = {
  id: string;
  name: string;
  email: string;
  workspaces: number;
  sessions: number;
  operator: boolean;
};
type Listing<T> = { rows: T[]; total: number; page: number; pageSize: number };
type Event = {
  id: number;
  event: string;
  at: string;
  workspace: string;
  actor: string;
  name: string;
};
type Snapshot = {
  access: { role: string; label: string; permissions: string[] };
  at: string;
  refreshSeconds: number;
  totals: {
    users: number;
    workspaces: number;
    codes: number;
    scans: number;
    scans24h: number;
    scans15m: number;
    sessions: number;
    mediaBytes: number;
    mediaFiles: number;
    paused: number;
  };
  daily: { date: string; scans: number }[];
  hourly: { hour: string; scans: number }[];
  types: { type: string; count: number }[];
  roles: { role: string; count: number }[];
  events: Event[];
  operatorEvents: {
    id: string;
    event: string;
    at: string;
    actor: string;
    count: number | null;
  }[];
  operations: {
    uptimeSeconds: number;
    storageBackend: string;
    workspaceQuotaBytes: number;
    maxUploadBytes: number;
    publicUrl: string;
    backup: {
      state: string;
      lastAttemptAt?: string;
      lastSuccessAt?: string;
      localCompletedAt?: string;
      remoteCompletedAt?: string;
      failureStage?: string;
      intervalHours: number | null;
      retention: number | null;
      remoteEnabled: boolean;
      available: boolean;
    };
  } | null;
};
const size = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`;
const time = (value?: string) =>
  value ? new Date(value).toLocaleString() : "None recorded";
const eventName = (value: string) =>
  value
    .replace(/^code\./, "QR · ")
    .replace(/^operator\./, "Operator · ")
    .replace(/[._]/g, " ");

export default function OperatorConsole({ userId }: { userId: string }) {
  const [tab, setTab] = useState("overview"),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false),
    [revision, setRevision] = useState(0),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    [workspaces, setWorkspaces] = useState<Listing<WorkspaceRow> | null>(null),
    [users, setUsers] = useState<Listing<UserRow> | null>(null),
    [tableError, setTableError] = useState(""),
    [revoke, setRevoke] = useState<UserRow | null>(null),
    [customer, setCustomer] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [message, setMessage] = useState("");
  const requiredAccess: Record<string, string> = {
    workspaces: "workspaces:read",
    people: "users:read",
    activity: "activity:read",
    operations: "operations:read",
    staff: "staff:manage",
    billing: "billing:manage",
    cases: "cases:manage",
    audit: "audit:read",
  };
  const can = (permission: string) =>
    !!snapshot?.access.permissions.includes(permission);
  const view =
    requiredAccess[tab] && !can(requiredAccess[tab]) ? "overview" : tab;
  useEffect(() => {
    let active = true,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api<Snapshot>("/operator/overview");
        if (active) {
          setSnapshot(data);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = paused ? null : window.setInterval(load, 5000);
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [paused, revision]);
  useEffect(() => {
    if (!["workspaces", "people"].includes(view)) return;
    let active = true;
    setTableError("");
    setUsers(null);
    setWorkspaces(null);
    const timer = window.setTimeout(() => {
      api<Listing<WorkspaceRow> | Listing<UserRow>>(
        `/operator/${view === "people" ? "users" : "workspaces"}?q=${encodeURIComponent(q)}&page=${page}`,
      )
        .then((data) => {
          if (active) {
            if (view === "people") setUsers(data as Listing<UserRow>);
            else setWorkspaces(data as Listing<WorkspaceRow>);
          }
        })
        .catch((e) => {
          if (active) setTableError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [view, q, page, revision]);
  const changeTab = (next: string) => {
    setTab(next);
    setQ("");
    setPage(0);
  };
  const events = (rows: Event[]) =>
    rows.length ? (
      <div className="operator-feed">
        {rows.map((event) => (
          <article key={event.id}>
            <span
              className={`operator-event-mark ${event.event.includes("deleted") || event.event.includes("removed") ? "warning" : ""}`}
            >
              <Activity size={14} />
            </span>
            <div>
              <strong>{eventName(event.event)}</strong>
              <p>
                {event.name ? `${event.name} · ` : ""}
                {event.workspace}
              </p>
              <small>{event.actor}</small>
            </div>
            <time dateTime={event.at}>
              {new Date(event.at).toLocaleTimeString()}
            </time>
          </article>
        ))}
      </div>
    ) : (
      <p className="operator-empty">
        {can("activity:read")
          ? "No activity recorded yet. New workspace actions appear here."
          : "Your company role has access to aggregate analytics. Customer activity is restricted to authorized departments."}
      </p>
    );
  const listing = view === "people" ? users : workspaces;
  return (
    <div className="operator-console">
      <div className="operator-heading">
        <div>
          <span className="studio-kicker">
            <ShieldCheck size={14} /> OPENQR / PLATFORM OPERATIONS
          </span>
          <h1>
            The control room<span>.</span>
          </h1>
          <p>One installation. Every workspace. A clear view of the signal.</p>
        </div>
        <span className="operator-access">
          <LockKeyhole size={13} />{" "}
          {snapshot?.access.label.toUpperCase() || "COMPANY STAFF"}
        </span>
      </div>
      <div className="operator-toolbar">
        <div className={`operator-refresh-state ${paused ? "paused" : ""}`}>
          <span className="signal-dot" />
          {paused ? "Updates paused" : "Auto-refresh · 5 seconds"}
          <small>
            {snapshot
              ? `Updated ${new Date(snapshot.at).toLocaleTimeString()}`
              : "Connecting…"}
          </small>
        </div>
        <div>
          <button
            className="button secondary small"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}{" "}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="button secondary small"
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error} {snapshot && "Showing the last successful snapshot."}
        </p>
      )}
      {message && (
        <div className="operator-message" role="status">
          <Check size={15} />
          {message}
          <button
            className="icon-button"
            aria-label="Dismiss operator message"
            onClick={() => setMessage("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="operator-tabs" aria-label="Operator sections">
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "workspaces", label: "Workspaces", icon: Building2 },
          { id: "people", label: "People", icon: Users },
          { id: "activity", label: "Activity", icon: Eye },
          { id: "operations", label: "Operations", icon: Server },
          { id: "staff", label: "Company staff", icon: Users },
          { id: "cases", label: "Cases", icon: LifeBuoy },
          { id: "billing", label: "Billing", icon: Database },
          { id: "audit", label: "Staff audit", icon: Eye },
          { id: "access", label: "Access model", icon: ShieldCheck },
        ]
          .filter(
            (item) => !requiredAccess[item.id] || can(requiredAccess[item.id]),
          )
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => changeTab(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
      </div>
      {!snapshot && !error ? (
        <div className="operator-loading">
          <Loader2 className="spin" />
          Loading installation data…
        </div>
      ) : (
        snapshot && (
          <>
            {view === "overview" && (
              <>
                <div className="operator-metrics">
                  {[
                    {
                      label: "Workspaces",
                      value: snapshot.totals.workspaces,
                      detail: "Across this installation",
                    },
                    {
                      label: "Accounts",
                      value: snapshot.totals.users,
                      detail: `${snapshot.totals.sessions} valid sessions`,
                    },
                    {
                      label: "QR codes",
                      value: snapshot.totals.codes,
                      detail: `${snapshot.totals.paused} dynamic links paused`,
                    },
                    {
                      label: "Visits · last 24h",
                      value: snapshot.totals.scans24h,
                      detail: `${snapshot.totals.scans15m} in the last 15 minutes`,
                    },
                  ].map((metric) => (
                    <article key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{formatNumber(metric.value)}</strong>
                      <small>{metric.detail}</small>
                    </article>
                  ))}
                </div>
                <div className="operator-overview-grid">
                  <section className="operator-card operator-traffic">
                    <div className="operator-card-heading">
                      <div>
                        <span className="studio-kicker">
                          TRAFFIC / LAST 24 HOURS
                        </span>
                        <h2>Every connection, counted.</h2>
                      </div>
                      <strong>
                        {formatNumber(snapshot.totals.scans24h)}
                        <small>successful visits</small>
                      </strong>
                    </div>
                    <div
                      className="operator-bars"
                      aria-label="Hourly successful dynamic link visits in UTC"
                    >
                      {snapshot.hourly.map((hour) => (
                        <div
                          key={hour.hour}
                          title={`${hour.hour.replace("T", " ")}:00 UTC · ${hour.scans} visits`}
                        >
                          <i
                            style={{
                              height: `${Math.max(2, (hour.scans / Math.max(1, ...snapshot.hourly.map((h) => h.scans))) * 100)}%`,
                            }}
                          />
                          <span>{hour.hour.slice(11)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="hint">
                      UTC hour buckets. Dynamic link visits include clicks and
                      bots. Static codes are not tracked.
                    </p>
                  </section>
                  <section className="operator-card operator-system">
                    <span className="studio-kicker">SYSTEM SNAPSHOT</span>
                    <h2>Built on real activity.</h2>
                    <dl>
                      <dt>Recorded visits</dt>
                      <dd>{formatNumber(snapshot.totals.scans)}</dd>
                      <dt>Media files</dt>
                      <dd>{formatNumber(snapshot.totals.mediaFiles)}</dd>
                      <dt>Media stored</dt>
                      <dd>{size(snapshot.totals.mediaBytes)}</dd>
                      {snapshot.operations && (
                        <>
                          <dt>Storage</dt>
                          <dd>
                            {snapshot.operations.storageBackend === "s3"
                              ? "Object storage"
                              : "Local disk"}
                          </dd>
                          <dt>Process uptime</dt>
                          <dd>
                            {Math.floor(
                              snapshot.operations.uptimeSeconds / 3600,
                            )}
                            h{" "}
                            {Math.floor(
                              (snapshot.operations.uptimeSeconds % 3600) / 60,
                            )}
                            m
                          </dd>
                        </>
                      )}
                    </dl>
                    <button
                      className="button secondary small"
                      hidden={!can("operations:read")}
                      onClick={() => changeTab("operations")}
                    >
                      Inspect operations <ArrowDownToLine size={13} />
                    </button>
                  </section>
                </div>
                <div className="operator-overview-grid">
                  <section className="operator-card">
                    <div className="operator-card-heading">
                      <h2>Workspace activity</h2>
                      <button
                        className="button secondary small"
                        hidden={!can("activity:read")}
                        onClick={() => changeTab("activity")}
                      >
                        View all recent
                      </button>
                    </div>
                    {events(snapshot.events.slice(0, 8))}
                  </section>
                  <section className="operator-card">
                    <span className="studio-kicker">
                      WHAT PEOPLE ARE CREATING
                    </span>
                    <h2>QR type mix</h2>
                    <div className="operator-type-list">
                      {snapshot.types.length ? (
                        snapshot.types.map((item) => (
                          <div key={item.type}>
                            <span>{item.type.replace(/-/g, " ")}</span>
                            <b>{formatNumber(item.count)}</b>
                            <progress
                              max={Math.max(1, snapshot.totals.codes)}
                              value={item.count}
                              aria-label={`${item.type} codes`}
                            />
                          </div>
                        ))
                      ) : (
                        <p className="operator-empty">
                          The first code starts the picture.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
            {["workspaces", "people"].includes(view) && (
              <section className="operator-card">
                <div className="operator-card-heading">
                  <div>
                    <h2>
                      {view === "people"
                        ? "Accounts and access"
                        : "Workspace directory"}
                    </h2>
                    <p className="hint">
                      {listing
                        ? `${listing.total} matching ${view === "people" ? "accounts" : "workspaces"}`
                        : "Loading directory…"}
                    </p>
                  </div>
                  <label className="operator-search">
                    <Search size={15} />
                    <input
                      aria-label={`Search ${tab}`}
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setPage(0);
                      }}
                      placeholder={
                        view === "people"
                          ? "Name or email…"
                          : "Workspace or owner…"
                      }
                      maxLength={100}
                    />
                  </label>
                </div>
                {tableError && (
                  <p className="form-error" role="alert">
                    {tableError}
                  </p>
                )}
                <div className="operator-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(view === "people"
                          ? [
                              "Account",
                              "Workspaces",
                              "Valid sessions",
                              "Access",
                              "Manage",
                            ]
                          : [
                              "Workspace",
                              "Owner",
                              "Members",
                              "Codes",
                              "Visits",
                              "Media",
                              "Manage",
                            ]
                        ).map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {view === "people"
                        ? users?.rows.map((user) => (
                            <tr key={user.id}>
                              <td>
                                <strong>{user.name}</strong>
                                <small>{user.email}</small>
                              </td>
                              <td>{user.workspaces}</td>
                              <td>{user.sessions}</td>
                              <td>
                                <span
                                  className={`role-badge ${user.operator ? "owner" : "viewer"}`}
                                >
                                  {user.operator
                                    ? "Operator"
                                    : "Workspace member"}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="button secondary small"
                                  disabled={
                                    user.id === userId || user.sessions === 0
                                  }
                                  onClick={() => {
                                    setRevoke(user);
                                    setActionError("");
                                  }}
                                >
                                  Revoke sessions
                                </button>
                              </td>
                            </tr>
                          ))
                        : workspaces?.rows.map((workspace) => (
                            <tr key={workspace.id}>
                              <td>
                                <strong>{workspace.name}</strong>
                                <small>
                                  Created{" "}
                                  {new Date(
                                    workspace.createdAt,
                                  ).toLocaleDateString()}
                                </small>
                              </td>
                              <td>{workspace.ownerName}</td>
                              <td>{workspace.members}</td>
                              <td>{workspace.codes}</td>
                              <td>{formatNumber(workspace.scans)}</td>
                              <td>{size(workspace.mediaBytes)}</td>
                              <td>
                                <button
                                  className="button secondary small"
                                  onClick={() => setCustomer(workspace.id)}
                                >
                                  Open account
                                </button>
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
                {listing && listing.rows.length === 0 && (
                  <p className="operator-empty">No matches for this search.</p>
                )}
                <div className="operator-pagination">
                  <span>
                    Page {page + 1}
                    {listing
                      ? ` of ${Math.max(1, Math.ceil(listing.total / listing.pageSize))}`
                      : ""}
                  </span>
                  <div>
                    <button
                      className="button secondary small"
                      disabled={page === 0}
                      onClick={() => setPage((v) => v - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!listing || (page + 1) * 25 >= listing.total}
                      onClick={() => setPage((v) => v + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            )}
            {view === "activity" && (
              <div className="operator-overview-grid">
                <section className="operator-card">
                  <h2>Workspace event stream</h2>
                  <p className="hint">
                    Latest 40 recorded events across all workspaces. Refreshed
                    every five seconds while updates are enabled.
                  </p>
                  {events(snapshot.events)}
                </section>
                <section className="operator-card">
                  <h2>Operator actions</h2>
                  <p className="hint">
                    Latest 25 server and console administration events.
                  </p>
                  <div className="operator-feed">
                    {snapshot.operatorEvents.map((event) => (
                      <article key={event.id}>
                        <span className="operator-event-mark">
                          <ShieldCheck size={14} />
                        </span>
                        <div>
                          <strong>{eventName(event.event)}</strong>
                          <p>
                            {event.actor}
                            {event.count !== null
                              ? ` · ${event.count} sessions`
                              : ""}
                          </p>
                          <small>{time(event.at)}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {view === "operations" && snapshot.operations && (
              <div className="operator-overview-grid">
                <section className="operator-card">
                  <span className="studio-kicker">CONTINUITY / RECOVERY</span>
                  <h2>Backups that tell the truth.</h2>
                  <dl>
                    <dt>Latest recorded result</dt>
                    <dd>{snapshot.operations.backup.state}</dd>
                    <dt>Last attempt</dt>
                    <dd>{time(snapshot.operations.backup.lastAttemptAt)}</dd>
                    <dt>Last full completion</dt>
                    <dd>{time(snapshot.operations.backup.lastSuccessAt)}</dd>
                    <dt>Last local archive</dt>
                    <dd>{time(snapshot.operations.backup.localCompletedAt)}</dd>
                    <dt>Off-server copies</dt>
                    <dd>
                      {snapshot.operations.backup.remoteEnabled
                        ? "Configured"
                        : "Not configured"}
                    </dd>
                    <dt>Automatic interval</dt>
                    <dd>
                      {snapshot.operations.backup.intervalHours === 0
                        ? "Disabled"
                        : snapshot.operations.backup.intervalHours === null
                          ? "Unavailable"
                          : `${snapshot.operations.backup.intervalHours} hours of uptime`}
                    </dd>
                    <dt>Local retention</dt>
                    <dd>
                      {snapshot.operations.backup.retention ?? "Unavailable"}{" "}
                      archives
                    </dd>
                  </dl>
                  <p className="hint">
                    Records do not verify archive availability or a successful
                    recovery drill. Backups contain all workspaces.
                  </p>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      !can("backup:create") ||
                      !snapshot.operations.backup.available
                    }
                    onClick={async () => {
                      setBusy(true);
                      setActionError("");
                      try {
                        await api("/operator/backups", {});
                        setMessage("Installation backup completed.");
                        setRevision((v) => v + 1);
                      } catch (e) {
                        setActionError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Database size={15} />
                    )}{" "}
                    Create installation backup
                  </button>
                  {actionError && (
                    <p className="form-error" role="alert">
                      {actionError}
                    </p>
                  )}
                </section>
                <section className="operator-card">
                  <span className="studio-kicker">RUNTIME / STORAGE</span>
                  <h2>Installation configuration</h2>
                  <dl>
                    <dt>Public origin</dt>
                    <dd className="operator-origin">
                      {snapshot.operations.publicUrl}
                    </dd>
                    <dt>Storage backend</dt>
                    <dd>{snapshot.operations.storageBackend}</dd>
                    <dt>Media usage</dt>
                    <dd>{size(snapshot.totals.mediaBytes)}</dd>
                    <dt>Per-workspace quota</dt>
                    <dd>{size(snapshot.operations.workspaceQuotaBytes)}</dd>
                    <dt>Maximum upload</dt>
                    <dd>{size(snapshot.operations.maxUploadBytes)}</dd>
                    <dt>Valid sessions</dt>
                    <dd>{snapshot.totals.sessions}</dd>
                  </dl>
                  <p className="hint">
                    Media usage measures stored workspace files, not free disk
                    capacity. Valid sessions are unexpired sign-ins, not a count
                    of people currently online.
                  </p>
                </section>
              </div>
            )}
            {view === "cases" && <OperatorCases onOpenCustomer={setCustomer} />}
            {view === "audit" && <OperatorAudit />}
            {view === "billing" && (
              <OperatorBilling onChange={() => setRevision((v) => v + 1)} />
            )}
            {view === "staff" && (
              <StaffPanel
                userId={userId}
                onChange={() => setRevision((v) => v + 1)}
              />
            )}
            {view === "access" && (
              <section className="operator-card">
                <span className="studio-kicker">
                  PERMISSIONS / TWO BOUNDARIES
                </span>
                <h2>The right access, in the right place.</h2>
                <p className="hint">
                  Workspace roles share the same interface with permitted
                  actions. Company staff roles are separate. Only a company
                  Super Admin can assign them; the server command provides
                  bootstrap access.
                </p>
                <div className="operator-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Role</th>
                        <th>Scope</th>
                        <th>Capabilities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...staffRoles.map((role) => [
                          role.label,
                          role.department,
                          role.description,
                        ]),
                        [
                          "Owner",
                          "Their workspace",
                          "Codes, media, analytics, team roles, and ownership transfer",
                        ],
                        [
                          "Admin",
                          "Their workspace",
                          "Codes and media; manage Editors and Viewers",
                        ],
                        [
                          "Editor",
                          "Their workspace",
                          "Create and manage codes, content, folders, and designs",
                        ],
                        [
                          "Viewer",
                          "Their workspace",
                          "Read shared resources, analytics, and downloads",
                        ],
                      ].map(([role, scope, details]) => (
                        <tr key={role}>
                          <td>
                            <strong>{role}</strong>
                          </td>
                          <td>{scope}</td>
                          <td>{details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint">
                  An invitation cannot grant platform access. More roles should
                  be based on permission needs, such as an Analyst who can read
                  analytics without downloading codes.
                </p>
              </section>
            )}
          </>
        )
      )}
      {customer && (
        <CustomerDialog
          id={customer}
          userId={userId}
          onClose={() => setCustomer(null)}
          onChange={() => setRevision((v) => v + 1)}
          onManageBilling={() => {
            setCustomer(null);
            changeTab("billing");
          }}
        />
      )}
      {revoke && (
        <Modal
          title={`Revoke sessions for ${revoke.name}?`}
          onClose={() => {
            if (!busy) setRevoke(null);
          }}
        >
          <form
            className="simple-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const password = String(
                new FormData(e.currentTarget).get("password"),
              );
              setBusy(true);
              setActionError("");
              try {
                const result = await api<{ revoked: number }>(
                  `/operator/users/${revoke.id}/revoke-sessions`,
                  { password },
                );
                setRevoke(null);
                setMessage(
                  `${result.revoked} sessions revoked. The account can sign in again.`,
                );
                setRevision((v) => v + 1);
              } catch (error) {
                setActionError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              This signs the account out across OpenQR. Its workspace
              memberships, codes, and files remain. Enter your operator account
              password to continue.
            </p>
            <label>
              Your password
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setRevoke(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  "Revoke sessions"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
