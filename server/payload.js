import { z } from "zod";

const text = (max = 1000) => z.string().trim().max(max);
export const codeSchema = z.object({
  name: text(100).min(1),
  type: z.enum(["url", "text", "wifi", "email", "phone", "vcard"]),
  dynamic: z.boolean().default(false),
  data: z.record(z.string(), z.string().max(2000)),
  folderId: z.string().nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#163f32"),
  active: z.boolean().default(true),
});
const escape = (s = "") =>
  s.replace(/([\\;,:])/g, "\\$1").replace(/\r?\n/g, "\\n");
export function payload(code) {
  const d = code.data;
  if (code.dynamic && code.type !== "url")
    throw new Error("Only website codes support dynamic links.");
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
  }
}
