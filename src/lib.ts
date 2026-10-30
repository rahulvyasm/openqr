import { calendarEvent } from "../shared/calendar.js";
import type { QRDesign } from "../shared/qr.js";
export type { QRDesign } from "../shared/qr.js";
export type CodeType =
  | "url"
  | "text"
  | "wifi"
  | "email"
  | "phone"
  | "vcard"
  | "sms"
  | "whatsapp"
  | "location"
  | "event"
  | "links"
  | "pdf"
  | "contact"
  | "business"
  | "social"
  | "gallery"
  | "audio"
  | "video"
  | "hosted-event"
  | "app"
  | "experience";
export type PageOptions = {
  theme: "minimal" | "soft" | "bold";
  accent: string;
  showBrand: boolean;
  layout: "card" | "editorial" | "compact";
  font: "modern" | "serif";
  corners: "rounded" | "square";
  buttonStyle: "outline" | "solid";
  galleryLayout: "grid" | "stack";
};
export const defaultPageOptions: PageOptions = {
  theme: "soft",
  accent: "#285b48",
  showBrand: true,
  layout: "card",
  font: "modern",
  corners: "rounded",
  buttonStyle: "outline",
  galleryLayout: "grid",
};
export const isHosted = (type: CodeType) =>
  [
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
  ].includes(type);
export const hasPublishingPage = (type: CodeType) =>
  isHosted(type) && type !== "links" && type !== "experience";
export type PageTemplate = {
  id: string;
  name: string;
  type: CodeType;
  data: Record<string, string>;
  pageOptions: PageOptions;
};
export type Asset = {
  id: string;
  name: string;
  kind: "pdf" | "image" | "logo" | "audio" | "video";
  mime: string;
  size: number;
  pages: number | null;
  createdAt: string;
  url: string;
  metadata: {
    duration?: number;
    width?: number;
    height?: number;
    codec?: string;
  };
};
export type Campaign = {
  startsAt: string | null;
  expiresAt: string | null;
  scanLimit: number | null;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};
export type DesignTemplate = {
  id: string;
  name: string;
  color: string;
  design: QRDesign;
};
export type Code = {
  id: string;
  slug: string;
  name: string;
  type: CodeType;
  dynamic: boolean;
  data: Record<string, string>;
  folderId: string | null;
  color: string;
  active: boolean;
  createdAt: string;
  scans: number;
  shortUrl: string;
  design: QRDesign;
  campaign: Campaign;
  pageOptions: PageOptions;
};
export type Folder = { id: string; name: string };
export type User = { id: string; name: string; email: string };
export type Role = "owner" | "admin" | "editor" | "viewer";
export type Workspace = {
  id: string;
  name: string;
  ownerId: string;
  role: Role;
};
export type AuthState = {
  operator?: boolean;
  operatorRole?: string | null;
  hosted?: boolean;
  setupRequired: boolean;
  user: User | null;
  publicUrl: string;
  workspace: Workspace | null;
  workspaces: Workspace[];
};
export type Member = User & { role: Role; joinedAt: string };
export const mayEdit = (role?: Role) =>
  ["owner", "admin", "editor"].includes(role || "");
export const mayManage = (role?: Role) =>
  ["owner", "admin"].includes(role || "");
export type Analytics = {
  total: number;
  uniqueDailyVisitors: number;
  daily: { date: string; scans: number }[];
  devices: Record<string, number>;
  days: number;
  browsers: Record<string, number>;
  operatingSystems: Record<string, number>;
  referrers: Record<string, number>;
  topCodes: { id: string; name: string; scans: number }[];
};
export async function api<T>(
  path: string,
  body?: unknown,
  method = "GET",
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? method : method === "GET" ? "POST" : method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 403)
      window.dispatchEvent(new Event("permissions-changed"));
    if (res.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
export const formatNumber = (n: number) => new Intl.NumberFormat().format(n);
export const typeNames: Record<CodeType, string> = {
  url: "Website",
  text: "Plain text",
  wifi: "Wi-Fi",
  email: "Email",
  phone: "Phone",
  vcard: "Contact card",
  sms: "SMS",
  whatsapp: "WhatsApp",
  location: "Location",
  event: "Event",
  links: "Link page",
  pdf: "PDF",
  contact: "Digital contact",
  business: "Business page",
  social: "Social media",
  gallery: "Image gallery",
  audio: "Audio",
  video: "Video",
  "hosted-event": "Event page",
  app: "App stores",
  experience: "Experience",
};
export function codeContent(
  code: Pick<Code, "type" | "data" | "dynamic" | "shortUrl">,
): string {
  if (code.dynamic) return code.shortUrl;
  const d = code.data;
  const esc = (s = "") =>
    s.replace(/([\\;,:])/g, "\\$1").replace(/\r?\n/g, "\\n");
  switch (code.type) {
    case "url":
      try {
        return new URL(d.url || "https://example.com").href;
      } catch {
        return d.url || "https://example.com/";
      }
    case "text":
      return d.text || "Your words go here";
    case "wifi":
      return `WIFI:T:${d.security || "WPA"};S:${esc(d.ssid)};P:${esc(d.password)};H:false;;`;
    case "email":
      return `mailto:${d.email || ""}?subject=${encodeURIComponent(d.subject || "")}&body=${encodeURIComponent(d.body || "")}`;
    case "phone":
      return `tel:${(d.phone || "").replace(/[ ()-]/g, "")}`;
    case "vcard":
      return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${esc(d.fullName)}\r\nORG:${esc(d.company)}\r\nTEL:${esc(d.phone)}\r\nEMAIL:${esc(d.email)}\r\nEND:VCARD`;
    case "sms":
      return `SMSTO:${(d.phone || "").replace(/[ ()-]/g, "")}:${d.message || ""}`;
    case "whatsapp":
      return `https://wa.me/${(d.phone || "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(d.message || "")}`;
    case "location":
      return `https://www.google.com/maps/search/?api=1&query=${Number(d.latitude || 0)},${Number(d.longitude || 0)}`;
    case "event": {
      const start = new Date(d.startsAt),
        end = new Date(d.endsAt);
      if (!Number.isFinite(+start) || !Number.isFinite(+end))
        return "Add your event details";
      return calendarEvent(d);
    }
    case "links":
    case "pdf":
    case "contact":
    case "business":
    case "social":
    case "gallery":
    case "audio":
    case "video":
    case "hosted-event":
    case "app":
    case "experience":
      return code.shortUrl;
  }
}

export const emptyCampaign: Campaign = {
  startsAt: null,
  expiresAt: null,
  scanLimit: null,
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
};
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadBatch(
  ids: string[],
  format: "svg" | "png" = "svg",
) {
  const res = await fetch("/api/codes/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, format }),
  });
  if (!res.ok)
    throw new Error(
      (await res.json()).error || "Could not prepare the download.",
    );
  saveBlob(await res.blob(), "openqr-codes.zip");
}
export function exportCsv(analytics: Analytics) {
  const blob = new Blob(
    [
      "date,scans\r\n" +
        analytics.daily.map((d) => `${d.date},${d.scans}`).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openqr-scan-analytics.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
