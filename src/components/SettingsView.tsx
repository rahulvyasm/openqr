import { useEffect, useState } from "react";
import {
  Check,
  ClipboardList,
  Globe,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { api, mayManage, type AuthState } from "../lib";
import TeamPanel from "./TeamPanel";
import AccountPanel from "./AccountPanel";
type Audit = {
  id: number;
  event: string;
  subject: string;
  details: Record<string, string>;
  createdAt: string;
  actor: string | null;
};
const eventNames: Record<string, string> = {
  "workspace.created": "Created workspace",
  "workspace.renamed": "Renamed workspace",
  "invitation.created": "Created invitation",
  "invitation.renewed": "Renewed invitation",
  "invitation.revoked": "Revoked invitation",
  "invitation.accepted": "Joined workspace",
  "member.role_changed": "Changed a member’s role",
  "member.removed": "Removed workspace access",
  "workspace.ownership_transferred": "Transferred ownership",
  "account.password_changed": "Changed password",
  "account.password_recovered": "Recovered account",
  "account.recovery_issued": "Issued account recovery",
  "account.profile_updated": "Updated profile",
  "account.session_revoked": "Signed out a session",
  "account.other_sessions_revoked": "Signed out other sessions",
};
export default function SettingsView({
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
  const [tab, setTab] = useState("team"),
    [events, setEvents] = useState<Audit[]>([]),
    [error, setError] = useState("");
  const manager = mayManage(auth.workspace?.role);
  useEffect(() => {
    setError("");
    if (tab === "audit" && manager)
      api<Audit[]>("/audit")
        .then(setEvents)
        .catch((e) => setError(e.message));
  }, [tab, auth.workspace?.id, manager]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A HOME FOR YOUR IDEAS</span>
          <h1>
            Make room for good things<span>.</span>
          </h1>
          <p>Your workspace, your people, and a little peace of mind.</p>
        </div>
        <span className="settings-header-mark">
          <ShieldCheck size={17} />
          YOUR WORKSPACE
        </span>
      </div>
      <div className="settings-tabs">
        {[
          { id: "team", label: "Team", icon: Users },
          { id: "workspace", label: "Workspace", icon: Settings2 },
          { id: "account", label: "My account", icon: UserRound },
          ...(manager
            ? [{ id: "audit", label: "Activity", icon: ClipboardList }]
            : []),
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === "account" ? (
        <AccountPanel
          auth={auth}
          onAuthChange={onAuthChange}
          onSignOut={onSignOut}
          notify={notify}
        />
      ) : !auth.workspace ? (
        <div className="settings-panel">
          <h2>Make yourself a workspace.</h2>
          <p>Use the workspace menu to create a home for your next idea.</p>
        </div>
      ) : tab === "team" ? (
        <TeamPanel auth={auth} onAuthChange={onAuthChange} notify={notify} />
      ) : tab === "workspace" ? (
        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <h2>A place that feels like yours.</h2>
              <p>
                Codes, designs, and analytics are shared with this workspace’s
                members.
              </p>
            </div>
            <Globe size={21} />
          </div>
          <form
            key={auth.workspace.id}
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(
                  "/workspace",
                  Object.fromEntries(new FormData(e.currentTarget)),
                  "PATCH",
                );
                onAuthChange();
                notify("Workspace name updated.");
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            <label>
              Workspace name
              <input
                name="name"
                defaultValue={auth.workspace.name}
                required
                maxLength={80}
                readOnly={!manager}
              />
            </label>
            {manager && (
              <button className="button primary small">
                <Check size={15} />
                Save workspace
              </button>
            )}
          </form>
          <dl>
            <dt>Your access</dt>
            <dd>
              <span className={`role-badge ${auth.workspace.role}`}>
                {auth.workspace.role}
              </span>
            </dd>
            <dt>Public origin</dt>
            <dd>{auth.publicUrl}</dd>
            <dt>License</dt>
            <dd>MIT</dd>
          </dl>
          <div className="info-note">
            <ShieldCheck size={18} />
            <p>
              Printed QR links stay the same when you switch workspaces, change
              roles, or remove team members.
            </p>
          </div>
          {/localhost|127\.0\.0\.1/.test(auth.publicUrl) && (
            <div className="info-note amber">
              <Globe size={18} />
              <p>
                This instance uses a local address. Set a permanent public
                address before printing dynamic codes for other people.
              </p>
            </div>
          )}
        </section>
      ) : tab === "audit" && manager ? (
        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <h2>The story of your workspace.</h2>
              <p>The latest 100 team and account security events.</p>
            </div>
            <ClipboardList size={21} />
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="audit-list">
            {events.map((e) => (
              <div className="audit-row" key={e.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{eventNames[e.event] || e.event}</strong>
                  <p>
                    {e.actor || "Server operator"}
                    {e.details.to
                      ? ` · ${e.details.from} → ${e.details.to}`
                      : ""}
                    {e.event.startsWith("invitation.") &&
                    e.event !== "invitation.accepted"
                      ? ` · ${e.subject}`
                      : ""}
                  </p>
                </div>
                <time dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
