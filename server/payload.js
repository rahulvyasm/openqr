import { calendarEvent } from "../shared/calendar.js";
import { z } from "zod";
import { designSchema } from "./design.js";
import {
  hostedTypes,
  pageOptionsSchema,
  validateHosted,
} from "./publishing.js";

const text = (max = 1000) => z.string().trim().max(max);
export const codeSchema = z.object({
  name: text(100).min(1),
  type: z.enum([
    "url",
    "text",
    "wifi",
    "email",
    "phone",
    "vcard",
    "sms",
    "whatsapp",
    "location",
    "event",
    "links",
    "pdf",
    "contact",
    "business",
    "social",
    "gallery",
    "audio",
    "video",
    "hosted-event",
    "app",
    "experience",
  ]),
  dynamic: z.boolean().default(false),
  data: z.record(z.string(), z.string().max(20000)),
  folderId: z.string().nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#163f32"),
  active: z.boolean().default(true),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,59}$/)
    .optional(),
  design: designSchema,
  pageOptions: pageOptionsSchema,
  campaign: z
    .object({
      startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
      expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
      scanLimit: z
        .number()
        .int()
        .min(1)
        .max(100000000)
        .nullable()
        .default(null),
      utmSource: text(200).default(""),
      utmMedium: text(200).default(""),
      utmCampaign: text(200).default(""),
    })
    .default({
      startsAt: null,
      expiresAt: null,
      scanLimit: null,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
    }),
});
const escape = (s = "") =>
  s.replace(/([\\;,:])/g, "\\$1").replace(/\r?\n/g, "\\n");
export function payload(code) {
  const d = code.data;
  if (code.dynamic && !["url", ...hostedTypes].includes(code.type))
    throw new Error(
      "Only website and hosted-page codes support dynamic links.",
    );
  if (hostedTypes.includes(code.type) && code.type !== "links")
    return validateHosted(code);
  if (code.type === "links" && !code.dynamic)
    throw new Error("Use a dynamic code for a hosted link page.");
  switch (code.type) {
    case "url": {
      let url;
      try {
        url = new URL(d.url);
      } catch {
        throw new Error("Enter a complete website URL, including https://.");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Use an HTTP or HTTPS URL without credentials.");
      return url.href;
    }
    case "text":
      if (!d.text?.trim()) throw new Error("Enter some text.");
      return d.text;
    case "wifi":
      if (!d.ssid?.trim()) throw new Error("Enter a network name.");
      if (!["WPA", "WEP", "nopass"].includes(d.security))
        throw new Error("Choose a supported network security type.");
      return `WIFI:T:${d.security};S:${escape(d.ssid)};P:${escape(d.password)};H:false;;`;
    case "email":
      if (!z.email().safeParse(d.email).success)
        throw new Error("Enter a valid email address.");
      return `mailto:${d.email}?subject=${encodeURIComponent(d.subject || "")}&body=${encodeURIComponent(d.body || "")}`;
    case "phone":
      if (!/^\+?[\d ()-]{5,30}$/.test(d.phone || ""))
        throw new Error("Enter a valid phone number.");
      return `tel:${d.phone.replace(/[ ()-]/g, "")}`;
    case "vcard":
      if (!d.fullName?.trim()) throw new Error("Enter a contact name.");
      return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${escape(d.fullName)}\r\nORG:${escape(d.company)}\r\nTEL:${escape(d.phone)}\r\nEMAIL:${escape(d.email)}\r\nEND:VCARD`;
    case "sms":
      if (!/^\+?[\d ()-]{5,30}$/.test(d.phone || ""))
        throw new Error("Enter a valid phone number.");
      return `SMSTO:${d.phone.replace(/[ ()-]/g, "")}:${d.message || ""}`;
    case "whatsapp":
      if (!/^\+?[\d ()-]{5,30}$/.test(d.phone || ""))
        throw new Error("Enter a valid WhatsApp number.");
      return `https://wa.me/${d.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(d.message || "")}`;
    case "location": {
      const lat = Number(d.latitude),
        lng = Number(d.longitude);
      if (
        !d.latitude?.trim() ||
        !d.longitude?.trim() ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        throw new Error("Enter a valid latitude and longitude.");
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    case "event": {
      const start = new Date(d.startsAt),
        end = new Date(d.endsAt);
      if (
        !d.title?.trim() ||
        !Number.isFinite(+start) ||
        !Number.isFinite(+end) ||
        end <= start
      )
        throw new Error(
          "Enter an event title and an end time after the start time.",
        );
      return calendarEvent(d);
    }
    case "links": {
      if (!d.title?.trim() || d.title.length > 100)
        throw new Error("Enter a page title with at most 100 characters.");
      let links;
      try {
        links = JSON.parse(d.links);
      } catch {
        throw new Error("Enter valid links for your page.");
      }
      if (!Array.isArray(links) || links.length < 1 || links.length > 12)
        throw new Error("Enter between 1 and 12 page links.");
      for (const link of links) {
        if (
          typeof link.title !== "string" ||
          !link.title.trim() ||
          link.title.length > 80 ||
          typeof link.url !== "string" ||
          link.url.length > 2000
        )
          throw new Error("Enter a title and URL for every page link.");
        payload({ type: "url", data: { url: link.url } });
      }
      return "https://openqr.invalid/link-page"; // Hosted pages encode their permanent tracking URL.
    }
  }
}

export function destination(code) {
  const url = new URL(payload(code));
  for (const [key, value] of [
    ["utm_source", code.campaign?.utmSource],
    ["utm_medium", code.campaign?.utmMedium],
    ["utm_campaign", code.campaign?.utmCampaign],
  ])
    if (value) url.searchParams.set(key, value);
  return url.href;
}
