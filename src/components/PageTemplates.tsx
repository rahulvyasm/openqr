import { useEffect, useState } from "react";
import { BookmarkPlus, Trash2, LayoutTemplate, Check } from "lucide-react";
import {
  api,
  defaultPageOptions,
  type PageOptions,
  type PageTemplate,
  type CodeType,
} from "../lib";
const looks = [
  {
    name: "Everyday",
    options: {
      layout: "card",
      font: "modern",
      corners: "rounded",
      buttonStyle: "outline",
      theme: "soft",
    },
  },
  {
    name: "Editorial",
    options: {
      layout: "editorial",
      font: "serif",
      corners: "square",
      buttonStyle: "solid",
      theme: "minimal",
    },
  },
  {
    name: "Spotlight",
    options: {
      layout: "card",
      font: "modern",
      corners: "rounded",
      buttonStyle: "solid",
      theme: "bold",
    },
  },
  {
    name: "Compact",
    options: {
      layout: "compact",
      font: "modern",
      corners: "square",
      buttonStyle: "outline",
      theme: "soft",
    },
  },
] as { name: string; options: Partial<PageOptions> }[];
export default function PageTemplates({
  type,
  data,
  options,
  onOptions,
  onApply,
}: {
  type: CodeType;
  data: Record<string, string>;
  options: PageOptions;
  onOptions: (p: PageOptions) => void;
  onApply: (t: PageTemplate) => void;
}) {
  const [templates, setTemplates] = useState<PageTemplate[]>([]),
    [name, setName] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const load = () =>
    api<PageTemplate[]>("/page-templates")
      .then(setTemplates)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const matching = templates.filter((t) => t.type === type);
  return (
    <div className="page-template-library">
      <div className="editor-section-label">
        <LayoutTemplate size={15} />
        START WITH A PAGE LAYOUT
      </div>
      <div className="page-look-gallery">
        {looks.map((look) => (
          <button
            type="button"
            key={look.name}
            aria-label={`Apply ${look.name} page layout`}
            onClick={() => onOptions({ ...options, ...look.options })}
          >
            <span
              className={`page-look-sample ${look.options.layout} ${look.options.font}`}
              style={{
                background:
                  look.options.theme === "bold" ? options.accent : "#f1f4e9",
              }}
            >
              <i />
              <b />
              <em />
              <em />
            </span>
            <small>{look.name}</small>
          </button>
        ))}
      </div>
      {!!matching.length && (
        <label>
          Saved page templates
          <select
            aria-label="Saved page templates"
            value=""
            onChange={(e) => {
              const t = matching.find((t) => t.id === e.target.value);
              if (t)
                onApply({
                  ...t,
                  pageOptions: { ...defaultPageOptions, ...t.pageOptions },
                });
            }}
          >
            <option value="">Choose a template…</option>
            {matching.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setOpen(!open);
          setSaved(false);
        }}
      >
        <BookmarkPlus size={14} />
        Save this page as a template
      </button>
      {open && (
        <div className="page-template-save">
          <input
            aria-label="Page template name"
            value={name}
            maxLength={60}
            placeholder="e.g. Our product launch"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="button secondary small"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/page-templates", {
                  name,
                  type,
                  data,
                  pageOptions: options,
                });
                await load();
                setSaved(true);
                setOpen(false);
                setName("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save template"}
          </button>
          <p className="hint">
            Includes page content, selected media, and layout. Saved templates
            belong to this workspace.
          </p>
        </div>
      )}
      {saved && (
        <p className="template-saved" role="status">
          <Check size={13} />
          Page template saved.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!!matching.length && (
        <details className="manage-page-templates">
          <summary>Manage saved page templates</summary>
          {matching.map((t) => (
            <div key={t.id}>
              <span>{t.name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove page template ${t.name}`}
                onClick={async () => {
                  if (
                    !confirm(
                      `Remove the “${t.name}” template? Existing QR pages keep their content.`,
                    )
                  )
                    return;
                  try {
                    await api(`/page-templates/${t.id}`, undefined, "DELETE");
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
