import { ArrowRight, Bookmark, Palette, Trash2 } from "lucide-react";
import { api, type DesignTemplate } from "../lib";
import QrImage from "./QrImage";
import { presets } from "./designPresets";
export default function DesignStudio({
  canEdit,
  templates,
  onCreate,
  onRefresh,
  notify,
}: {
  canEdit: boolean;
  templates: DesignTemplate[];
  onCreate: (t: DesignTemplate) => void;
  onRefresh: () => void;
  notify: (s: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FORM / COLOR / CHARACTER</span>
          <h1>
            Built to stand out<span>.</span>
          </h1>
          <p>Pick a starting point. Make it unmistakably yours.</p>
        </div>
        <span className="studio-label">
          <Palette size={16} />
          DESIGN STUDIO
        </span>
      </div>
      <div className="studio-section-title">
        <h2>The starting collection</h2>
        <span>Designed to make a connection.</span>
      </div>
      <div className="design-gallery">
        {presets.map((t, i) => (
          <article className="design-gallery-card" key={t.name}>
            <div
              className="design-gallery-preview"
              style={{
                background: [
                  "#edf3e8",
                  "#eeeff6",
                  "#f8ede5",
                  "#f5edf2",
                  "#f0f1ed",
                ][i],
              }}
            >
              <QrImage
                content="https://example.com/openqr"
                color={t.color}
                design={t.design}
                size={172}
              />
            </div>
            <div>
              <h3>{t.name}</h3>
              <p>
                {
                  [
                    "Warm, grounded, and quietly confident.",
                    "A sharp look for your next big idea.",
                    "A little sunshine. A lot of character.",
                    "For the brands that do things differently.",
                    "The original, with nothing in the way.",
                  ][i]
                }
              </p>
              <button
                className="button secondary small"
                disabled={!canEdit}
                onClick={() => onCreate({ ...t, id: `preset-${i}` })}
              >
                Make it yours
                <ArrowRight size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="studio-section-title saved-design-title">
        <h2>
          <Bookmark size={17} />
          Your saved designs
        </h2>
        <span>{templates.length} in your collection</span>
      </div>
      {templates.length ? (
        <div className="design-gallery">
          {templates.map((t) => (
            <article className="design-gallery-card" key={t.id}>
              <div className="design-gallery-preview">
                <QrImage
                  content="https://example.com/openqr"
                  color={t.color}
                  design={t.design}
                  size={172}
                />
              </div>
              <div>
                <h3>{t.name}</h3>
                <div className="saved-design-actions">
                  <button
                    className="button secondary small"
                    disabled={!canEdit}
                    onClick={() => onCreate(t)}
                  >
                    Use design
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="Remove saved design (existing codes keep their design)"
                    disabled={!canEdit}
                    aria-label={`Remove saved design ${t.name}`}
                    onClick={async () => {
                      try {
                        await api(`/templates/${t.id}`, undefined, "DELETE");
                        onRefresh();
                        notify(
                          "Saved design removed. Existing codes keep their look.",
                        );
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="studio-empty">
          <Bookmark size={24} />
          <h3>Your signature look belongs here.</h3>
          <p>
            Save a design in the QR editor. Reuse it for a code or an entire CSV
            import.
          </p>
        </div>
      )}
    </>
  );
}
