import { useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { api, type AuthState } from "../lib";
type Session = {
  id: string;
  label: string;
  createdAt: string | null;
  expires: number;
  current: boolean;
};
export default function AccountPanel({
  auth,
  onAuthChange,
  onSignOut,
  notify,
}: {
  auth: AuthState;
  onAuthChange: () => void;
  onSignOut: () => void;
  notify: (s: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = () =>
    api<Session[]>("/auth/sessions")
      .then(setSessions)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <span className="small-label">HELLO, YOU</span>
            <h2>Your profile.</h2>
            <p>The person behind your connections.</p>
          </div>
          <span className="account-monogram">
            {auth.user?.name[0].toUpperCase()}
          </span>
        </div>
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(
                "/auth/profile",
                Object.fromEntries(new FormData(e.currentTarget)),
                "PATCH",
              );
              onAuthChange();
              notify("Your profile is updated.");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Your name
            <input
              name="name"
              defaultValue={auth.user?.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Email address
            <input type="email" value={auth.user?.email || ""} readOnly />
          </label>
          <button className="button primary small" disabled={busy}>
            <Check size={15} />
            Save profile
          </button>
        </form>
      </section>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>A little peace of mind.</h2>
            <p>Update your password and sign out previous sessions.</p>
          </div>
          <KeyRound size={21} />
        </div>
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              values = Object.fromEntries(new FormData(form));
            setError("");
            if (values.newPassword !== values.confirm) {
              setError("The new passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              await api("/auth/password", {
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
              });
              form.reset();
              await refresh();
              onAuthChange();
              notify("Password updated. Other sessions are signed out.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <div className="field-pair">
            <label>
              New password
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button secondary small" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <KeyRound size={15} />
            )}
            Update password
          </button>
        </form>
      </section>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>Where you’re signed in.</h2>
            <p>Sessions expire after seven days. You can end them sooner.</p>
          </div>
          <MonitorSmartphone size={21} />
        </div>
        <div className="session-list">
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <span className="session-icon">
                <MonitorSmartphone size={20} />
              </span>
              <div>
                <strong>
                  {s.label}
                  {s.current && (
                    <span className="current-session">THIS SESSION</span>
                  )}
                </strong>
                <small>
                  {s.createdAt
                    ? `Signed in ${new Date(s.createdAt).toLocaleString()}`
                    : "Signed in before the workspace upgrade"}
                </small>
              </div>
              {!s.current && (
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await api(`/auth/sessions/${s.id}`, undefined, "DELETE");
                      refresh();
                      notify("Session signed out.");
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="session-footer">
          <button
            className="button secondary small"
            disabled={sessions.length < 2}
            onClick={async () => {
              try {
                await api("/auth/sessions/revoke-others", {});
                refresh();
                notify("Other sessions signed out.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <ShieldCheck size={15} />
            Sign out other sessions
          </button>
          <button className="text-button" onClick={onSignOut}>
            <LogOut size={14} />
            Sign out here
          </button>
        </div>
      </section>
    </>
  );
}
