import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Loader2,
  Plus,
  QrCode,
  Smartphone,
  Sparkles,
  Trash2,
  WandSparkles,
  CalendarClock,
  ExternalLink,
} from "lucide-react";
import {
  api,
  codeContent,
  emptyCampaign,
  typeNames,
  type Code,
  type CodeType,
  type Folder,
  type DesignTemplate,
  type QRDesign,
  type Campaign,
  defaultPageOptions,
  isHosted,
  hasPublishingPage,
} from "../lib";
import { defaultDesign } from "../../shared/qr.js";
import Modal from "./Modal";
import QrImage from "./QrImage";
import DesignControls from "./Designer";
import { typeIcons, typeDescriptions } from "./codeTypes";
import PublishingFields, { PagePreview } from "./PublishingFields";
import { useDesignHistory } from "./useDesignHistory";
import type { StudioDraft } from "./StudioHero";
import LocalLinkNotice from "./LocalLinkNotice";

const localDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export default function Editor({
  code,
  folders,
  publicUrl,
  templates,
  initialDesign,
  initialFolder,
  initialDraft,
  onTemplates,
  onClose,
  onSave,
}: {
  code?: Code;
  folders: Folder[];
  publicUrl: string;
  templates: DesignTemplate[];
  initialDesign?: DesignTemplate;
  initialFolder?: string;
  initialDraft?: StudioDraft;
  onTemplates: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [step, setStep] = useState(0),
    [type, setType] = useState<CodeType>(
      code?.type || initialDraft?.type || "url",
    ),
    [dynamic, setDynamic] = useState(code?.dynamic ?? true),
    [name, setName] = useState(code?.name || "");
  const [preview, setPreview] = useState<"qr" | "page">(
    hasPublishingPage(code?.type || initialDraft?.type || "url")
      ? "page"
      : "qr",
  );
  const hasPagePreview = hasPublishingPage(type);
  const [data, setData] = useState<Record<string, string>>(
    code?.data || {
      security: "WPA",
      links: JSON.stringify([{ title: "", url: "" }]),
      ...(initialDraft?.type === "hosted-event"
        ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : {}),
      ...initialDraft?.data,
    },
  );
  const history = useDesignHistory({
    color:
      code?.color || initialDraft?.color || initialDesign?.color || "#163f32",
    design: { ...defaultDesign, ...(code?.design || initialDesign?.design) },
  });
  const { color, design } = history.current;
  const setColor = (color: string) => history.change({ color, design });
  const setDesign = (design: QRDesign) => history.change({ color, design });
  const [pageOptions, setPageOptions] = useState({
    ...defaultPageOptions,
    ...code?.pageOptions,
  });
  const [campaign, setCampaign] = useState<Campaign>({
    ...emptyCampaign,
    ...code?.campaign,
  });
  const [folderId, setFolderId] = useState(
      code?.folderId || initialFolder || "",
    ),
    [slug, setSlug] = useState(code?.slug || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const locked = !!code && !code.dynamic,
    isDynamic = isHosted(type) || (type === "url" && dynamic);
  const changeData = (key: string, value: string) =>
    setData((d) => ({ ...d, [key]: value }));
  const changeCampaign = <K extends keyof Campaign>(
    key: K,
    value: Campaign[K],
  ) => setCampaign((c) => ({ ...c, [key]: value }));
  const field = (
    key: string,
    title: string,
    placeholder: string,
    inputType = "text",
    required = false,
  ) => (
    <label key={key}>
      {title}
      <input
        type={inputType}
        value={
          inputType === "datetime-local"
            ? localDate(data[key])
            : data[key] || ""
        }
        onChange={(e) =>
          changeData(
            key,
            inputType === "datetime-local" && e.target.value
              ? new Date(e.target.value).toISOString()
              : e.target.value,
          )
        }
        placeholder={placeholder}
        disabled={locked}
        required={required}
        maxLength={1000}
      />
    </label>
  );
  let links: { title: string; url: string }[] = [];
  try {
    links = JSON.parse(data.links || "[]");
  } catch {
    /* The server rejects malformed stored pages. */
  }
  const updateLink = (index: number, key: "title" | "url", value: string) =>
    changeData(
      "links",
      JSON.stringify(
        links.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
      ),
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        code ? `/codes/${code.id}` : "/codes",
        {
          name,
          type,
          dynamic: isDynamic,
          data,
          color,
          design,
          pageOptions,
          campaign: isDynamic ? campaign : emptyCampaign,
          folderId: folderId || null,
          active: code?.active ?? true,
          ...(slug.trim() ? { slug: slug.trim() } : {}),
        },
        code ? "PUT" : "POST",
      );
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={
        code
          ? "Make this connection your own."
          : "Create something worth scanning."
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="advanced-editor">
        <div className="editor-steps">
          {[
            ["Content", Globe],
            ["Design", WandSparkles],
            ["Campaign", CalendarClock],
          ].map(([label, Icon], i) => {
            const StepIcon = Icon as typeof Globe;
            return (
              <button
                type="button"
                key={i}
                aria-current={step === i ? "step" : undefined}
                className={step === i ? "active" : step > i ? "complete" : ""}
                onClick={() => {
                  setStep(i);
                  if (i === 1) setPreview("qr");
                }}
              >
                <span>{step > i ? <Check size={13} /> : i + 1}</span>
                {String(label)}
                <StepIcon size={14} />
              </button>
            );
          })}
        </div>
        <div className="editor-layout">
          <div className="editor-fields">
            {step === 0 && (
              <>
                <div className="editor-section-label">
                  <Globe size={16} />
                  <span>WHAT WILL YOUR CODE OPEN?</span>
                </div>
                <div className="type-picker advanced-types">
                  {(Object.keys(typeNames) as CodeType[]).map((t) => {
                    const Icon = typeIcons[t];
                    return (
                      <button
                        type="button"
                        disabled={!!code}
                        key={t}
                        aria-pressed={type === t}
                        className={`type-option ${type === t ? "selected" : ""}`}
                        onClick={() => {
                          setType(t);
                          setPreview(hasPublishingPage(t) ? "page" : "qr");
                          setDynamic(t === "url" || isHosted(t));
                          if (t === "business") changeData("links", "[]");
                          changeData("mediaId", "");
                          if (t === "hosted-event" && !data.timeZone)
                            changeData(
                              "timeZone",
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                            );
                          setError("");
                        }}
                        title={typeDescriptions[t]}
                      >
                        <Icon size={18} />
                        {typeNames[t]}
                      </button>
                    );
                  })}
                </div>
                <p className="type-description">{typeDescriptions[type]}</p>
                <label>
                  Code name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Our summer collection"
                    required
                    maxLength={100}
                  />
                </label>
                {hasPublishingPage(type) && (
                  <PublishingFields
                    type={type}
                    data={data}
                    onData={changeData}
                    options={pageOptions}
                    onOptions={setPageOptions}
                    onApplyTemplate={(data, options) => {
                      setData(data);
                      setPageOptions(options);
                    }}
                    onDirectLink={
                      !code
                        ? (url) => {
                            setType("url");
                            setDynamic(false);
                            setData({ url });
                            setPreview("qr");
                            setError("");
                          }
                        : undefined
                    }
                  />
                )}
                {type === "url" && (
                  <>
                    {field(
                      "url",
                      "Website URL",
                      "https://your-website.com",
                      "url",
                      true,
                    )}
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={dynamic}
                        onChange={(e) => setDynamic(e.target.checked)}
                        disabled={!!code}
                      />
                      <span>
                        <strong>Dynamic link</strong>
                        <small>
                          Edit after printing. Track every connection.
                        </small>
                      </span>
                    </label>
                  </>
                )}
                {type === "text" && (
                  <label>
                    Your text
                    <textarea
                      value={data.text || ""}
                      onChange={(e) => changeData("text", e.target.value)}
                      required
                      maxLength={1200}
                      disabled={locked}
                      placeholder="A little hello…"
                    />
                  </label>
                )}
                {type === "wifi" && (
                  <>
                    {field("ssid", "Network name", "Guest Wi-Fi", "text", true)}
                    <label>
                      Security
                      <select
                        value={data.security || "WPA"}
                        onChange={(e) => changeData("security", e.target.value)}
                        disabled={locked}
                      >
                        <option value="WPA">WPA / WPA2 / WPA3</option>
                        <option value="WEP">WEP</option>
                        <option value="nopass">Open network</option>
                      </select>
                    </label>
                    {data.security !== "nopass" &&
                      field(
                        "password",
                        "Network password",
                        "Wi-Fi password",
                        "password",
                      )}
                  </>
                )}
                {type === "email" && (
                  <>
                    {field(
                      "email",
                      "Email address",
                      "hello@example.com",
                      "email",
                      true,
                    )}
                    {field("subject", "Subject", "Let’s connect")}
                    {field("body", "Message", "Hello there!")}
                  </>
                )}
                {["phone", "sms", "whatsapp"].includes(type) && (
                  <>
                    {field(
                      "phone",
                      type === "whatsapp" ? "WhatsApp number" : "Phone number",
                      "+1 555 123 4567",
                      "tel",
                      true,
                    )}
                    {type !== "phone" &&
                      field(
                        "message",
                        "Prefilled message",
                        "Hi! I’d love to know more.",
                      )}
                  </>
                )}
                {type === "vcard" && (
                  <>
                    {field(
                      "fullName",
                      "Full name",
                      "Alex Morgan",
                      "text",
                      true,
                    )}
                    {field("company", "Organization", "Your company")}
                    {field("phone", "Phone", "+1 555 123 4567", "tel")}
                    {field("email", "Email", "alex@example.com", "email")}
                  </>
                )}
                {type === "location" && (
                  <div className="field-pair">
                    {field("latitude", "Latitude", "28.6139", "text", true)}
                    {field("longitude", "Longitude", "77.2090", "text", true)}
                  </div>
                )}
                {type === "event" && (
                  <>
                    {field(
                      "title",
                      "Event title",
                      "A day to remember",
                      "text",
                      true,
                    )}
                    <div className="field-pair">
                      {field(
                        "startsAt",
                        "Starts at",
                        "",
                        "datetime-local",
                        true,
                      )}
                      {field("endsAt", "Ends at", "", "datetime-local", true)}
                    </div>
                    {field("location", "Event location", "Where we’ll meet")}
                    {field(
                      "description",
                      "Description",
                      "What to look forward to",
                    )}
                  </>
                )}
                {type === "links" && (
                  <>
                    {field(
                      "title",
                      "Page title",
                      "Hello, we’re Studio North",
                      "text",
                      true,
                    )}
                    <label>
                      About this page
                      <textarea
                        value={data.description || ""}
                        onChange={(e) =>
                          changeData("description", e.target.value)
                        }
                        placeholder="A little about you and your world."
                        maxLength={500}
                      />
                    </label>
                    <div className="link-builder-heading">
                      <strong>Your links</strong>
                      <span>{links.length}/12</span>
                    </div>
                    {links.map((link, i) => (
                      <div className="link-builder-row" key={i}>
                        <span>{i + 1}</span>
                        <div>
                          <input
                            aria-label={`Link ${i + 1} title`}
                            value={link.title}
                            onChange={(e) =>
                              updateLink(i, "title", e.target.value)
                            }
                            placeholder="Link title"
                            required
                            maxLength={80}
                          />
                          <input
                            type="url"
                            aria-label={`Link ${i + 1} URL`}
                            value={link.url}
                            onChange={(e) =>
                              updateLink(i, "url", e.target.value)
                            }
                            placeholder="https://example.com"
                            required
                            maxLength={2000}
                          />
                        </div>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove link ${i + 1}`}
                          disabled={links.length === 1}
                          onClick={() =>
                            changeData(
                              "links",
                              JSON.stringify(links.filter((_, j) => i !== j)),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={links.length >= 12}
                      onClick={() =>
                        changeData(
                          "links",
                          JSON.stringify([...links, { title: "", url: "" }]),
                        )
                      }
                    >
                      <Plus size={14} />
                      Add a link
                    </button>
                    <p className="hint">
                      Your mobile page is hosted on your server and can be
                      edited any time.
                    </p>
                  </>
                )}
                {locked && (
                  <p className="hint">
                    Static content stays permanent. The design, name, and folder
                    can still change.
                  </p>
                )}
              </>
            )}
            {step === 1 && (
              <DesignControls
                color={color}
                design={design}
                onColor={setColor}
                onDesign={setDesign}
                templates={templates}
                onTemplates={onTemplates}
                onApply={history.change}
                onUndo={history.undo}
                onRedo={history.redo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
              />
            )}{" "}
            {step === 2 && (
              <>
                {isDynamic && <LocalLinkNotice url={publicUrl} />}
                <div className="editor-section-label">
                  <CalendarClock size={16} />
                  <span>READY FOR THE REAL WORLD</span>
                </div>
                <label>
                  Keep it in a folder
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {isDynamic ? (
                  <>
                    <label>
                      Custom short link{" "}
                      <span className="optional">optional</span>
                      <div className="slug-field">
                        <span>/r/</span>
                        <input
                          value={slug}
                          onChange={(e) => setSlug(e.target.value)}
                          placeholder="summer-launch"
                          minLength={3}
                          maxLength={60}
                          pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,59}"
                          disabled={!!code}
                        />
                      </div>
                      <small className="hint">
                        {code
                          ? "The printed link stays permanent."
                          : "Leave blank for an automatically generated link."}
                      </small>
                    </label>
                    <div className="field-pair">
                      <label>
                        Activates at
                        <input
                          type="datetime-local"
                          value={localDate(campaign.startsAt)}
                          onChange={(e) =>
                            changeCampaign(
                              "startsAt",
                              e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            )
                          }
                        />
                      </label>
                      <label>
                        Expires at
                        <input
                          type="datetime-local"
                          value={localDate(campaign.expiresAt)}
                          onChange={(e) =>
                            changeCampaign(
                              "expiresAt",
                              e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            )
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Maximum scans <span className="optional">optional</span>
                      <input
                        type="number"
                        min={1}
                        max={100000000}
                        value={campaign.scanLimit || ""}
                        onChange={(e) =>
                          changeCampaign(
                            "scanLimit",
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                        placeholder="Unlimited"
                      />
                    </label>
                    <p className="hint">
                      Dates use your local time zone. A scan limit counts all
                      successful visits to this link, including clicks and bots.
                    </p>
                    {type === "url" && (
                      <div className="utm-builder">
                        <div className="editor-section-label">
                          <Sparkles size={15} />
                          <span>KNOW WHAT BRINGS THEM HERE</span>
                        </div>
                        <p>Add UTM tags for your website’s analytics.</p>
                        {(
                          ["utmSource", "utmMedium", "utmCampaign"] as const
                        ).map((key, i) => (
                          <label key={key}>
                            {["Source", "Medium", "Campaign"][i]}
                            <input
                              value={campaign[key]}
                              onChange={(e) =>
                                changeCampaign(key, e.target.value)
                              }
                              placeholder={
                                ["poster", "qr-code", "summer-launch"][i]
                              }
                              maxLength={200}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="preview-tip">
                    <Sparkles size={18} />
                    <p>
                      Static codes work independently of your server. Choose a
                      dynamic website code for scheduling, scan limits, and
                      analytics.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <aside className="editor-preview">
            {hasPagePreview && (
              <div className="preview-switch segmented">
                <button
                  type="button"
                  className={preview === "qr" ? "active" : ""}
                  onClick={() => setPreview("qr")}
                >
                  QR code
                </button>
                <button
                  type="button"
                  className={preview === "page" ? "active" : ""}
                  onClick={() => setPreview("page")}
                >
                  Landing page
                </button>
              </div>
            )}
            {(!hasPagePreview || preview === "qr") && (
              <>
                <span className="small-label">
                  YOUR CONNECTION, TAKING SHAPE
                </span>
                <div className="preview-paper">
                  <QrImage
                    size={224}
                    content={codeContent({
                      type,
                      data,
                      dynamic: isDynamic,
                      shortUrl:
                        code?.shortUrl || `${publicUrl}/r/${slug || "preview"}`,
                    })}
                    color={color}
                    design={design}
                  />
                  <span>{name || "Something wonderful"}</span>
                </div>
                <span className="preview-caption">
                  <Smartphone size={15} />
                  Made for the moment someone scans.
                </span>
              </>
            )}
            {type === "links" && (
              <div className="landing-mini-preview">
                <span style={{ background: color }}>
                  {(data.title || "YOU").slice(0, 2).toUpperCase()}
                </span>
                <strong>{data.title || "Your page title"}</strong>
                <p>{data.description || "Your corner of the internet."}</p>
                {links.slice(0, 3).map((l, i) => (
                  <div key={i}>
                    {l.title || `Your link ${i + 1}`}
                    <ExternalLink size={10} />
                  </div>
                ))}
              </div>
            )}
            {hasPagePreview && preview === "page" && (
              <PagePreview type={type} data={data} options={pageOptions} />
            )}
            <div className="preview-tip">
              <Sparkles size={18} />
              <p>
                {isDynamic
                  ? "Print it once. Change the experience whenever you need to."
                  : "A connection that works even when your server is offline."}
              </p>
            </div>
            {!code && isDynamic && (
              <p className="hint">
                Save first, then download. The final tracking link is assigned
                when you create your code.
              </p>
            )}
            <div className="quality-note">
              <Check size={13} />
              <span>High error correction · 4-module quiet zone</span>
            </div>
          </aside>
        </div>
        <div className="modal-footer">
          {error && (
            <span role="alert" className="form-error">
              {error}
            </span>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
          >
            {step ? (
              <>
                <ArrowLeft size={15} />
                Back
              </>
            ) : (
              "Cancel"
            )}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : step < 2 ? (
              <>
                Continue
                <ArrowRight size={16} />
              </>
            ) : (
              <>
                <QrCode size={17} />
                {code ? "Save changes" : "Create QR code"}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
