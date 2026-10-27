import { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  Download,
} from "lucide-react";
import {
  api,
  saveBlob,
  type CodeType,
  type Folder,
  type DesignTemplate,
} from "../lib";
import Modal from "./Modal";

export default function BulkImport({
  folders,
  templates,
  initialFolder,
  onClose,
  onSave,
}: {
  folders: Folder[];
  templates: DesignTemplate[];
  initialFolder?: string;
  onClose: () => void;
  onSave: () => void;
}) {
  const [csv, setCsv] = useState(""),
    [type, setType] = useState<CodeType>("url"),
    [dynamic, setDynamic] = useState(true),
    [folderId, setFolderId] = useState(initialFolder || ""),
    [templateId, setTemplateId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const parsed = useMemo(
    () =>
      Papa.parse<Record<string, string>>(csv.trim(), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().toLowerCase(),
      }),
    [csv],
  );
  const required =
    type === "url"
      ? ["name", "url"]
      : type === "text"
        ? ["name", "text"]
        : ["name", "fullname"];
  const missing = required.filter((h) => !parsed.meta.fields?.includes(h));
  const parseError =
    csv &&
    (parsed.errors.length
      ? `CSV row ${(parsed.errors[0].row || 0) + 2}: ${parsed.errors[0].message}`
      : missing.length
        ? `Missing columns: ${missing.join(", ")}`
        : parsed.data.length > 100
          ? "Import up to 100 codes at a time."
          : parsed.data.some((row) => required.some((h) => !row[h]?.trim()))
            ? "Every row needs a name and its required content."
            : "");
  const sample = () => {
    const text =
      type === "url"
        ? "name,url,slug\nOur website,https://example.com,our-website\nSummer launch,https://example.com/summer,summer-launch\n"
        : type === "text"
          ? "name,text\nA little hello,Hello from OpenQR\n"
          : "name,fullname,company,phone,email\nAlex contact,Alex Morgan,Studio North,+15551234567,alex@example.com\n";
    saveBlob(
      new Blob([text], { type: "text/csv" }),
      `openqr-${type}-template.csv`,
    );
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (parseError || !parsed.data.length) return;
    setBusy(true);
    setError("");
    const template = templates.find((t) => t.id === templateId);
    try {
      await api("/codes/bulk", {
        codes: parsed.data.map((row) => ({
          name: row.name.trim(),
          type,
          dynamic: type === "url" && dynamic,
          data:
            type === "url"
              ? { url: row.url.trim() }
              : type === "text"
                ? { text: row.text }
                : {
                    fullName: row.fullname,
                    company: row.company || "",
                    phone: row.phone || "",
                    email: row.email || "",
                  },
          ...(row.slug?.trim() ? { slug: row.slug.trim() } : {}),
        })),
        common: {
          folderId: folderId || null,
          ...(template
            ? { color: template.color, design: template.design }
            : {}),
        },
      });
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title="One file. A hundred possibilities." onClose={onClose}>
      <form onSubmit={submit}>
        <div className="bulk-content">
          <div className="bulk-intro">
            <span>
              <FileSpreadsheet size={23} />
            </span>
            <div>
              <h3>Bring your ideas in bulk.</h3>
              <p>
                Upload a CSV, review the rows, and create everything together.
              </p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={sample}
            >
              <Download size={14} />
              Get a template
            </button>
          </div>
          <div className="bulk-options">
            <label>
              Content type
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as CodeType);
                  setError("");
                }}
              >
                <option value="url">Website</option>
                <option value="text">Plain text</option>
                <option value="vcard">Contact card</option>
              </select>
            </label>
            <label>
              Folder
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Design
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Classic design</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {type === "url" && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={dynamic}
                onChange={(e) => setDynamic(e.target.checked)}
              />
              Create dynamic links with scan analytics
            </label>
          )}
          <label className="csv-upload">
            <Upload size={23} />
            <strong>Choose a CSV file</strong>
            <span>or paste your CSV below · Up to 100 rows, 512 KB</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Upload CSV"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 524288) {
                  setError("Choose a CSV file smaller than 512 KB.");
                  return;
                }
                setCsv(await file.text());
                setError("");
                e.target.value = "";
              }}
            />
          </label>
          <label>
            CSV content
            <textarea
              className="csv-textarea"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value.slice(0, 524288));
                setError("");
              }}
              placeholder={
                type === "url"
                  ? "name,url\nOur website,https://example.com"
                  : type === "text"
                    ? "name,text\nA little hello,Hello world"
                    : "name,fullname,company,phone,email"
              }
              spellCheck={false}
            />
          </label>
          {parseError && (
            <div className="form-error" role="alert">
              {parseError}
            </div>
          )}
          {csv && !parseError && parsed.data.length > 0 && (
            <>
              <div className="import-status">
                <CheckCircle2 size={16} />
                {parsed.data.length} codes ready to create
                <span>All rows save together.</span>
              </div>
              <div className="import-preview">
                <table>
                  <thead>
                    <tr>
                      <th>ROW</th>
                      <th>NAME</th>
                      <th>CONTENT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.data.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        <td>{i + 2}</td>
                        <td>{row.name}</td>
                        <td>{row.url || row.text || row.fullname}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.data.length > 5 && (
                  <p>And {parsed.data.length - 5} more…</p>
                )}
              </div>
            </>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!csv || !!parseError || !parsed.data.length || busy}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <>
                <Upload size={16} />
                Create {parsed.data.length || ""} codes
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
