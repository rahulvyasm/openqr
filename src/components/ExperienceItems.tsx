import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  FileUp,
  Loader2,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { api, formatNumber } from "../lib";

type Service = { id: number; date: string; note: string };
type Item = {
  id: string;
  name: string;
  serial: string;
  warrantyUntil: string;
  shortUrl: string;
  scans: number;
  responses: number;
  service: Service[];
};

const parseLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, serial = "", warrantyUntil = ""] = line
        .split(",")
        .map((part) => part.trim());
      return { name, serial, warrantyUntil };
    });

import { parseCsv, MAX_BATCH, type Row } from "./itemCsv";

export default function ExperienceItems({
  codeId,
  editable,
}: {
  codeId: string;
  editable: boolean;
}) {
  const path = `/codes/${codeId}/experience/items`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [serviceNote, setServiceNote] = useState("");
  const [imported, setImported] = useState<Row[]>([]);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    api<Item[]>(path)
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  }, [path]);

  const replace = (item: Item) =>
    setItems((list) => list?.map((i) => (i.id === item.id ? item : i)) ?? null);
  const guard = async <T,>(job: () => Promise<T>) => {
    setError("");
    try {
      return await job();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const lines = [...imported, ...parseLines(text)];

  async function create() {
    setBusy(true);
    setError("");
    let done = 0;
    try {
      // The server takes 100 at a time; larger lists go in several requests.
      for (let at = 0; at < lines.length; at += 100) {
        setProgress(
          `Creating ${Math.min(at + 100, lines.length)} of ${lines.length}…`,
        );
        const made = await api<Item[]>(path, {
          items: lines.slice(at, at + 100),
        });
        done += made.length;
        setItems((list) => [...made, ...(list ?? [])]);
      }
      setText("");
      setImported([]);
    } catch (e) {
      setError(
        `${(e as Error).message}${done ? ` ${done} of ${lines.length} were created before this.` : ""}`,
      );
      // Keep only what is left so a retry does not create duplicates.
      const rest = lines.slice(done);
      setImported(rest);
      setText("");
    }
    setProgress("");
    setBusy(false);
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 2_000_000) {
      setError("Choose a CSV file under 2 MB.");
      return;
    }
    const rows = parseCsv(await file.text());
    if (!rows.length) setError("That file has no rows.");
    else setImported(rows);
  }

  return (
    <div className="xs-pane">
      <p className="xs-intro">
        Give every product, asset or room its own code and page. They all use
        this page&apos;s blocks, so one edit updates every printed code. Each
        item keeps its own serial number, warranty and service history, and its
        responses and results also appear here. Add an <b>Item details</b> block
        in Build to show them.
      </p>
      {editable && (
        <div className="xs-items-add">
          <label>
            One item per line: name, serial, warranty date. Or import a CSV with
            those three columns.
            <textarea
              value={text}
              rows={4}
              placeholder={
                "Kettle #1, SN-0001, 2027-03-31\nKettle #2, SN-0002, 2027-03-31"
              }
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button primary small"
            disabled={busy || !lines.length || lines.length > MAX_BATCH}
            onClick={create}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            Create {lines.length || ""} code{lines.length === 1 ? "" : "s"}
          </button>
          <div className="xs-row-actions">
            <label className="button secondary small xs-file">
              <FileUp size={14} /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {imported.length > 0 && (
              <small className="hint">
                {formatNumber(imported.length)} rows from your file.{" "}
                <button
                  type="button"
                  className="xs-link"
                  onClick={() => setImported([])}
                >
                  Clear
                </button>
              </small>
            )}
          </div>
          {progress && <small className="hint">{progress}</small>}
          {lines.length > MAX_BATCH && (
            <small className="hint">
              Up to {formatNumber(MAX_BATCH)} items at a time.
            </small>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!items ? (
        <Loader2 className="spin" />
      ) : items.length === 0 ? (
        <p className="hint">No items yet.</p>
      ) : (
        <>
          <div className="xs-row-actions">
            <a
              className="button secondary small"
              href={`/api${path}/labels`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Printer size={14} /> Print labels
            </a>
          </div>
          <ul className="xs-list xs-items">
            {items.map((item) => (
              <li key={item.id}>
                <div className="xs-item-head">
                  <button
                    type="button"
                    className="xs-toggle"
                    aria-expanded={open === item.id}
                    onClick={() => setOpen(open === item.id ? null : item.id)}
                  >
                    <span>{item.name}</span>
                    <em>
                      {[
                        item.serial,
                        item.warrantyUntil && `warranty ${item.warrantyUntil}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </em>
                  </button>
                  <small>
                    {formatNumber(item.scans)} scans ·{" "}
                    {formatNumber(item.responses)} responses
                  </small>
                  <a
                    className="icon-button"
                    aria-label={`Download QR for ${item.name}`}
                    title="Download QR"
                    href={`/api/codes/${item.id}/download?format=png`}
                  >
                    <Download size={15} />
                  </a>
                  <a
                    className="icon-button"
                    aria-label={`Open page for ${item.name}`}
                    title="Open page"
                    href={item.shortUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
                {open === item.id && (
                  <div className="xs-body">
                    <div className="xs-pair xs-item-edit">
                      {(
                        [
                          ["name", "Name"],
                          ["serial", "Serial"],
                          ["warrantyUntil", "Warranty until"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type={key === "warrantyUntil" ? "date" : "text"}
                            value={item[key]}
                            disabled={!editable}
                            onChange={(e) =>
                              replace({ ...item, [key]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    {editable && (
                      <div className="xs-row-actions">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={async () => {
                            const saved = await guard(() =>
                              api<Item>(
                                `${path}/${item.id}`,
                                {
                                  name: item.name,
                                  serial: item.serial,
                                  warrantyUntil: item.warrantyUntil,
                                },
                                "PUT",
                              ),
                            );
                            if (saved) replace(saved);
                          }}
                        >
                          Save details
                        </button>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={async () => {
                            if (
                              !confirm(
                                `Delete ${item.name}? Its printed code will stop working.`,
                              )
                            )
                              return;
                            const done = await guard(() =>
                              api(`${path}/${item.id}`, undefined, "DELETE"),
                            );
                            if (done)
                              setItems(
                                (list) =>
                                  list?.filter((i) => i.id !== item.id) ?? null,
                              );
                          }}
                        >
                          <Trash2 size={13} /> Delete item
                        </button>
                      </div>
                    )}
                    <h4 className="xs-h">Service history</h4>
                    {item.service.length === 0 && (
                      <p className="hint">Nothing recorded yet.</p>
                    )}
                    <ul className="xs-service">
                      {item.service.map((s) => (
                        <li key={s.id}>
                          <time>{s.date}</time>
                          <span>{s.note}</span>
                          {editable && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Remove service entry"
                              onClick={async () => {
                                const next = await guard(() =>
                                  api<Item>(
                                    `${path}/${item.id}/service/${s.id}`,
                                    undefined,
                                    "DELETE",
                                  ),
                                );
                                if (next) replace(next);
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {editable && (
                      <div className="xs-service-add">
                        <input
                          type="date"
                          aria-label="Service date"
                          value={serviceDate}
                          onChange={(e) => setServiceDate(e.target.value)}
                        />
                        <input
                          aria-label="Service note"
                          placeholder="What was done"
                          maxLength={300}
                          value={serviceNote}
                          onChange={(e) => setServiceNote(e.target.value)}
                        />
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={!serviceNote.trim()}
                          onClick={async () => {
                            const next = await guard(() =>
                              api<Item>(`${path}/${item.id}/service`, {
                                date: serviceDate,
                                note: serviceNote,
                              }),
                            );
                            if (next) {
                              replace(next);
                              setServiceNote("");
                            }
                          }}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
