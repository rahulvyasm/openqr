import { z } from "zod";
import { problem } from "./security.js";
import { safeWebsite } from "./publishing.js";
export const collectionTypes = [
  "gallery",
  "audio",
  "video",
  "hosted-event",
  "app",
];
export const galleryItems = z
  .array(
    z.object({
      assetId: z.string().uuid(),
      caption: z.string().max(200).default(""),
      alt: z.string().max(200).default(""),
    }),
  )
  .min(1)
  .max(24);
export function parseGallery(data) {
  try {
    return galleryItems.parse(JSON.parse(data.items || "[]"));
  } catch {
    throw problem(
      "Choose 1–24 images with captions and alternative text up to 200 characters.",
    );
  }
}
export function validateCollection(code) {
  const d = code.data;
  if (!code.dynamic) throw problem("Use a dynamic code for a hosted page.");
  if (!d.title?.trim() || d.title.length > 100)
    throw problem("Enter a page title with at most 100 characters.");
  if (d.description?.length > 1500)
    throw problem("Use a description with at most 1500 characters.");
  if (code.type === "gallery") parseGallery(d);
  if (["audio", "video"].includes(code.type) && !d.mediaId)
    throw problem("Choose a media file for this page.");
  if (d.allowDownload && !["true", "false"].includes(d.allowDownload))
    throw problem("Choose a valid download option.");
  if (code.type === "hosted-event") {
    if (
      !z.iso.datetime({ offset: true }).safeParse(d.startsAt).success ||
      !z.iso.datetime({ offset: true }).safeParse(d.endsAt).success ||
      new Date(d.endsAt) <= new Date(d.startsAt)
    )
      throw problem("Enter valid event dates with an end after the start.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: d.timeZone || "UTC" }).format();
    } catch {
      throw problem("Choose a valid event time zone.");
    }
    if (d.venue?.length > 200 || d.address?.length > 300)
      throw problem("Use a shorter venue or address.");
    if (d.registrationUrl) safeWebsite(d.registrationUrl);
  }
  if (code.type === "app") {
    for (const [key, host] of [
      ["iosUrl", "apps.apple.com"],
      ["androidUrl", "play.google.com"],
    ])
      if (d[key]) {
        const url = new URL(safeWebsite(d[key]));
        if (url.protocol !== "https:" || url.hostname !== host)
          throw problem(`Use an HTTPS ${host} store URL.`);
      }
    if (!d.iosUrl && !d.androidUrl)
      throw problem("Add at least one app-store link.");
    if (!d.fallbackUrl)
      throw problem("Enter a website fallback for app routing.");
    safeWebsite(d.fallbackUrl);
    if (d.routing && !["landing", "smart"].includes(d.routing))
      throw problem("Choose landing-page or smart app routing.");
  }
  return "https://openqr.invalid/hosted-page";
}
