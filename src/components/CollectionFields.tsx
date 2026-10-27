import { useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  GripVertical,
  ImagePlus,
  Music,
  Video,
  Trash2,
  CalendarDays,
  Smartphone,
} from "lucide-react";
import { type Asset, type CodeType } from "../lib";
import { AssetPicker } from "./MediaLibrary";
import { appDestination } from "../../shared/app-routing.js";
type Props = {
  type: CodeType;
  data: Record<string, string>;
  onData: (key: string, value: string) => void;
  assets: Asset[];
};
type Item = { assetId: string; caption: string; alt: string };
const localDate = (s?: string) => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isFinite(+d)
    ? new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";
};
export default function CollectionFields({
  type,
  data,
  onData,
  assets,
}: Props) {
  const [picker, setPicker] = useState(false),
    [drag, setDrag] = useState<number | null>(null),
    [device, setDevice] = useState("desktop"),
    [error, setError] = useState("");
  let items: Item[] = [];
  try {
    items = JSON.parse(data.items || "[]");
  } catch {}
  const changeItem = (i: number, key: "caption" | "alt", value: string) =>
    onData(
      "items",
      JSON.stringify(
        items.map((item, j) => (i === j ? { ...item, [key]: value } : item)),
      ),
    );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items],
      item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    onData("items", JSON.stringify(next));
  };
  const field = (
    key: string,
    label: string,
    required = false,
    placeholder = "",
    inputType = "text",
  ) => (
    <label key={key}>
      {label}
      <input
        type={inputType}
        maxLength={inputType === "url" ? 2000 : key === "address" ? 300 : 200}
        required={required}
        value={data[key] || ""}
        placeholder={placeholder}
        onChange={(e) => onData(key, e.target.value)}
      />
    </label>
  );
  const asset = assets.find((a) => a.id === data.mediaId);
  return (
    <div className="collection-fields">
      {type === "gallery" && (
        <>
          <div className="gallery-editor-heading">
            <span className="editor-section-label">
              YOUR COLLECTION · {items.length}/24
            </span>
            <button
              type="button"
              className="button secondary small"
              disabled={items.length >= 24}
              onClick={() => setPicker(true)}
            >
              <ImagePlus size={15} />
              Add images
            </button>
          </div>
          <p className="hint">
            Drag images to reorder, or use the arrow buttons. Add captions and
            descriptive alternative text.
          </p>
          <div className="gallery-editor-list">
            {items.map((item, i) => {
              const image = assets.find((a) => a.id === item.assetId);
              return (
                <div
                  className={`gallery-editor-item ${drag === i ? "dragging" : ""}`}
                  key={`${item.assetId}-${i}`}
                  draggable
                  onDragStart={(e) => {
                    setDrag(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                  }}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag !== null) move(drag, i);
                    setDrag(null);
                  }}
                >
                  <div className="gallery-image-row">
                    <GripVertical size={15} />
                    {image && (
                      <img src={image.url} alt={item.alt || image.name} />
                    )}
                    <strong>Image {i + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={i === 0}
                      aria-label={`Move image ${i + 1} up`}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={i === items.length - 1}
                      aria-label={`Move image ${i + 1} down`}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() =>
                        onData(
                          "items",
                          JSON.stringify(items.filter((_, j) => i !== j)),
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <label>
                    Caption
                    <input
                      aria-label={`Image ${i + 1} caption`}
                      value={item.caption}
                      maxLength={200}
                      onChange={(e) => changeItem(i, "caption", e.target.value)}
                    />
                  </label>
                  <label>
                    Alternative text
                    <input
                      aria-label={`Image ${i + 1} alternative text`}
                      value={item.alt}
                      maxLength={200}
                      onChange={(e) => changeItem(i, "alt", e.target.value)}
                      placeholder="Describe this image for someone who cannot see it."
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
      {["audio", "video"].includes(type) && (
        <>
          <button
            type="button"
            className="media-choice"
            onClick={() => setPicker(true)}
          >
            {type === "audio" ? <Music size={24} /> : <Video size={24} />}
            <span>
              <strong>{asset?.name || `Choose your ${type}`}</strong>
              <small>
                {asset
                  ? `${Math.round(asset.size / 1024)} KB · Change file`
                  : type === "audio"
                    ? "MP3 audio from your library"
                    : "MP4 (H.264/AV1) or WebM video"}
              </small>
            </span>
          </button>
          {asset && (
            <div className="editor-media-player">
              {type === "audio" ? (
                <audio controls preload="metadata" src={asset.url} />
              ) : (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={asset.url}
                />
              )}
            </div>
          )}
          <p className="hint">
            Playback support depends on the device’s codecs. Replace the media
            file anytime without reprinting the QR.
          </p>
        </>
      )}
      {["gallery", "audio", "video"].includes(type) && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={data.allowDownload === "true"}
            onChange={(e) => onData("allowDownload", String(e.target.checked))}
          />
          <span>
            <strong>Show download buttons</strong>
            <small>
              Visitors can save a copy. Hiding the button does not prevent
              saving playable media.
            </small>
          </span>
        </label>
      )}
      {type === "hosted-event" && (
        <>
          <div className="field-pair">
            {(["startsAt", "endsAt"] as const).map((key, i) => (
              <label key={key}>
                {i ? "Ends at" : "Starts at"}
                <input
                  type="datetime-local"
                  required
                  value={localDate(data[key])}
                  onChange={(e) =>
                    onData(
                      key,
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    )
                  }
                />
              </label>
            ))}
          </div>
          <p className="hint">
            Enter dates in your browser’s local time. The page displays them in
            the time zone below.
          </p>
          {field(
            "timeZone",
            "Display time zone",
            true,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          )}
          {field("venue", "Venue name", false, "The Little Studio")}
          {field("address", "Venue address", false, "Street, city, country")}
          {field(
            "registrationUrl",
            "Registration link",
            false,
            "https://…",
            "url",
          )}
          {field(
            "registrationLabel",
            "Registration button label",
            false,
            "Register for this event",
          )}
          <div className="preview-tip">
            <CalendarDays size={18} />
            <p>
              Visitors can save the event to their calendar. The calendar entry
              keeps its identity when you update the event.
            </p>
          </div>
        </>
      )}
      {type === "app" && (
        <>
          {field(
            "iosUrl",
            "Apple App Store URL",
            false,
            "https://apps.apple.com/…",
            "url",
          )}
          {field(
            "androidUrl",
            "Google Play URL",
            false,
            "https://play.google.com/store/apps/details?id=…",
            "url",
          )}
          {field(
            "fallbackUrl",
            "Website fallback",
            true,
            "https://your-app.com",
            "url",
          )}
          <label>
            When someone scans
            <select
              value={data.routing || "landing"}
              onChange={(e) => onData("routing", e.target.value)}
            >
              <option value="landing">Show a page with store buttons</option>
              <option value="smart">Automatically route by device</option>
            </select>
          </label>
          <div className="routing-tester">
            <span className="editor-section-label">
              <Smartphone size={15} />
              TEST YOUR ROUTING
            </span>
            <div className="segmented">
              {["ios", "android", "desktop"].map((d) => (
                <button
                  type="button"
                  key={d}
                  className={device === d ? "active" : ""}
                  onClick={() => setDevice(d)}
                >
                  {d === "ios"
                    ? "iPhone / iPad"
                    : d === "android"
                      ? "Android"
                      : "Desktop"}
                </button>
              ))}
            </div>
            <p>
              {data.routing === "smart"
                ? appDestination(
                    data,
                    device === "ios"
                      ? "iPhone"
                      : device === "android"
                        ? "Android"
                        : "Desktop",
                  ) || "Add a website fallback."
                : "Visitors see the landing page and choose their store."}
            </p>
            <small>
              Missing device-specific links use the website fallback. Device
              detection uses the browser’s user agent.
            </small>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {picker && (
        <AssetPicker
          filter={
            type === "gallery" ? "image" : type === "audio" ? "audio" : "video"
          }
          multiple={type === "gallery"}
          onClose={() => setPicker(false)}
          onSelect={(a) => {
            onData("mediaId", a.id);
            setError("");
          }}
          onSelectMany={(selected) => {
            const known = new Set(items.map((i) => i.assetId)),
              added = selected.filter((a) => !known.has(a.id));
            if (items.length + added.length > 24) {
              setError("Use at most 24 images in a gallery.");
              return;
            }
            onData(
              "items",
              JSON.stringify([
                ...items,
                ...added.map((a) => ({ assetId: a.id, caption: "", alt: "" })),
              ]),
            );
            setError("");
          }}
        />
      )}
    </div>
  );
}
export function CollectionPreview({
  type,
  data,
  assets,
}: Omit<Props, "onData">) {
  const asset = assets.find((a) => a.id === data.mediaId);
  let items: Item[] = [];
  try {
    items = JSON.parse(data.items || "[]");
  } catch {}
  if (type === "gallery")
    return (
      <div className="phone-gallery">
        {items.slice(0, 6).map((item, i) => {
          const a = assets.find((a) => a.id === item.assetId);
          return a ? (
            <figure key={i}>
              <img src={a.url} alt={item.alt || a.name} />
              {item.caption && <figcaption>{item.caption}</figcaption>}
            </figure>
          ) : null;
        })}
        {!items.length && <span>Add images to build your collection.</span>}
      </div>
    );
  if (type === "audio" || type === "video")
    return (
      <div className="phone-media">
        <span>{type === "audio" ? "♫" : "▶"}</span>
        <strong>{asset?.name || `Your ${type} goes here`}</strong>
        <div className="phone-player-track" />
        <small>Playback controls on the published page</small>
        {data.allowDownload === "true" && (
          <div className="phone-action">Download {type} ↓</div>
        )}
      </div>
    );
  if (type === "hosted-event") {
    let date = "Add your event dates";
    try {
      if (data.startsAt)
        date = new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: data.timeZone || "UTC",
        }).format(new Date(data.startsAt));
    } catch {}
    return (
      <div className="phone-event">
        <CalendarDays size={21} />
        <strong>{date}</strong>
        <small>{data.timeZone || "UTC"}</small>
        <p>{[data.venue, data.address].filter(Boolean).join(" · ")}</p>
        <div className="phone-action">Add to calendar ↓</div>
        {data.registrationUrl && (
          <div className="phone-action">
            {data.registrationLabel || "Register for this event"} ↗
          </div>
        )}
      </div>
    );
  }
  if (type === "app")
    return (
      <>
        {data.iosUrl && (
          <div className="phone-action">Download on the App Store ↗</div>
        )}
        {data.androidUrl && (
          <div className="phone-action">Get it on Google Play ↗</div>
        )}
        <div className="phone-action">Visit our website ↗</div>
        {data.routing === "smart" && <small>Smart routing enabled</small>}
      </>
    );
  return null;
}
