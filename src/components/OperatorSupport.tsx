import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, Loader2, LifeBuoy, Plus, Search } from "lucide-react";
import { api } from "../lib";
import Modal from "./Modal";
import { planSize, type PlanSummary } from "./PlansView";

const when = (value: string) => new Date(value).toLocaleString();
const label = (value: string) => value.replace(/[._]/g, " ");
type Listing<T> = { rows: T[]; total: number; page: number; pageSize: number };
type CaseRow = {
  number: number;
  workspace: string;
  workspaceId: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  updatedAt: string;
  assignee: string | null;
};
type CaseDetail = CaseRow & {
  contact: string | null;
  assignedTo: string | null;
  createdAt: string;
  notes: { id: number; body: string; at: string; author: string }[];
};
type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  owner: boolean;
  suspended: boolean;
  staff: boolean;
};
type Customer = {
  id: string;
  name: string;
  createdAt: string;
  members: Member[];
  cases: Omit<CaseRow, "workspace" | "workspaceId" | "assignee">[];
  billing: PlanSummary;
  canReveal: boolean;
  canManageAccounts: boolean;
  canManageCases: boolean;
  canManageBilling: boolean;
};
const categories = ["billing", "subscription", "account", "technical", "other"];
const statuses = ["open", "pending", "resolved", "closed"];

function Pager<T>({
  data,
  page,
  setPage,
}: {
  data: Listing<T> | null;
  page: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="operator-pagination">
      <span>
        {data?.total ?? 0} total · Page {page + 1}
      </span>
      <div>
        <button
          className="button secondary small"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          className="button secondary small"
          disabled={!data || (page + 1) * data.pageSize >= data.total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function OperatorCases({
  onOpenCustomer,
}: {
  onOpenCustomer: (id: string) => void;
}) {
  const [data, setData] = useState<Listing<CaseRow> | null>(null),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("active"),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [open, setOpen] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      api<Listing<CaseRow>>(
        `/operator/cases?q=${encodeURIComponent(q)}&status=${status}&page=${page}`,
      )
        .then((value) => active && (setData(value), setError("")))
        .catch((e) => active && setError(e.message));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [q, status, page, revision]);
  return (
    <section className="operator-card">
      <div className="operator-section-head">
        <div>
          <span className="studio-kicker">SUPPORT / CASES</span>
          <h2>Customer cases</h2>
          <p className="hint">
            Billing, subscription, and account issues, tracked with notes. Open
            a customer from Workspaces to start a case. Never put passwords,
            card numbers, or QR content in a note.
          </p>
        </div>
        <label className="operator-search">
          <Search size={15} />
          <input
            aria-label="Search cases"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Subject, workspace, or SUP-12…"
            maxLength={100}
          />
        </label>
      </div>
      <div className="operator-tabs" aria-label="Case status">
        {[
          ["active", "Active"],
          ...statuses.map((s) => [s, label(s)]),
          ["all", "All"],
        ].map(([id, text]) => (
          <button
            key={id}
            className={status === id ? "active" : ""}
            onClick={() => {
              setStatus(id);
              setPage(0);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="operator-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Workspace</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assigned</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.number}>
                <td>
                  <button
                    className="link-button"
                    onClick={() => setOpen(row.number)}
                  >
                    <strong>SUP-{row.number}</strong>
                  </button>
                  <small>{row.subject}</small>
                </td>
                <td>{row.workspace}</td>
                <td>{row.category}</td>
                <td>
                  <span
                    className={`role-badge ${row.priority === "high" ? "owner" : "viewer"}`}
                  >
                    {row.priority}
                  </span>
                </td>
                <td>{row.status}</td>
                <td>{row.assignee || "Unassigned"}</td>
                <td>{when(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.rows.length === 0 && (
        <p className="operator-empty">No cases match this view.</p>
      )}
      <Pager data={data} page={page} setPage={setPage} />
      {open !== null && (
        <CaseDialog
          number={open}
          onClose={() => setOpen(null)}
          onChange={() => setRevision((v) => v + 1)}
          onOpenCustomer={(id) => {
            setOpen(null);
            onOpenCustomer(id);
          }}
        />
      )}
    </section>
  );
}

function CaseDialog({
  number,
  onClose,
  onChange,
  onOpenCustomer,
}: {
  number: number;
  onClose: () => void;
  onChange: () => void;
  onOpenCustomer: (id: string) => void;
}) {
  const [item, setItem] = useState<CaseDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<CaseDetail>(`/operator/cases/${number}`)
        .then(setItem)
        .catch((e) => setError(e.message)),
    [number],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: object) =>
    run(() => api(`/operator/cases/${number}`, body, "PATCH"));
  return (
    <Modal title={`Case SUP-${number}`} onClose={onClose} wide>
      {!item ? (
        error ? (
          <p className="form-error">{error}</p>
        ) : (
          <Loader2 className="spin" />
        )
      ) : (
        <div className="case-detail">
          <h3>{item.subject}</h3>
          <p className="hint">
            {item.workspace} · {item.category} · opened {when(item.createdAt)}
            {item.contact ? ` · contact ${item.contact}` : ""}
          </p>
          <div className="case-actions">
            <label>
              Status
              <select
                value={item.status}
                disabled={busy}
                onChange={(e) => void patch({ status: e.target.value })}
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={item.priority}
                disabled={busy}
                onChange={(e) => void patch({ priority: e.target.value })}
              >
                {["low", "normal", "high"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() =>
                void patch({ assign: item.assignee ? "none" : "me" })
              }
            >
              {item.assignee ? `Unassign ${item.assignee}` : "Assign to me"}
            </button>
            <button
              className="button secondary small"
              onClick={() => onOpenCustomer(item.workspaceId)}
            >
              Open customer
            </button>
          </div>
          <form
            className="simple-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget,
                body = String(new FormData(form).get("body") || "");
              void run(async () => {
                await api(`/operator/cases/${number}/notes`, { body });
                form.reset();
              });
            }}
          >
            <label>
              Add an internal note
              <textarea name="body" required maxLength={2000} rows={3} />
            </label>
            <button className="button primary small" disabled={busy}>
              Add note
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="operator-feed">
            {item.notes.map((note) => (
              <article key={note.id}>
                <div>
                  <strong>{note.author}</strong>
                  <p>{note.body}</p>
                  <small>{when(note.at)}</small>
                </div>
              </article>
            ))}
            {item.notes.length === 0 && (
              <p className="operator-empty">No notes yet.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CustomerDialog({
  id,
  userId,
  onClose,
  onManageBilling,
  onChange,
}: {
  id: string;
  userId: string;
  onClose: () => void;
  onManageBilling: () => void;
  onChange: () => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null),
    [error, setError] = useState(""),
    [revealed, setRevealed] = useState<Record<string, string>>({}),
    [prompt, setPrompt] = useState<{
      member: Member;
      kind: "reveal" | "suspend" | "restore";
    } | null>(null),
    [newCase, setNewCase] = useState(false),
    [busy, setBusy] = useState(false),
    [casesView, setCasesView] = useState<number | null>(null);
  const load = useCallback(
    () =>
      api<Customer>(`/operator/customers/${id}`)
        .then(setCustomer)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      if (prompt.kind === "reveal") {
        const result = await api<{ email: string }>(
          `/operator/users/${prompt.member.id}/reveal-email`,
          values,
        );
        setRevealed((v) => ({ ...v, [prompt.member.id]: result.email }));
      } else {
        await api(`/operator/users/${prompt.member.id}/suspension`, {
          ...values,
          suspended: prompt.kind === "suspend",
        });
        onChange();
        await load();
      }
      setPrompt(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={customer ? customer.name : "Customer"} onClose={onClose} wide>
      {!customer ? (
        error ? (
          <p className="form-error">{error}</p>
        ) : (
          <Loader2 className="spin" />
        )
      ) : (
        <div className="case-detail">
          <div className="info-note">
            <Eye size={18} />
            <p>
              Contact details are masked. QR content, visitor records, media
              files, and passwords are never shown to staff. Viewing this
              account and every reveal or account change is recorded.
            </p>
          </div>
          <dl>
            <dt>Created</dt>
            <dd>{new Date(customer.createdAt).toLocaleDateString()}</dd>
            <dt>Plan</dt>
            <dd>
              {customer.billing.current.name} ·{" "}
              {customer.billing.current.status}
              {customer.billing.current.source === "manual"
                ? " · operator-provisioned"
                : ""}
            </dd>
            <dt>Usage</dt>
            <dd>
              {customer.billing.usage.codes} QR codes ·{" "}
              {planSize(customer.billing.usage.storageBytes)} media ·{" "}
              {customer.billing.usage.members} members ·{" "}
              {customer.billing.usage.pendingInvites} pending invitations
            </dd>
          </dl>
          <div className="case-actions">
            {customer.canManageBilling && (
              <button
                className="button secondary small"
                onClick={onManageBilling}
              >
                Fix billing or subscription
              </button>
            )}
            {customer.canManageCases && (
              <button
                className="button primary small"
                onClick={() => setNewCase(true)}
              >
                <Plus size={14} /> New case
              </button>
            )}
          </div>
          <h3>Members</h3>
          <div className="operator-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {customer.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small>{revealed[m.id] || m.email}</small>
                    </td>
                    <td>{m.owner ? "owner" : m.role}</td>
                    <td>
                      {m.staff
                        ? "Company staff"
                        : m.suspended
                          ? "Suspended"
                          : "Active"}
                    </td>
                    <td>
                      {customer.canReveal && !revealed[m.id] && (
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setPrompt({ member: m, kind: "reveal" });
                            setError("");
                          }}
                        >
                          Reveal email
                        </button>
                      )}{" "}
                      {customer.canManageAccounts &&
                        !m.staff &&
                        m.id !== userId && (
                          <button
                            className="button secondary small"
                            onClick={() => {
                              setPrompt({
                                member: m,
                                kind: m.suspended ? "restore" : "suspend",
                              });
                              setError("");
                            }}
                          >
                            {m.suspended ? "Restore" : "Suspend"}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Recent cases</h3>
          {customer.cases.length === 0 ? (
            <p className="operator-empty">No cases for this workspace.</p>
          ) : (
            <ul className="case-list">
              {customer.cases.map((c) => (
                <li key={c.number}>
                  <button
                    className="link-button"
                    onClick={() => setCasesView(c.number)}
                  >
                    SUP-{c.number}
                  </button>{" "}
                  {c.subject} · {c.category} · {c.status}
                </li>
              ))}
            </ul>
          )}
          {error && !prompt && !newCase && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {prompt && (
        <Modal
          title={
            prompt.kind === "reveal"
              ? `Reveal email for ${prompt.member.name}`
              : `${prompt.kind === "suspend" ? "Suspend" : "Restore"} ${prompt.member.name}`
          }
          onClose={() => !busy && setPrompt(null)}
        >
          <form className="simple-form" onSubmit={submit}>
            <p>
              {prompt.kind === "suspend"
                ? "The person is signed out everywhere and cannot sign in. Their workspace content, printed links, and published pages are unchanged."
                : prompt.kind === "restore"
                  ? "The person can sign in again."
                  : "Your name, this reason, and the time are recorded in the staff audit log."}
            </p>
            <label>
              Reason (recorded)
              <input
                name="reason"
                required
                minLength={8}
                maxLength={300}
                placeholder="e.g. Customer asked about SUP-12"
              />
            </label>
            {prompt.kind !== "reveal" && (
              <label>
                Your password
                <input
                  type="password"
                  name="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Working…" : "Confirm"}
            </button>
          </form>
        </Modal>
      )}
      {newCase && customer && (
        <Modal
          title="New support case"
          onClose={() => !busy && setNewCase(false)}
        >
          <form
            className="simple-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              setBusy(true);
              setError("");
              try {
                const created = await api<CaseRow>("/operator/cases", {
                  ...values,
                  workspaceId: id,
                  userId: values.userId || undefined,
                });
                setNewCase(false);
                setCasesView(created.number);
                onChange();
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Subject
              <input name="subject" required minLength={3} maxLength={120} />
            </label>
            <label>
              Category
              <select name="category" defaultValue="billing">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="normal">
                {["low", "normal", "high"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Contact (optional)
              <select name="userId" defaultValue="">
                <option value="">Workspace in general</option>
                {customer.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              First note
              <textarea name="note" maxLength={2000} rows={3} />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              <LifeBuoy size={14} /> Open case
            </button>
          </form>
        </Modal>
      )}
      {casesView !== null && (
        <CaseDialog
          number={casesView}
          onClose={() => setCasesView(null)}
          onChange={() => void load()}
          onOpenCustomer={() => setCasesView(null)}
        />
      )}
    </Modal>
  );
}

type AuditRow = {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  at: string;
  actor: string;
};
export function OperatorAudit() {
  const [data, setData] = useState<Listing<AuditRow> | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    api<Listing<AuditRow>>(`/operator/audit?page=${page}`)
      .then((v) => (setData(v), setError("")))
      .catch((e) => setError(e.message));
  }, [page]);
  return (
    <section className="operator-card">
      <span className="studio-kicker">PRIVACY / STAFF ACCESS</span>
      <h2>Who looked at what</h2>
      <p className="hint">
        Every customer view, contact reveal, case change, and account action by
        company staff is recorded here with the reason given.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="operator-table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Staff</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{when(row.at)}</td>
                <td>{row.actor}</td>
                <td>{label(row.action)}</td>
                <td>
                  {row.targetType} · <small>{row.targetId.slice(0, 8)}</small>
                </td>
                <td>{row.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.rows.length === 0 && (
        <p className="operator-empty">No staff activity recorded yet.</p>
      )}
      <Pager data={data} page={page} setPage={setPage} />
    </section>
  );
}
