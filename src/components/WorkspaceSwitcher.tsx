import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { api, type Workspace } from "../lib";
import Modal from "./Modal";
export default function WorkspaceSwitcher({
  workspace,
  workspaces,
  onChange,
  notify,
}: {
  workspace: Workspace | null;
  workspaces: Workspace[];
  onChange: () => void;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <div className="workspace-control" ref={ref}>
      <button
        className="workspace-switch"
        aria-expanded={open}
        aria-label="Switch workspace"
        onClick={() => setOpen(!open)}
      >
        <span className="workspace-avatar">
          {workspace?.name[0]?.toUpperCase() || "+"}
        </span>
        <span>
          <strong>{workspace?.name || "Choose a workspace"}</strong>
          <small>
            {workspace
              ? `${workspace.role[0].toUpperCase() + workspace.role.slice(1)} access`
              : "Your ideas belong here"}
          </small>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="workspace-menu">
          <span className="small-label">YOUR WORKSPACES</span>
          {workspaces.map((w) => (
            <button
              disabled={busy}
              key={w.id}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/workspaces/${w.id}/select`, {});
                  setOpen(false);
                  onChange();
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span>
                <strong>{w.name}</strong>
                <small>{w.role}</small>
              </span>
              {workspace?.id === w.id && <Check size={14} />}
            </button>
          ))}
          <button
            className="workspace-add"
            onClick={() => {
              setError("");
              setOpen(false);
              setCreate(true);
            }}
          >
            <Plus size={15} />
            New workspace
          </button>
        </div>
      )}
      {create && (
        <Modal
          title="Make room for your next idea."
          onClose={() => setCreate(false)}
        >
          <form
            className="simple-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              setBusy(true);
              try {
                await api("/workspaces", { name });
                setCreate(false);
                onChange();
                notify("Your new workspace is ready.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Each workspace keeps its codes, designs, analytics, and team
              separate.
            </p>
            <label>
              Workspace name
              <input
                name="name"
                placeholder="e.g. Studio North"
                required
                maxLength={80}
              />
            </label>
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
                  <Plus size={16} />
                  Create workspace
                </>
              )}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
