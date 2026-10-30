import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Loader2 } from "lucide-react";
import { api } from "../lib";
import Modal from "./Modal";

type Request = {
  number: number;
  category: string;
  status: string;
  subject: string;
  updatedAt: string;
  unread?: boolean;
};
type Detail = Request & {
  createdAt: string;
  replies: { id: number; body: string; at: string; you: boolean }[];
};
const categories = [
  ["billing", "Billing"],
  ["subscription", "Plan or subscription"],
  ["account", "My account"],
  ["technical", "Something is not working"],
  ["other", "Something else"],
];
const when = (value: string) => new Date(value).toLocaleString();

export default function SupportPanel({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const [requests, setRequests] = useState<Request[] | null>(null),
    [open, setOpen] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<Request[]>("/support/requests")
        .then((rows) => {
          setRequests(rows);
          window.dispatchEvent(new Event("support-changed"));
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <span className="small-label">WE ARE HERE</span>
            <h2>Contact support.</h2>
            <p>
              Billing, plan, or account trouble? Tell us what happened. Support
              staff see your workspace’s plan and usage, never your QR content,
              visitors, files, or password. Do not include a password or card
              number.
            </p>
          </div>
          <LifeBuoy size={21} />
        </div>
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            setBusy(true);
            setError("");
            try {
              await api(
                "/support/requests",
                Object.fromEntries(new FormData(form)),
              );
              form.reset();
              notify("Request sent. Support will reply here.");
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Topic
            <select name="category" defaultValue="billing">
              {categories.map(([id, text]) => (
                <option key={id} value={id}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input name="subject" required minLength={3} maxLength={120} />
          </label>
          <label>
            What happened?
            <textarea name="message" required maxLength={2000} rows={4} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
      </section>
      <section className="settings-panel">
        <h2>Your requests</h2>
        {!requests ? (
          <Loader2 className="spin" />
        ) : requests.length === 0 ? (
          <p className="hint">
            You have not contacted support from this workspace.
          </p>
        ) : (
          <ul className="case-list">
            {requests.map((r) => (
              <li key={r.number}>
                <button
                  className="link-button"
                  onClick={() => setOpen(r.number)}
                >
                  SUP-{r.number}
                </button>{" "}
                {r.subject} · {r.status} · {when(r.updatedAt)}
                {r.unread && <strong className="nav-alert"> New reply</strong>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {open !== null && (
        <RequestDialog
          number={open}
          onClose={() => setOpen(null)}
          onChange={() => void load()}
        />
      )}
    </>
  );
}

function RequestDialog({
  number,
  onClose,
  onChange,
}: {
  number: number;
  onClose: () => void;
  onChange: () => void;
}) {
  const [item, setItem] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<Detail>(`/support/requests/${number}`)
        .then((value) => {
          setItem(value);
          window.dispatchEvent(new Event("support-changed"));
        })
        .catch((e) => setError(e.message)),
    [number],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal title={`Request SUP-${number}`} onClose={onClose} wide>
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
            Status: {item.status} · opened {when(item.createdAt)}
          </p>
          {item.status !== "closed" && (
            <form
              className="simple-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                setBusy(true);
                setError("");
                try {
                  await api(
                    `/support/requests/${number}/replies`,
                    Object.fromEntries(new FormData(form)),
                  );
                  form.reset();
                  await load();
                  onChange();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Reply
                <textarea name="message" required maxLength={2000} rows={3} />
              </label>
              <button className="button primary small" disabled={busy}>
                Send reply
              </button>
            </form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="operator-feed">
            {item.replies.map((reply) => (
              <article key={reply.id}>
                <div>
                  <strong>{reply.you ? "You" : "Support"}</strong>
                  <p>{reply.body}</p>
                  <small>{when(reply.at)}</small>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
