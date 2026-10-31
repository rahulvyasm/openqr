import { useState } from "react";
import { Check, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "../lib";
type Setup = { factorId: string; qr: string; secret: string };
export default function TwoStepPanel({
  enabled,
  onAuthChange,
  notify,
}: {
  enabled: boolean;
  onAuthChange: () => void;
  notify: (s: string) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [disabling, setDisabling] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-panel">
      <div className="settings-panel-heading">
        <div>
          <h2>Two-step sign-in.</h2>
          <p>
            {enabled
              ? "Your account asks for a code from your authenticator app after your password."
              : "Add a code from an authenticator app so a stolen password is not enough."}
          </p>
        </div>
        <ShieldCheck size={21} />
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {setup ? (
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code"));
            run(async () => {
              await api("/auth/mfa/confirm", {
                factorId: setup.factorId,
                code,
              });
              setSetup(null);
              onAuthChange();
              notify("Two-step sign-in is on.");
            });
          }}
        >
          <p>
            Scan this with Google Authenticator, 1Password, Authy or a similar
            app, then enter the 6-digit code it shows.
          </p>
          <img
            src={setup.qr}
            alt="Authenticator setup QR code"
            width={168}
            height={168}
            style={{ background: "#fff", padding: 8, borderRadius: 8 }}
          />
          <p>
            Can’t scan? Enter this key instead: <code>{setup.secret}</code>
          </p>
          <label>
            Authentication code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <div className="session-footer">
            <button className="button primary small" disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              Turn on
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSetup(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : enabled ? (
        disabling ? (
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const password = String(
                new FormData(e.currentTarget).get("password"),
              );
              run(async () => {
                await api("/auth/mfa/disable", { password });
                setDisabling(false);
                onAuthChange();
                notify("Two-step sign-in is off.");
              });
            }}
          >
            <label>
              Confirm with your password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <div className="session-footer">
              <button className="button secondary small" disabled={busy}>
                {busy && <Loader2 size={15} className="spin" />}
                Turn off
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setDisabling(false)}
              >
                Keep it on
              </button>
            </div>
          </form>
        ) : (
          <button
            className="button secondary small"
            onClick={() => setDisabling(true)}
          >
            Turn off two-step sign-in
          </button>
        )
      ) : (
        <button
          className="button primary small"
          disabled={busy}
          onClick={() =>
            run(async () => setSetup(await api<Setup>("/auth/mfa/enroll", {})))
          }
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Smartphone size={15} />}
          Set up two-step sign-in
        </button>
      )}
    </section>
  );
}
