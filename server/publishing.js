import { z } from "zod";
import { problem } from "./security.js";
export const hostedTypes = ["links", "pdf", "contact", "business", "social"];
export const pageOptionsSchema = z
  .object({
    theme: z.enum(["minimal", "soft", "bold"]).default("soft"),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#285b48"),
    showBrand: z.boolean().default(true),
  })
  .default({ theme: "soft", accent: "#285b48", showBrand: true });
export function safeWebsite(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw problem("Enter a complete HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw problem("Use an HTTP or HTTPS URL without credentials.");
  return url.href;
}
export function validateHosted(code) {
  const d = code.data;
  if (["contact", "business"].includes(code.type) && d.website)
    safeWebsite(d.website);
  if (!code.dynamic) throw problem("Use a dynamic code for a hosted page.");
  if (code.type === "contact") {
    if (!d.fullName?.trim() || d.fullName.length > 100)
      throw problem("Enter a contact name with at most 100 characters.");
    if (d.email && !z.email().safeParse(d.email).success)
      throw problem("Enter a valid email address.");
    if (d.phone && !/^\+?[\d ()-]{5,30}$/.test(d.phone))
      throw problem("Enter a valid phone number.");
    if (d.website) safeWebsite(d.website);
  } else if (!d.title?.trim() || d.title.length > 100)
    throw problem("Enter a page title with at most 100 characters.");
  if (d.description?.length > 1500 || d.address?.length > 300)
    throw problem("Use a shorter page description or address.");
  if (["business", "social"].includes(code.type) && d.links) {
    let links;
    try {
      links = JSON.parse(d.links);
    } catch {
      throw problem("Enter valid page links.");
    }
    if (!Array.isArray(links) || links.length > 12)
      throw problem("Use up to 12 page links.");
    for (const l of links) {
      if (
        !l ||
        typeof l.title !== "string" ||
        !l.title.trim() ||
        l.title.length > 80 ||
        typeof l.url !== "string" ||
        l.url.length > 2000
      )
        throw problem("Enter a title and URL for every page link.");
      safeWebsite(l.url);
      if (
        l.platform &&
        ![
          "website",
          "instagram",
          "facebook",
          "linkedin",
          "youtube",
          "tiktok",
          "x",
          "github",
        ].includes(l.platform)
      )
        throw problem("Choose a supported social platform.");
    }
  }
  if (code.type === "social" && (!d.links || JSON.parse(d.links).length === 0))
    throw problem("Add at least one social link.");
  if (code.type === "business") {
    if (d.email && !z.email().safeParse(d.email).success)
      throw problem("Enter a valid email address.");
    if (d.phone && !/^\+?[\d ()-]{5,30}$/.test(d.phone))
      throw problem("Enter a valid phone number.");
    if (d.hours) {
      let hours;
      try {
        hours = JSON.parse(d.hours);
      } catch {
        throw problem("Enter valid opening hours.");
      }
      if (!Array.isArray(hours) || hours.length !== 7)
        throw problem("Enter opening hours for seven days.");
      for (const day of hours)
        if (
          !day ||
          typeof day.closed !== "boolean" ||
          (!day.closed &&
            (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.open) ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.close) ||
              day.open >= day.close))
        )
          throw problem("Use opening hours with a closing time after opening.");
    }
  }
  if (code.type === "pdf" && !d.pdfId)
    throw problem("Choose a PDF for this page.");
  return "https://openqr.invalid/hosted-page";
}
