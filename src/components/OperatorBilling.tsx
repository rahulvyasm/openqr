import { useEffect, useState } from "react";
import { CreditCard, Loader2, Search } from "lucide-react";
import { api } from "../lib";
import Modal from "./Modal";
import { planSize, type Plan, type PlanSummary } from "./PlansView";
type Row = PlanSummary & { id: string; name: string };
type Catalog = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  plans: Plan[];
  hosted: boolean;
  currency: string;
};
export default function OperatorBilling({
  onChange,
}: {
  onChange: () => void;
}) {
  const [data, setData] = useState<Catalog | null>(null),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [target, setTarget] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      api<Catalog>(
        `/operator/plans?q=${encodeURIComponent(query)}&page=${page}`,
      )
        .then((value) => {
          if (active) {
            setData(value);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, page, revision]);
  return (
    <section className="operator-card">
      <div className="operator-card-heading">
        <div>
          <span className="studio-kicker">FINANCE / ENTITLEMENTS</span>
          <h2>Hosted plan management</h2>
        </div>
        <label className="operator-search">
          <Search size={15} />
          <input
            aria-label="Search billing workspaces"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Find a workspace…"
            maxLength={100}
          />
        </label>
      </div>
      <p className="hint">
        Currency: INR. Online checkout is not configured. This screen provisions
        access; it does not collect money or mark invoices as paid.
      </p>
      {data && !data.hosted && (
        <div className="info-note">
          <CreditCard size={18} />
          <p>
            This is the self-hosted edition. Hosted plan enforcement is
            disabled. Enable HOSTED_MODE on your hosted installation to assign
            subscription tiers.
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="operator-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Current access</th>
              <th>QR codes</th>
              <th>Media</th>
              <th>Team</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>
                  <strong>{row.current.name}</strong>
                  <small>
                    {row.current.source} · {row.current.status}
                  </small>
                </td>
                <td>
                  {row.usage.codes} / {row.current.codes ?? "No plan cap"}
                </td>
                <td>
                  {planSize(row.usage.storageBytes)} /{" "}
                  {planSize(row.current.storageBytes)}
                </td>
                <td>
                  {row.usage.members} members + {row.usage.pendingInvites}{" "}
                  pending
                </td>
                <td>
                  <button
                    className="button secondary small"
                    disabled={!data.hosted}
                    onClick={() => {
                      setTarget(row);
                      setError("");
                    }}
                  >
                    Manage access
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="operator-pagination">
        <span>
          {data?.total ?? 0} workspaces · Page {page + 1}
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
            disabled={!data || (page + 1) * 25 >= data.total}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {target && (
        <Modal
          title={`Hosted access for ${target.name}`}
          onClose={() => {
            if (!busy) setTarget(null);
          }}
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
                await api(`/operator/workspaces/${target.id}/plan`, values);
                setTarget(null);
                setRevision((v) => v + 1);
                onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Manual access only. No charge is collected. Downgrading limits new
              additions and preserves existing content and printed links.
            </p>
            <label>
              Hosted tier
              <select name="tier" defaultValue={target.current.id}>
                {data?.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.codes} codes ·{" "}
                    {planSize(plan.storageBytes)} · {plan.members} seats
                  </option>
                ))}
              </select>
            </label>
            <label>
              Access status
              <select name="status" defaultValue="active">
                <option value="active">Active · operator-provisioned</option>
                <option value="trialing">Trial · manually managed</option>
                <option value="canceled">
                  Canceled · return to Free limits
                </option>
              </select>
            </label>
            <label>
              Your company account password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <CreditCard size={15} />
              )}
              Save hosted access
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
