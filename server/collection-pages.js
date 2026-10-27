import { xml } from "../shared/qr.js";
import { parseGallery } from "./collections.js";
export function collectionContent(code, assets, ticket, link, media) {
  const d = code.data;
  if (code.type === "gallery")
    return `<div class="photo-grid ${code.pageOptions?.galleryLayout === "stack" ? "stack" : ""}" id="gallery">${parseGallery(
      d,
    )
      .map((item, i) => {
        const asset = assets.find((a) => a.id === item.assetId);
        return `<figure><a href="#photo-${i}" aria-label="Open ${xml(item.alt || item.caption || asset?.name || "photo")}"><img loading="lazy" src="${media(item.assetId)}" alt="${xml(item.alt || item.caption || asset?.name || "Gallery image")}"></a>${item.caption ? `<figcaption>${xml(item.caption)}</figcaption>` : ""}</figure>`;
      })
      .join("")}</div>${parseGallery(d)
      .map(
        (item, i) =>
          `<div class="photo-lightbox" id="photo-${i}"><a href="#gallery" class="photo-close">Close ×</a><img loading="lazy" src="${media(item.assetId)}" alt="${xml(item.alt || item.caption || "Gallery image")}"><p>${xml(item.caption)}</p>${d.allowDownload === "true" ? `<a class="photo-download" href="${media(item.assetId)}&amp;download=1">Download image ↓</a>` : ""}</div>`,
      )
      .join("")}`;
  if (["audio", "video"].includes(code.type)) {
    const asset = assets.find((a) => a.id === d.mediaId),
      metadata = JSON.parse(asset?.metadata || "{}"),
      duration = metadata.duration
        ? `${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, "0")}`
        : "";
    const player =
      code.type === "video"
        ? `<video controls playsinline preload="metadata" ${d.coverId ? `poster="${media(d.coverId)}"` : ""}><source src="${media(d.mediaId)}" type="${xml(asset?.mime)}">Your browser cannot play this video.</video>`
        : `<div class="audio-art">♫</div><audio controls preload="metadata" src="${media(d.mediaId)}">Your browser cannot play this audio.</audio>`;
    return `<div class="media-player">${player}<small>${xml(asset?.name || "")} ${duration ? "· " + duration : ""}</small></div>${d.allowDownload === "true" ? `<div class="actions">${link("Download " + (code.type === "audio" ? "audio" : "video"), media(d.mediaId) + "&download=1")}</div>` : ""}`;
  }
  if (code.type === "hosted-event") {
    const zone = d.timeZone || "UTC",
      format = (value) =>
        new Intl.DateTimeFormat("en", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: zone,
        }).format(new Date(value)),
      ended = Date.now() > +new Date(d.endsAt);
    return `<section class="event-details"><span class="event-badge">${ended ? "Past event" : "Save the date"}</span><h2>When we’re getting together</h2><time datetime="${xml(d.startsAt)}">${xml(format(d.startsAt))}</time><span class="event-until">until</span><time datetime="${xml(d.endsAt)}">${xml(format(d.endsAt))}</time><small>${xml(zone)}</small>${d.venue || d.address ? `<h2 class="event-venue">Where to find us</h2><strong>${xml(d.venue || "")}</strong><p>${xml(d.address || "")}</p>` : ""}</section><div class="actions">${link("Add to calendar", `/r/${encodeURIComponent(code.slug)}/event.ics?ticket=${encodeURIComponent(ticket)}`)}${d.registrationUrl ? link(d.registrationLabel || "Register for this event", new URL(d.registrationUrl).href) : ""}${d.venue || d.address ? link("Get directions", `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.venue, d.address].filter(Boolean).join(", "))}`) : ""}</div>`;
  }
  if (code.type === "app")
    return `<div class="store-actions">${d.iosUrl ? link("Download on the App Store", new URL(d.iosUrl).href) : ""}${d.androidUrl ? link("Get it on Google Play", new URL(d.androidUrl).href) : ""}${link("Visit our website", new URL(d.fallbackUrl).href)}</div>`;
  return "";
}
export const collectionCss = `.photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:25px}.photo-grid.stack{grid-template-columns:1fr}.photo-grid figure{margin:0;min-width:0}.photo-grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;display:block}.photo-grid.stack img{aspect-ratio:auto;max-height:600px;object-fit:contain}.photo-grid figcaption{font-size:12px;text-align:left;margin:8px 0 12px;color:#7b8f6c;overflow-wrap:anywhere}.photo-lightbox{display:none}.photo-lightbox:target{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#152219f5;padding:70px 20px 30px;overflow:auto}.photo-lightbox img{max-width:100%;max-height:68vh;object-fit:contain}.photo-lightbox p{color:#d9e5ce;font-size:13px}.photo-close{position:absolute;top:24px;right:25px;color:white;text-decoration:none;font-size:16px}.photo-download{color:#e2ecd9;font-size:13px}.media-player{margin-top:25px}.media-player video{width:100%;max-height:520px;border-radius:12px;background:#18271d;display:block}.media-player audio{width:100%;display:block}.media-player small{font-size:11px;color:#94a286;display:block;margin-top:13px;overflow-wrap:anywhere}.audio-art{width:100px;height:100px;margin:0 auto 22px;background:#edf2e5;color:#567c40;border-radius:25px;font-size:45px;display:grid;place-items:center}.event-details time{display:block;font-size:14px;font-weight:600;line-height:1.8}.event-until{display:block;font-size:11px;color:#98a78c;margin:7px 0}.event-details small{display:block;margin-top:12px;color:#99a88b;font-size:11px}.event-badge{display:inline-block;background:#eef4e6;padding:4px 10px;border-radius:20px;font-size:10px;color:#6e8a57;margin-bottom:20px}.event-venue{margin-top:25px!important}.store-actions{display:grid;gap:12px;margin-top:27px}@media(max-width:420px){.photo-grid{gap:10px}.photo-grid figcaption{font-size:11px}}`;
