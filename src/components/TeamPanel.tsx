import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  Link as LinkIcon,
  Loader2,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api, mayManage, type AuthState, type Member, type Role } from "../lib";
import Modal from "./Modal";
import RoleSelect from "./RoleSelect";
type Invite = { id: string; email: string; role: Role; expires: number };
const roleText = {
  owner: "Full control, including ownership.",
  admin: "Manage codes and the editor/viewer team.",
  editor: "Create and manage codes, folders, and designs.",
  viewer: "View analytics and download shared codes.",
};
export default function TeamPanel({
  auth,
  onAuthChange,
  notify,
}: {
  auth: AuthState;
  onAuthChange: () => void;
  notify: (s: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<Invite[]>([]),
    [inviteOpen, setInviteOpen] = useState(false),
    [inviteLink, setInviteLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Member | null>(null),
    [transfer, setTransfer] = useState(false);
  const [inviteRole, setInviteRole] = useState("editor");
  const role = auth.workspace?.role,
    manager = mayManage(role),
    owner = role === "owner";
  async function refresh() {
    try {
      const m = await api<Member[]>("/team");
      setMembers(m);
      if (manager) setInvites(await api<Invite[]>("/invitations"));
      else setInvites([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
  }, [auth.workspace?.id, role]);
  async function changeRole(member: Member, next: string) {
    setBusy(true);
    try {
      await api(`/team/${member.id}`, { role: next }, "PATCH");
      await refresh();
      onAuthChange();
      notify("Team permissions updated.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <span className="small-label">BETTER TOGETHER</span>
            <h2>Your people. One workspace.</h2>
            <p>Give everyone the right space to do their best work.</p>
          </div>
          {manager && (
            <button
              className="button primary small"
              onClick={() => {
                setInviteLink("");
                setError("");
                setInviteOpen(true);
              }}
            >
              <MailPlus size={16} />
              Invite someone
            </button>
          )}
        </div>
        <div className="role-guide">
          {(["owner", "admin", "editor", "viewer"] as const).map((r) => (
            <div key={r}>
              <span className={`role-badge ${r}`}>{r}</span>
              <p>{roleText[r]}</p>
            </div>
          ))}
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="team-list">
          {members.map((member) => {
            const editable =
              manager &&
              member.role !== "owner" &&
              (owner || !["owner", "admin"].includes(member.role));
            return (
              <div className="team-row" key={member.id}>
                <span className="member-avatar">
                  {member.name[0].toUpperCase()}
                </span>
                <div className="member-identity">
                  <strong>
                    {member.name}
                    {member.id === auth.user?.id && <small>you</small>}
                  </strong>
                  <span>{member.email}</span>
                </div>
                {editable ? (
                  <RoleSelect
                    label={`Role for ${member.name}`}
                    value={member.role}
                    disabled={busy}
                    allowAdmin={owner}
                    onChange={(value) => changeRole(member, value)}
                  />
                ) : (
                  <span className={`role-badge ${member.role}`}>
                    {member.role === "owner" && <Crown size={11} />}{" "}
                    {member.role}
                  </span>
                )}
                {editable && (
                  <button
                    className="icon-button danger"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => {
                      setError("");
                      setRemove(member);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {owner && members.length > 1 && (
          <button
            className="text-button transfer-trigger"
            onClick={() => {
              setError("");
              setTransfer(true);
            }}
          >
            <Crown size={13} />
            Transfer workspace ownership
          </button>
        )}
      </section>
      {manager && (
        <section className="settings-panel">
          <div className="settings-panel-heading">
            <div>
              <h2>Invitations on their way.</h2>
              <p>
                Links expire in seven days. Share them privately with the
                invited person.
              </p>
            </div>
            <span className="count-badge">{invites.length}</span>
          </div>
          {invites.length ? (
            <div className="invite-list">
              {invites.map((invite) => (
                <div className="invite-row" key={invite.id}>
                  <span className="invite-avatar">
                    <LinkIcon size={17} />
                  </span>
                  <div>
                    <strong>{invite.email}</strong>
                    <small>
                      {invite.expires > Date.now()
                        ? `Expires ${new Date(invite.expires).toLocaleDateString()}`
                        : "Expired"}{" "}
                      · {invite.role}
                    </small>
                  </div>
                  <button
                    className="button secondary small"
                    disabled={busy || (!owner && invite.role === "admin")}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await api<{ url: string }>(
                          `/invitations/${invite.id}/renew`,
                          {},
                        );
                        setInviteLink(result.url);
                        setInviteOpen(true);
                        refresh();
                      } catch (e) {
                        notify((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCw size={13} />
                    Renew link
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Revoke invitation for ${invite.email}`}
                    disabled={!owner && invite.role === "admin"}
                    onClick={async () => {
                      try {
                        await api(
                          `/invitations/${invite.id}`,
                          undefined,
                          "DELETE",
                        );
                        refresh();
                        notify("Invitation revoked. Its link no longer works.");
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="settings-empty">
              <Users size={23} />
              <p>
                No pending invitations. Your next collaborator is a link away.
              </p>
            </div>
          )}
        </section>
      )}
      {inviteOpen && (
        <Modal
          title={
            inviteLink
              ? "Your invitation is ready."
              : "Make room for good company."
          }
          onClose={() => setInviteOpen(false)}
        >
          {inviteLink ? (
            <div className="simple-form">
              <span className="invite-ready">
                <Check size={22} />
              </span>
              <p>
                Share this link privately with the invited person. They’ll sign
                in or create their account to join.
              </p>
              <div className="invite-link">
                <input
                  aria-label="Invitation link"
                  value={inviteLink}
                  readOnly
                />
                <button
                  className="button primary small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink);
                      notify("Invitation link copied.");
                    } catch {
                      notify("Select and copy the invitation link.");
                    }
                  }}
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>
              <div className="info-note">
                <ShieldCheck size={18} />
                <p>
                  No email was sent. This link can be used once and expires in
                  seven days. Renewing it invalidates the previous link.
                </p>
              </div>
              <button
                className="button secondary full"
                onClick={() => setInviteOpen(false)}
              >
                Done
              </button>
            </div>
          ) : (
            <form
              className="simple-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                try {
                  const result = await api<{ url: string }>(
                    "/invitations",
                    values,
                  );
                  setInviteLink(result.url);
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  placeholder="teammate@example.com"
                />
              </label>
              <label>
                Workspace role
                <RoleSelect
                  name="role"
                  value={inviteRole}
                  onChange={setInviteRole}
                  allowAdmin={owner}
                />
              </label>
              <p>{roleText[inviteRole as Role]}</p>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <>
                    <MailPlus size={16} />
                    Create invitation link
                  </>
                )}
              </button>
            </form>
          )}
        </Modal>
      )}
      {remove && (
        <Modal title={`Remove ${remove.name}?`} onClose={() => setRemove(null)}>
          <div className="simple-form">
            <p>
              They’ll lose access to this workspace. Existing QR codes and scan
              history stay with the workspace. You can invite them again later.
            </p>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setRemove(null)}
              >
                Keep access
              </button>
              <button
                className="button danger-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/team/${remove.id}`, undefined, "DELETE");
                    setRemove(null);
                    refresh();
                    onAuthChange();
                    notify("Workspace access removed.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove access
              </button>
            </div>
          </div>
        </Modal>
      )}
      {transfer && (
        <Modal
          title="Pass the keys to your workspace."
          onClose={() => setTransfer(false)}
        >
          <form
            className="simple-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api(
                  "/workspace/transfer",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
                setTransfer(false);
                onAuthChange();
                refresh();
                notify("Ownership transferred. You now have admin access.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              The new owner can manage all workspace settings and admins. Your
              account keeps admin access.
            </p>
            <label>
              New owner
              <select name="userId" required>
                <option value="">Choose a member…</option>
                {members
                  .filter((m) => m.id !== auth.user?.id)
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name} · {m.email}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Your current password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              <Crown size={16} />
              Transfer ownership
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
