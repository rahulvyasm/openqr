import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../lib";
import { staffRoles } from "../../shared/operator-access.js";
import Modal from "./Modal";
type Staff = { id: string; name: string; email: string; role: string };
export default function StaffPanel({
  userId,
  onChange,
}: {
  userId: string;
  onChange: () => void;
}) {
  const [staff, setStaff] = useState<Staff[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Staff | null>(null),
    [message, setMessage] = useState("");
  const load = () =>
    api<Staff[]>("/operator/staff")
      .then(setStaff)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="operator-overview-grid">
      <section className="operator-card">
        <span className="studio-kicker">OPENQR COMPANY / INTERNAL ACCESS</span>
        <h2>Your company, behind the scenes.</h2>
        <p className="hint">
          Customer signups and workspace roles never grant company access. Staff
          must have an existing account and receive an explicit Super Admin
          grant.
        </p>
        {staff.map((person) => (
          <article className="staff-row" key={person.id}>
            <span className="operator-event-mark">
              <ShieldCheck size={15} />
            </span>
            <div>
              <strong>
                {person.name}
                {person.id === userId ? " · you" : ""}
              </strong>
              <small>{person.email}</small>
              <span className="role-badge owner">
                {staffRoles.find((role) => role.id === person.role)?.label}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={`Remove company access for ${person.name}`}
              disabled={person.id === userId || busy}
              onClick={() => {
                setRemove(person);
                setError("");
              }}
            >
              <Trash2 size={15} />
            </button>
          </article>
        ))}
      </section>
      <section className="operator-card">
        <h2>Assign company access</h2>
        <p className="hint">
          This grants internal application access, independently of customer
          workspace memberships.
        </p>
        <form
          className="staff-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = Object.fromEntries(new FormData(form));
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await api("/operator/staff", values);
              form.reset();
              await load();
              onChange();
              setMessage("Company staff access updated.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Existing account email
            <input
              type="email"
              name="email"
              required
              maxLength={254}
              placeholder="person@your-company.com"
            />
          </label>
          <fieldset className="staff-role-options">
            <legend>Department and permissions</legend>
            {staffRoles.map((role) => (
              <label key={role.id}>
                <input
                  type="radio"
                  name="role"
                  value={role.id}
                  defaultChecked={role.id === "support"}
                  required
                />
                <span>
                  <strong>{role.label}</strong>
                  <small>{role.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Your Super Admin password
            <input
              type="password"
              name="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="hint">
              {message}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ShieldCheck size={15} />
            )}
            Save company access
          </button>
        </form>
      </section>
      {remove && (
        <Modal
          title={`Remove company access for ${remove.name}?`}
          onClose={() => {
            if (!busy) setRemove(null);
          }}
        >
          <form
            className="simple-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const password = String(
                new FormData(event.currentTarget).get("password"),
              );
              setBusy(true);
              setError("");
              try {
                await api(
                  `/operator/staff/${remove.id}`,
                  { password },
                  "DELETE",
                );
                setRemove(null);
                await load();
                onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              This removes internal staff access. Customer workspace memberships
              remain. Active sessions lose company privileges on their next
              request.
            </p>
            <label>
              Your Super Admin password
              <input
                type="password"
                name="password"
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
              Remove company access
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
