import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ClipboardList,
  Download,
  FileText,
  Heading,
  History,
  Image as ImageIcon,
  Inbox,
  Link2,
  Clock,
  Loader2,
  Package,
  MousePointerClick,
  Plus,
  RotateCcw,
  Rocket,
  Trash2,
  Type,
  Video,
} from "lucide-react";
import {
  api,
  formatNumber,
  mayEdit,
  type Asset,
  type Code,
  type PageOptions,
  type Role,
} from "../lib";
import Modal from "./Modal";
import ExperienceItems from "./ExperienceItems";
import { AssetPicker, type AssetFilter } from "./MediaLibrary";

type Field = {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "choice" | "rating";
  required: boolean;
  options: string[];
};
export type Block = { id: string; type: string; [key: string]: unknown };
type Draft = {
  title: string;
  blocks: Block[];
  dirty: boolean;
  updatedAt: string | null;
};
type Version = {
  version: number;
  note: string;
  createdAt: string;
  author: string | null;
};
type Submission = {
  item?: string;
  id: number;
  form: string;
  answers: Record<string, string>;
  createdAt: string;
  read: boolean;
};
type Stats = {
  scans: number;
  submissions: number;
  taps: number;
  conversion: number;
  actions: { blockId: string; label: string; kind: string; count: number }[];
};
export type Starter = {
  id: string;
  intent: string;
  name: string;
  description: string;
  title: string;
  blocks: Block[];
};

// Reads a wall-clock time as being in the page's zone and returns the instant.
function zonedIso(local: string, zone: string) {
  try {
    const guess = new Date(local + "Z");
    const shown = new Date(guess.toLocaleString("en-US", { timeZone: zone }));
    const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(
      guess.getTime() - (shown.getTime() - asUtc.getTime()),
    ).toISOString();
  } catch {
    return undefined;
  }
}
const zoneNames: string[] =
  (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf?.("timeZone") ?? ["UTC"];
const uid = () => "b" + Math.random().toString(36).slice(2, 8);
const palette = [
  ["heading", "Heading", Heading],
  ["text", "Text", Type],
  ["image", "Image", ImageIcon],
  ["video", "Video", Video],
  ["button", "Button", MousePointerClick],
  ["links", "Links", Link2],
  ["file", "File", FileText],
  ["form", "Form", ClipboardList],
  ["item", "Item details", Package],
] as const;
const blockName = Object.fromEntries(palette.map(([k, n]) => [k, n])) as Record<
  string,
  string
>;
const blank = (type: string): Block => {
  const id = uid();
  switch (type) {
    case "heading":
      return { id, type, text: "A new heading", subtext: "" };
    case "text":
      return { id, type, text: "Write something helpful." };
    case "image":
      return { id, type, assetId: "", alt: "", caption: "" };
    case "video":
      return { id, type, assetId: "", caption: "" };
    case "button":
      return { id, type, label: "Learn more", url: "https://" };
    case "links":
      return { id, type, items: [{ label: "Link", url: "https://" }] };
    case "file":
      return { id, type, assetId: "", label: "Download" };
    case "item":
      return { id, type, title: "About this item" };
    default:
      return {
        id,
        type: "form",
        title: "Get in touch",
        intro: "",
        submitLabel: "Send",
        successMessage: "Thank you. We received your response.",
        fields: [
          { id: "q1", label: "Email", type: "email", required: true, options: [] },
        ],
      };
  }
};
const summary = (b: Block) => {
  const s = (key: string) => String(b[key] ?? "");
  switch (b.type) {
    case "heading":
      return s("text");
    case "text":
      return s("text").slice(0, 60);
    case "button":
      return s("label");
    case "form":
    case "item":
      return s("title");
    case "file":
      return s("label");
    case "links":
      return `${(b.items as unknown[]).length} links`;
    default:
      return s("caption") || s("alt") || "";
  }
};

export function PhoneFrame({
  title,
  blocks,
  options,
  at,
  timeZone,
}: {
  title: string;
  blocks: Block[];
  options: Partial<PageOptions>;
  at?: string;
  timeZone?: string;
}) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/experience/preview", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            blocks,
            pageOptions: options,
            ...(at ? { at } : {}),
            ...(timeZone ? { timeZone } : {}),
          }),
          signal: controller.signal,
        });
        if (res.ok) setHtml(await res.text());
      } catch {
        /* A newer edit replaced this request. */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [title, blocks, options, at, timeZone]);
  return (
    <div className="xs-phone" aria-label="Phone preview">
      <i className="xs-notch" />
      <iframe title="Mobile preview" sandbox="" srcDoc={html} />
    </div>
  );
}

export function StarterPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (starter: Starter) => void;
}) {
  const [starters, setStarters] = useState<Starter[]>([]);
  const picked = useRef(false);
  useEffect(() => {
    api<Starter[]>("/experience/templates")
      .then((list) => {
        setStarters(list);
        if (!value && !picked.current && list[0]) {
          picked.current = true;
          onPick(list[0]);
        }
      })
      .catch(() => {});
    // The first starter is applied once so a new code is always valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="xs-starters" role="radiogroup" aria-label="Start from">
      {starters.map((s) => (
        <button
          type="button"
          key={s.id}
          role="radio"
          aria-checked={value === s.title}
          className={value === s.title ? "on" : ""}
          onClick={() => onPick(s)}
        >
          <small>{s.intent.toUpperCase()}</small>
          <strong>{s.name}</strong>
          <span>{s.description}</span>
        </button>
      ))}
    </div>
  );
}

function Pick({
  filter,
  assetId,
  assets,
  onPick,
  disabled,
}: {
  filter: AssetFilter;
  assetId: string;
  assets: Asset[];
  onPick: (asset: Asset) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const asset = assets.find((a) => a.id === assetId);
  return (
    <>
      <button
        type="button"
        className="button secondary small xs-pick"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {asset ? asset.name : assetId ? "Chosen file" : "Choose from library"}
      </button>
      {open && (
        <AssetPicker
          filter={filter}
          onSelect={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type When = { days: number[]; from?: string; to?: string };
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function RuleEditor({
  when,
  disabled,
  onChange,
}: {
  when?: When;
  disabled: boolean;
  onChange: (when: When | undefined) => void;
}) {
  if (!when)
    return (
      <button
        type="button"
        className="button secondary small xs-rule-add"
        disabled={disabled}
        onClick={() => onChange({ days: [], from: "09:00", to: "17:00" })}
      >
        <Clock size={14} /> Show only at certain times
      </button>
    );
  const timed = when.from !== undefined;
  const set = (patch: Partial<When>) => {
    const next = { ...when, ...patch };
    if (!next.days.length && next.from === undefined)
      next.days = [0, 1, 2, 3, 4, 5, 6];
    onChange(next);
  };
  return (
    <div className="xs-rule">
      <strong>
        <Clock size={13} /> Shown only…
      </strong>
      <div className="xs-days" role="group" aria-label="Days">
        {dayNames.map((d, i) => (
          <label key={d} className={when.days.includes(i) ? "on" : ""}>
            <input
              type="checkbox"
              checked={when.days.includes(i)}
              disabled={disabled}
              onChange={() =>
                set({
                  days: when.days.includes(i)
                    ? when.days.filter((x) => x !== i)
                    : [...when.days, i].sort(),
                })
              }
            />
            {d}
          </label>
        ))}
      </div>
      <label className="xs-req">
        <input
          type="checkbox"
          checked={timed}
          disabled={disabled}
          onChange={(e) =>
            set(
              e.target.checked
                ? { from: "09:00", to: "17:00" }
                : { from: undefined, to: undefined },
            )
          }
        />
        Between
      </label>
      {timed && (
        <div className="xs-pair xs-times">
          <input
            type="time"
            aria-label="From"
            value={when.from}
            disabled={disabled}
            onChange={(e) => set({ from: e.target.value })}
          />
          <input
            type="time"
            aria-label="Until"
            value={when.to}
            disabled={disabled}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
      )}
      <small className="hint">
        {when.days.length ? "On the chosen days" : "Every day"}
        {timed ? `, ${when.from}–${when.to}` : ""}. A range like 22:00–02:00 runs
        overnight.
      </small>
      <button
        type="button"
        className="button secondary small"
        disabled={disabled}
        onClick={() => onChange(undefined)}
      >
        Always show
      </button>
    </div>
  );
}

function FieldEditor({
  block,
  assets,
  onChange,
  disabled,
  onAsset,
}: {
  block: Block;
  assets: Asset[];
  onChange: (patch: Partial<Block>) => void;
  disabled: boolean;
  onAsset: (asset: Asset) => void;
}) {
  const str = (key: string, label: string, props: object = {}) => (
    <label>
      {label}
      <input
        value={String(block[key] ?? "")}
        onChange={(e) => onChange({ [key]: e.target.value })}
        disabled={disabled}
        {...props}
      />
    </label>
  );
  switch (block.type) {
    case "heading":
      return (
        <>
          {str("text", "Heading", { maxLength: 120 })}
          {str("subtext", "Supporting line", { maxLength: 300 })}
        </>
      );
    case "text":
      return (
        <label>
          Text
          <textarea
            value={String(block.text ?? "")}
            maxLength={2500}
            disabled={disabled}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </label>
      );
    case "image":
    case "video":
    case "file":
      return (
        <>
          <Pick
            filter={block.type === "file" ? "pdf" : (block.type as AssetFilter)}
            assetId={String(block.assetId ?? "")}
            assets={assets}
            disabled={disabled}
            onPick={(a) => {
              onAsset(a);
              onChange({ assetId: a.id });
            }}
          />
          {block.type === "file"
            ? str("label", "Button label", { maxLength: 80 })
            : null}
          {block.type === "image" && str("alt", "Alternative text", { maxLength: 200 })}
          {block.type !== "file" && str("caption", "Caption", { maxLength: 200 })}
        </>
      );
    case "button":
      return (
        <>
          {str("label", "Button label", { maxLength: 60 })}
          {str("url", "Opens", {
            maxLength: 2000,
            placeholder: "https://, tel: or mailto:",
          })}
        </>
      );
    case "links": {
      const items = block.items as { label: string; url: string }[];
      const set = (i: number, patch: object) =>
        onChange({
          items: items.map((it, j) => (i === j ? { ...it, ...patch } : it)),
        });
      return (
        <>
          {items.map((it, i) => (
            <div className="xs-pair" key={i}>
              <input
                aria-label={`Link ${i + 1} label`}
                value={it.label}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => set(i, { label: e.target.value })}
              />
              <input
                aria-label={`Link ${i + 1} address`}
                value={it.url}
                maxLength={2000}
                disabled={disabled}
                onChange={(e) => set(i, { url: e.target.value })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove link ${i + 1}`}
                disabled={disabled || items.length < 2}
                onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || items.length >= 10}
            onClick={() =>
              onChange({ items: [...items, { label: "Link", url: "https://" }] })
            }
          >
            <Plus size={14} /> Add link
          </button>
        </>
      );
    }
    case "item":
      return (
        <>
          {str("title", "Heading", { maxLength: 80 })}
          <p className="hint">
            Shows each item&apos;s name, serial, warranty and service history. Add
            items in the Items tab.
          </p>
        </>
      );
    default: {
      const fields = block.fields as Field[];
      const set = (i: number, patch: Partial<Field>) =>
        onChange({
          fields: fields.map((f, j) => (i === j ? { ...f, ...patch } : f)),
        });
      return (
        <>
          {str("title", "Form title", { maxLength: 100 })}
          {str("intro", "Introduction", { maxLength: 300 })}
          <div className="xs-fields">
            {fields.map((f, i) => (
              <div className="xs-field" key={f.id}>
                <input
                  aria-label={`Question ${i + 1}`}
                  value={f.label}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => set(i, { label: e.target.value })}
                />
                <select
                  aria-label={`Answer type ${i + 1}`}
                  value={f.type}
                  disabled={disabled}
                  onChange={(e) =>
                    set(i, {
                      type: e.target.value as Field["type"],
                      options:
                        e.target.value === "choice" && f.options.length < 2
                          ? ["Yes", "No"]
                          : f.options,
                    })
                  }
                >
                  <option value="text">Short text</option>
                  <option value="textarea">Long text</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="choice">Choice</option>
                  <option value="rating">Rating 1–5</option>
                </select>
                <label className="xs-req">
                  <input
                    type="checkbox"
                    checked={f.required}
                    disabled={disabled}
                    onChange={(e) => set(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove question ${i + 1}`}
                  disabled={disabled || fields.length < 2}
                  onClick={() =>
                    onChange({ fields: fields.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 size={14} />
                </button>
                {f.type === "choice" && (
                  <input
                    className="xs-wide"
                    aria-label={`Options for question ${i + 1}`}
                    value={f.options.join(", ")}
                    placeholder="Options, separated by commas"
                    disabled={disabled}
                    onChange={(e) =>
                      set(i, {
                        options: e.target.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean)
                          .slice(0, 8),
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || fields.length >= 8}
            onClick={() =>
              onChange({
                fields: [
                  ...fields,
                  {
                    id: "q" + Math.random().toString(36).slice(2, 6),
                    label: "Question",
                    type: "text",
                    required: false,
                    options: [],
                  },
                ],
              })
            }
          >
            <Plus size={14} /> Add question
          </button>
          {str("submitLabel", "Button text", { maxLength: 40 })}
          {str("successMessage", "Thank-you message", { maxLength: 300 })}
        </>
      );
    }
  }
}

export default function ExperienceStudio({
  code,
  role,
  onClose,
  onPublished,
}: {
  code: Code;
  role?: Role;
  onClose: () => void;
  onPublished: () => void;
}) {
  const editable = mayEdit(role);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<
    "build" | "items" | "responses" | "results" | "history"
  >(
    "build",
  );
  const [open, setOpen] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<{
    available: boolean;
    emails: string;
  } | null>(null);
  const [alertNote, setAlertNote] = useState("");
  const [zone, setZone] = useState("UTC");
  const [previewAt, setPreviewAt] = useState("");
  const edited = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const path = `/codes/${code.id}/experience`;

  useEffect(() => {
    api<Draft>(`${path}/draft`)
      .then(setDraft)
      .catch((e) => setError((e as Error).message));
    api<Asset[]>("/assets").then(setAssets).catch(() => {});
    api<{ timeZone: string }>(`${path}/settings`)
      .then((s) => setZone(s.timeZone))
      .catch(() => {});
  }, [path]);

  useEffect(() => {
    if (tab === "history") api<Version[]>(`${path}/versions`).then(setVersions).catch(() => {});
    if (tab === "responses") {
      api<Submission[]>(`${path}/submissions`).then(setSubs).catch(() => {});
      api<{ available: boolean; emails: string[] }>(`${path}/alerts`)
        .then((a) => setAlerts({ available: a.available, emails: a.emails.join(", ") }))
        .catch(() => {});
      if (editable) api(`${path}/submissions/read`, {}).catch(() => {});
    }
    if (tab === "results") api<Stats>(`${path}/stats`).then(setStats).catch(() => {});
  }, [tab, path, editable]);

  // Autosave the draft shortly after the last change.
  useEffect(() => {
    if (!draft || !edited.current || !editable) return;
    setState("saving");
    const timer = (pending.current = setTimeout(async () => {
      try {
        await api(
          `${path}/draft`,
          { title: draft.title, blocks: draft.blocks },
          "PUT",
        );
        setState("saved");
      } catch (e) {
        setState("failed");
        setError((e as Error).message);
      }
    }, 800));
    return () => clearTimeout(timer);
  }, [draft?.title, draft?.blocks, editable, path]);

  const change = (patch: Partial<Draft>) => {
    edited.current = true;
    setError("");
    setDraft((d) => (d ? { ...d, dirty: true, ...patch } : d));
  };
  const setBlocks = (blocks: Block[]) => change({ blocks });
  const patchBlock = (id: string, patch: Partial<Block>) =>
    setBlocks(draft!.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (i: number, by: number) => {
    const next = [...draft!.blocks];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setBlocks(next);
  };
  const addBlock = (type: string) => {
    const block = blank(type);
    setBlocks([...draft!.blocks, block]);
    setOpen(block.id);
  };
  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setError("");
    if (pending.current) clearTimeout(pending.current);
    try {
      await api(`${path}/draft`, { title: draft.title, blocks: draft.blocks }, "PUT");
      await api(`${path}/publish`, { note });
      setNote("");
      edited.current = false;
      setDraft({ ...draft, dirty: false });
      setState("idle");
      onPublished();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }
  async function restore(version: number) {
    try {
      const d = await api<Draft>(`${path}/versions/${version}/restore`, {});
      edited.current = false;
      setDraft(d);
      setTab("build");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function discard() {
    try {
      await api(`${path}/draft`, undefined, "DELETE");
      setDraft(await api<Draft>(`${path}/draft`));
      edited.current = false;
      setState("idle");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveZone(value: string) {
    setZone(value);
    try {
      await api(`${path}/settings`, { timeZone: value }, "PUT");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveAlerts() {
    if (!alerts) return;
    setAlertNote("");
    try {
      const r = await api<{ emails: string[] }>(
        `${path}/alerts`,
        {
          emails: alerts.emails
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean),
        },
        "PUT",
      );
      setAlerts({ ...alerts, emails: r.emails.join(", ") });
      setAlertNote(r.emails.length ? "Alerts saved." : "Alerts turned off.");
    } catch (e) {
      setAlertNote((e as Error).message);
    }
  }
  async function remove(id: number) {
    await api(`${path}/submissions/${id}`, undefined, "DELETE");
    setSubs((list) => list.filter((s) => s.id !== id));
  }

  const tabs = [
    ["build", "Build", Type],
    ["items", "Items", Package],
    ["responses", "Responses", Inbox],
    ["results", "Results", BarChart3],
    ["history", "History", History],
  ] as const;

  return (
    <Modal wide title={`Experience Studio · ${code.name}`} onClose={onClose}>
      <div className="xs">
        <div className="xs-bar">
          <div className="xs-tabs" role="tablist">
            {tabs.map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "on" : ""}
                onClick={() => setTab(key)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="xs-status" aria-live="polite">
            {state === "saving" && (
              <>
                <Loader2 size={13} className="spin" /> Saving draft…
              </>
            )}
            {state === "saved" && "Draft saved"}
            {state === "idle" && draft?.dirty && "Unpublished changes"}
            {state === "idle" && draft && !draft.dirty && "Live"}
          </div>
        </div>

        {tab === "build" && draft && (
          <div className="xs-build">
            <div className="xs-editor">
              <label>
                Page title
                <input
                  value={draft.title}
                  maxLength={100}
                  disabled={!editable}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <div className="xs-time">
                <label>
                  Page time zone
                  <input
                    list="xs-zones"
                    value={zone}
                    disabled={!editable}
                    onChange={(e) => {
                      setZone(e.target.value);
                      // A full zone name saves at once, so picking from the list is enough.
                      if (editable && zoneNames.includes(e.target.value))
                        saveZone(e.target.value);
                    }}
                    onBlur={(e) => editable && saveZone(e.target.value)}
                  />
                  <datalist id="xs-zones">
                    {zoneNames.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Preview as
                  <input
                    type="datetime-local"
                    value={previewAt}
                    onChange={(e) => setPreviewAt(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!previewAt}
                  onClick={() => setPreviewAt("")}
                >
                  Now
                </button>
              </div>
              <ol className="xs-blocks">
                {draft.blocks.map((b, i) => (
                  <li key={b.id} className={open === b.id ? "open" : ""}>
                    <div className="xs-head">
                      <button
                        type="button"
                        className="xs-toggle"
                        aria-expanded={open === b.id}
                        onClick={() => setOpen(open === b.id ? null : b.id)}
                      >
                        <span>{blockName[b.type] || b.type}</span>
                        <em>
                          {b.when ? "⏱ " : ""}
                          {summary(b)}
                        </em>
                      </button>
                      {editable && (
                        <span className="xs-tools">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Move up"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Move down"
                            disabled={i === draft.blocks.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Remove block"
                            onClick={() =>
                              setBlocks(draft.blocks.filter((x) => x.id !== b.id))
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </div>
                    {open === b.id && (
                      <div className="xs-body">
                        <FieldEditor
                          block={b}
                          assets={assets}
                          disabled={!editable}
                          onChange={(patch) => patchBlock(b.id, patch)}
                          onAsset={(a) =>
                            setAssets((list) =>
                              list.some((x) => x.id === a.id) ? list : [...list, a],
                            )
                          }
                        />
                        <RuleEditor
                          when={b.when as When | undefined}
                          disabled={!editable}
                          onChange={(when) => patchBlock(b.id, { when })}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {editable && draft.blocks.length < 30 && (
                <div className="xs-add">
                  <span className="small-label">ADD A BLOCK</span>
                  <div>
                    {palette.map(([key, label, Icon]) => (
                      <button
                        type="button"
                        key={key}
                        className="button secondary small"
                        onClick={() => addBlock(key)}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <aside className="xs-side">
              <PhoneFrame
                title={draft.title}
                blocks={draft.blocks}
                options={code.pageOptions}
                timeZone={zone}
                at={previewAt ? zonedIso(previewAt, zone) : undefined}
              />
              <p className="hint">
                Visitors keep seeing the published version until you publish.
                The printed code never changes.
              </p>
            </aside>
          </div>
        )}

        {tab === "responses" && (
          <div className="xs-pane">
            <div className="xs-pane-head">
              <p>
                {subs.length
                  ? `${formatNumber(subs.length)} ${subs.length === 1 ? "response" : "responses"}`
                  : "Responses from your forms appear here."}{" "}
                They are deleted automatically after one year.
              </p>
              {subs.length > 0 && (
                <a
                  className="button secondary small"
                  href={`/api${path}/submissions.csv`}
                >
                  <Download size={14} /> Export CSV
                </a>
              )}
            </div>
            {alerts && (
              <div className="xs-alerts">
                <label>
                  Email me about new responses
                  <input
                    value={alerts.emails}
                    disabled={!editable || !alerts.available}
                    placeholder="you@example.com, up to three"
                    onChange={(e) =>
                      setAlerts({ ...alerts, emails: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!editable || !alerts.available}
                  onClick={saveAlerts}
                >
                  Save
                </button>
                <small className="hint">
                  {alerts.available
                    ? alertNote ||
                      "The email says a response arrived, never what it says. At most one every ten minutes."
                    : "Email is not set up on this server. Ask the administrator to set SMTP_URL."}
                </small>
              </div>
            )}
            <ul className="xs-list">
              {subs.map((s) => (
                <li key={s.id} className={s.read ? "" : "new"}>
                  <div>
                    <strong>
                      {s.form}
                      {s.item ? ` · ${s.item}` : ""}
                    </strong>
                    <time>{new Date(s.createdAt).toLocaleString()}</time>
                  </div>
                  <dl>
                    {Object.entries(s.answers).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {editable && (
                    <button
                      className="icon-button"
                      aria-label="Delete response"
                      onClick={() => remove(s.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "results" && (
          <div className="xs-pane">
            {stats ? (
              <>
                <div className="xs-metrics">
                  {[
                    ["Scans", stats.scans],
                    ["Actions taken", stats.submissions + stats.taps],
                    ["Form responses", stats.submissions],
                    [
                      "Action rate",
                      `${Math.round(stats.conversion * 100)}%`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <small>{String(label).toUpperCase()}</small>
                      <strong>
                        {typeof value === "number" ? formatNumber(value) : value}
                      </strong>
                    </div>
                  ))}
                </div>
                <h3 className="xs-h">What visitors did</h3>
                {stats.actions.length ? (
                  <ul className="xs-actions">
                    {stats.actions.map((a) => (
                      <li key={`${a.kind}${a.blockId}${a.label}`}>
                        <span>
                          {a.kind === "submit" ? "Submitted" : "Tapped"} {a.label}
                        </span>
                        <b>{formatNumber(a.count)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">
                    Taps on buttons and links, and form submissions, are counted
                    here once visitors start using the page.
                  </p>
                )}
              </>
            ) : (
              <Loader2 className="spin" />
            )}
          </div>
        )}

        {tab === "items" && (
          <ExperienceItems codeId={code.id} editable={editable} />
        )}

        {tab === "history" && (
          <div className="xs-pane">
            <ul className="xs-list">
              {versions.map((v) => (
                <li key={v.version}>
                  <div>
                    <strong>Version {v.version}</strong>
                    <time>{new Date(v.createdAt).toLocaleString()}</time>
                  </div>
                  <p>
                    {v.note || "No note"}
                    {v.author ? ` · ${v.author}` : ""}
                  </p>
                  {editable && (
                    <button
                      className="button secondary small"
                      onClick={() => restore(v.version)}
                    >
                      <RotateCcw size={13} /> Restore as draft
                    </button>
                  )}
                </li>
              ))}
              {!versions.length && (
                <p className="hint">
                  Every publish is kept here, so you can always go back.
                </p>
              )}
            </ul>
          </div>
        )}

        <div className="modal-footer xs-foot">
          {error && (
            <span role="alert" className="form-error">
              <AlertCircle size={13} /> {error}
            </span>
          )}
          {tab === "build" && editable && (
            <>
              {draft?.dirty && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={discard}
                  disabled={publishing}
                >
                  Discard changes
                </button>
              )}
              <input
                className="xs-note"
                aria-label="Version note"
                placeholder="Note for this version (optional)"
                value={note}
                maxLength={120}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="button primary"
                disabled={publishing || !draft?.dirty}
                onClick={publish}
              >
                {publishing ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Rocket size={16} />
                )}
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
