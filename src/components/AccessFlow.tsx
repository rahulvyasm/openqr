import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  QrCode,
  Users,
} from "lucide-react";
import { api, type User } from "../lib";
export type AccessLink = { kind: "invite" | "reset"; token: string };
export function readAccessLink(): AccessLink | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  for (const kind of ["invite", "reset"] as const) {
    const token = params.get(kind);
    if (token) return { kind, token };
  }
  return null;
}
export default function AccessFlow({
  link,
  user,
  onDone,
  onAuthChange,
}: {
  link: AccessLink;
  user: User | null;
  onDone: () => void;
  onAuthChange: () => void;
}) {
  const [invite, setInvite] = useState<{
      email: string;
      role: string;
      workspaceName: string;
      existingAccount: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  useEffect(() => {
    let current = true;
    if (link.kind === "invite")
      api<typeof invite>("/auth/invite/inspect", { token: link.token })
        .then((v) => {
          if (current) setInvite(v);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [link]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (link.kind === "reset") {
        if (values.password !== values.confirm)
          throw new Error("The new passwords do not match.");
        await api("/auth/reset", {
          token: link.token,
          password: values.password,
        });
        setComplete(true);
        onAuthChange();
      } else if (invite) {
        if (invite.existingAccount && !user)
          await api("/auth/login", {
            email: invite.email,
            password: values.password,
          });
        await api("/auth/invite/accept", { token: link.token, ...values });
        onAuthChange();
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="access-page">
      <div className="access-brand">
        <QrCode size={24} />
        <span>openqr.</span>
      </div>
      <main className="access-card">
        <span className="access-symbol">
          {complete ? (
            <CheckCircle2 />
          ) : link.kind === "reset" ? (
            <KeyRound />
          ) : (
            <Users />
          )}
        </span>
        <span className="small-label">
          {link.kind === "reset"
            ? "A FRESH START"
            : "GOOD THINGS HAPPEN TOGETHER"}
        </span>
        <h1>
          {complete
            ? "You’re back in control."
            : link.kind === "reset"
              ? "Choose a new password."
              : invite
                ? `Join ${invite.workspaceName}.`
                : "Your invitation is opening…"}
        </h1>
        <p>
          {complete
            ? "Your password is updated and previous sessions are signed out."
            : link.kind === "reset"
              ? "This link works once. Your other sessions will be signed out."
              : invite
                ? `You’re invited as ${invite.role === "admin" ? "an admin" : `a ${invite.role}`}. Sign in or create your account to get started.`
                : "Just a moment while we check this invitation."}
        </p>
        {complete ? (
          <button className="button primary full" onClick={onDone}>
            Back to sign in
            <ArrowRight size={16} />
          </button>
        ) : (
          <form onSubmit={submit}>
            {link.kind === "invite" && invite && (
              <label>
                Invited email
                <input type="email" value={invite.email} readOnly />
              </label>
            )}
            {link.kind === "invite" &&
            invite &&
            user &&
            user.email !== invite.email ? (
              <div className="info-note">
                <p>
                  You’re signed in as {user.email}. Sign out to continue with
                  the invited email.
                </p>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await api("/auth/logout", {});
                      onAuthChange();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <>
                {link.kind === "invite" &&
                  invite &&
                  !invite.existingAccount && (
                    <label>
                      Your name
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        maxLength={80}
                      />
                    </label>
                  )}
                {(link.kind === "reset" || (invite && !user)) && (
                  <label>
                    {link.kind === "invite" && invite?.existingAccount
                      ? "Your password"
                      : "New password"}
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        link.kind === "invite" && invite?.existingAccount
                          ? "current-password"
                          : "new-password"
                      }
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                )}
                {link.kind === "reset" && (
                  <label>
                    Confirm new password
                    <input
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                )}
                {error && (
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                )}
                {(link.kind === "reset" || invite) && (
                  <button className="button primary full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <>
                        {link.kind === "reset"
                          ? "Update password"
                          : invite?.existingAccount && !user
                            ? "Sign in and join"
                            : "Join workspace"}
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                )}
              </>
            )}
            {error && !invite && link.kind === "invite" && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
          </form>
        )}
        <button className="text-button access-back" onClick={onDone}>
          <ArrowLeft size={13} />
          Back to workspace
        </button>
      </main>
      <span className="access-footer">
        Your codes. Your people. Your platform.
      </span>
    </div>
  );
}
