export type CodeType = "url" | "text" | "wifi" | "email" | "phone" | "vcard";
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
};
export type Folder = { id: string; name: string };
export type User = { id: string; name: string; email: string };
export type Analytics = {
  total: number;
  uniqueDailyVisitors: number;
  daily: { date: string; scans: number }[];
  devices: Record<string, number>;
  days: number;
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
  }
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
