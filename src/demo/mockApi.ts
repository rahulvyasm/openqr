/* eslint-disable @typescript-eslint/no-explicit-any */
// An in-browser stand-in for the OpenQR server. The real screens run against it, so
// the demo always matches the product. Nothing is sent anywhere or saved.
import QRCode from "qrcode";
import { zipSync, strToU8 } from "fflate";
import { defaultDesign, renderSvg } from "../../shared/qr.js";
import { hostedPlans } from "../../shared/plans.js";
import {
  blockSchema,
  experienceSchema,
  parseBlocks,
  renderExperience,
  templates as starterTemplates,
  validateExperienceBlocks,
} from "../../server/experience-blocks.js";
import { demoHooks, saveBlob, type Asset } from "../lib";
import { svgToPng } from "./png";

type Row = Record<string, any>;
const DAY = 86400000;
const origin = () => location.origin;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const rid = () => Math.random().toString(36).slice(2, 10);
const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${rid()}${rid()}`.slice(0, 36);
const slugOf = () => Math.random().toString(36).slice(2, 10);

function rng(seedText: string) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- seed data
const user = { id: "u-demo", name: "Maya Rao", email: "maya@example.com" };
const workspace = {
  id: "w-demo",
  name: "Maya's workspace",
  ownerId: user.id,
  role: "owner",
};
const pageOptions = {
  theme: "soft",
  accent: "#285b48",
  showBrand: true,
  layout: "card",
  font: "modern",
  corners: "rounded",
  buttonStyle: "outline",
  galleryLayout: "grid",
};
const campaign = {
  startsAt: null,
  expiresAt: null,
  scanLimit: null,
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
};

function picture(label: string, a: string, b: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><circle cx="640" cy="130" r="90" fill="#ffffff22"/><text x="48" y="440" font-family="Georgia,serif" font-size="54" fill="#fff">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
const assets: Asset[] = [
  ["Kettle hero", "#285b48", "#d7fa70"],
  ["Café interior", "#7a3b1d", "#ff9f6b"],
  ["Event stage", "#1f2a6b", "#6bb7ff"],
].map(([name, a, b], i) => ({
  id: uuid(),
  name: `${name}.svg`,
  kind: "image" as const,
  mime: "image/svg+xml",
  size: 4200 + i * 300,
  pages: null,
  createdAt: iso(20 - i * 3),
  url: picture(name, a, b),
  metadata: { width: 800, height: 500 },
}));

const kettleBlocks = (() => {
  const tpl = starterTemplates().find((t: any) => t.id === "product")!;
  return tpl.blocks.map((b: any) =>
    b.type === "button"
      ? { ...b, label: "Read the setup guide", url: "https://example.com/guide" }
      : b.type === "heading"
        ? { ...b, text: "Meet the Aero kettle", subtext: "Everything you need, in one place." }
        : b,
  );
})();

const codes: Row[] = [];
const design = { ...defaultDesign };
function addCode(row: Row) {
  const id = row.id || uuid();
  const slug = row.slug || slugOf();
  const code = {
    id,
    slug,
    name: row.name,
    type: row.type,
    dynamic: !!row.dynamic,
    data: row.data || {},
    folderId: row.folderId ?? null,
    color: row.color || "#163f32",
    active: row.active ?? true,
    createdAt: row.createdAt || new Date().toISOString(),
    scans: row.scans || 0,
    shortUrl: `${origin()}/r/${slug}`,
    design: { ...design, ...(row.design || {}) },
    campaign: { ...campaign, ...(row.campaign || {}) },
    pageOptions: { ...pageOptions, ...(row.pageOptions || {}) },
  };
  codes.unshift(code);
  return code;
}
const folders: Row[] = [
  { id: "f-food", name: "Restaurant" },
  { id: "f-events", name: "Events" },
];
const designTemplates: Row[] = [
  {
    id: "dt-forest",
    name: "Forest ink",
    color: "#163f32",
    design: { ...design, module: "rounded", eye: "rounded", frame: "banner", caption: "SCAN ME" },
  },
  {
    id: "dt-berry",
    name: "Berry dots",
    color: "#7a1f4f",
    design: { ...design, module: "dots", eye: "soft-circle", frame: "pill", caption: "OPEN" },
  },
];

const kettle = addCode({
  name: "Aero kettle",
  type: "experience",
  dynamic: true,
  scans: 241,
  createdAt: iso(40),
  data: { title: "Meet the Aero kettle", blocks: JSON.stringify(kettleBlocks), timeZone: "Asia/Kolkata" },
});
const itemSeeds = [
  ["Aero #001", "SN-0001", "2027-06-30", 63],
  ["Aero #002", "SN-0002", "2027-06-30", 38],
  ["Aero #003", "SN-0003", "2026-01-15", 21],
];
const services = new Map<string, { id: number; date: string; note: string }[]>();
let serviceId = 1;
const itemCodes = itemSeeds.map(([name, serial, warrantyUntil, scans]) => {
  const c = addCode({
    name,
    type: "experience",
    dynamic: true,
    scans,
    createdAt: iso(30),
    data: { title: name, itemOf: kettle.id, serial, warrantyUntil },
  });
  return c;
});
services.set(itemCodes[0].id, [
  { id: serviceId++, date: "2026-02-10", note: "Replaced the filter" },
]);
services.set(itemCodes[2].id, [
  { id: serviceId++, date: "2025-11-02", note: "Descaled and tested" },
]);
addCode({
  name: "Summer menu",
  type: "url",
  dynamic: true,
  scans: 512,
  createdAt: iso(55),
  folderId: "f-food",
  color: "#7a3b1d",
  data: { url: "https://example.com/menu" },
});
addCode({
  name: "Studio North links",
  type: "links",
  dynamic: true,
  scans: 187,
  createdAt: iso(70),
  data: {
    title: "Studio North",
    description: "Design and print in Pune.",
    links: JSON.stringify([
      { title: "Portfolio", url: "https://example.com/work" },
      { title: "Book a call", url: "https://example.com/call" },
    ]),
  },
});
addCode({
  name: "Guest Wi-Fi",
  type: "wifi",
  dynamic: false,
  createdAt: iso(90),
  folderId: "f-food",
  data: { ssid: "Studio-Guest", password: "welcome123", security: "WPA" },
});
addCode({
  name: "Launch party",
  type: "event",
  dynamic: false,
  createdAt: iso(12),
  folderId: "f-events",
  data: {
    title: "Launch party",
    startsAt: new Date(Date.now() + 20 * DAY).toISOString(),
    endsAt: new Date(Date.now() + 20 * DAY + 3 * 3600000).toISOString(),
    location: "Pune",
  },
});

// Experience state
const drafts = new Map<string, { title: string; blocks: any[]; updatedAt: string }>();
const versions = new Map<string, Row[]>();
const settings = new Map<string, { timeZone: string }>();
const submissions: Row[] = [];
let submissionId = 1;
const tapSeed = new Map<string, number>();
const pushSubmission = (codeId: string, formId: string, form: string, answers: Row, daysAgo: number, read = true) =>
  submissions.unshift({ id: submissionId++, codeId, blockId: formId, form, answers, createdAt: iso(daysAgo), read });
const formOf = (title: RegExp) => kettleBlocks.find((b: any) => b.type === "form" && title.test(b.title));
const warranty = formOf(/warranty/i);
const problem = formOf(/problem/i);
[
  ["Ananya", "ananya@example.com", "Croma, Pune", 1, itemCodes[0]],
  ["Rohit", "rohit@example.com", "Amazon", 2, itemCodes[1]],
  ["Meera", "meera@example.com", "Reliance Digital", 4, itemCodes[0]],
].forEach(([n, e, w, d, c]: any, i) =>
  pushSubmission(c.id, warranty.id, warranty.title, { "Your name": n, Email: e, "Where did you buy it?": w }, d, i > 0),
);
pushSubmission(itemCodes[2].id, problem.id, problem.title, { "Serial number": "SN-0003", Email: "dev@example.com", "What happened?": "The lid does not click shut." }, 1, false);

// ------------------------------------------------------------------ helpers
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const demoOnly = () => fail("That part is only available in the full app.");
const byId = (id: string) => codes.find((c) => c.id === id);
const isItem = (c: Row) => !!c.data.itemOf;
const itemsOf = (id: string) => codes.filter((c) => c.data.itemOf === id);
const family = (c: Row) => [c.id, ...itemsOf(c.id).map((i) => i.id)];
const parseJson = (body: any) => {
  try {
    return typeof body === "string" ? JSON.parse(body) : {};
  } catch {
    return {};
  }
};

function analytics(days: number, codeId?: string | null) {
  const pool = codeId ? codes.filter((c) => c.id === codeId) : codes.filter((c) => c.dynamic);
  const rand = rng(`${codeId || "all"}-${days}`);
  const weight = pool.reduce((s, c) => s + (c.scans || 0), 0);
  const daily = [];
  let total = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * DAY);
    const weekend = [0, 6].includes(date.getUTCDay());
    const trend = 0.7 + 0.6 * ((days - i) / days);
    const base = Math.max(0, (weight / 40) * trend * (weekend ? 0.6 : 1));
    const scans = Math.round(base * (0.55 + rand() * 0.9));
    total += scans;
    daily.push({ date: date.toISOString().slice(0, 10), scans });
  }
  const split = (parts: Record<string, number>) =>
    Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(total * v)]));
  return {
    total,
    uniqueDailyVisitors: Math.round(total * 0.74),
    daily,
    days,
    devices: { Mobile: Math.round(total * 0.78), Desktop: Math.round(total * 0.18), Tablet: Math.round(total * 0.04) },
    browsers: split({ Chrome: 0.46, Safari: 0.38, Edge: 0.08, Firefox: 0.05, Other: 0.03 }),
    operatingSystems: split({ Android: 0.5, iOS: 0.33, Windows: 0.1, macOS: 0.05, Linux: 0.02 }),
    referrers: split({ Direct: 0.62, "instagram.com": 0.17, "google.com": 0.11, "whatsapp.com": 0.07, "t.co": 0.03 }),
    topCodes: codes
      .filter((c) => c.dynamic && !isItem(c))
      .sort((a, b) => b.scans - a.scans)
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, scans: Math.round(c.scans * (days / 30)) })),
  };
}

function view(c: Row) {
  const d = c.data;
  return {
    id: c.id,
    slug: c.slug,
    name: d.title || c.name,
    serial: d.serial || "",
    warrantyUntil: d.warrantyUntil || "",
    active: c.active,
    shortUrl: c.shortUrl,
    scans: c.scans,
    responses: submissions.filter((s) => s.codeId === c.id).length,
    service: services.get(c.id) || [],
  };
}

function liveExperience(c: Row) {
  const d = c.data;
  return { title: d.title || c.name, blocks: JSON.parse(d.blocks || "[]") };
}

// The page a visitor would see, including an item's own details.
export function pageHtml(c: Row, preview = false) {
  if (c.type === "experience") {
    const own = c.data;
    const template = own.itemOf ? byId(own.itemOf) : c;
    if (!template) return "<p>This page is no longer available.</p>";
    const item = own.itemOf
      ? {
          name: own.title || c.name,
          serial: own.serial || "",
          warrantyUntil: own.warrantyUntil || "",
          history: [...(services.get(c.id) || [])].map((s) => ({ date: s.date, note: s.note })),
        }
      : null;
    return renderExperience(
      {
        title: own.title || c.name,
        blocks: parseBlocks(template.data),
        slug: c.slug,
        pageOptions: template.pageOptions,
        ticket: "demo",
      },
      {
        mediaUrl: (id: string) => assets.find((a) => a.id === id)?.url || "",
        preview: true,
        zone: template.data.timeZone || "UTC",
        item,
        now: preview ? new Date() : new Date(),
      },
    );
  }
  const note: Record<string, string> = {
    url: `Visitors are sent on to <b>${c.data.url || ""}</b>. You can change this address any time without reprinting the code.`,
    links: `A hosted link page with ${(JSON.parse(c.data.links || "[]") as any[]).length} links, ready on any phone.`,
  };
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px/1.6 system-ui;margin:0;padding:28px;background:#f0f3ec;color:#1f2d26"><main style="max-width:440px;margin:auto;background:#fff;border-radius:16px;padding:24px"><h1 style="margin:0 0 8px;font-size:26px">${c.name}</h1><p style="color:#5d6b63">${note[c.type] || "This is where a visitor lands after scanning."}</p></main></body>`;
}

// ------------------------------------------------------------------- router
type Handler = (m: { params: Row; query: URLSearchParams; body: any; method: string }) => Response | Promise<Response>;
const routes: [string, RegExp, string[], Handler][] = [];
function on(method: string, pattern: string, handler: Handler) {
  const names: string[] = [];
  const rx = new RegExp(
    "^" +
      pattern.replace(/:([A-Za-z]+)/g, (_m, n) => {
        names.push(n);
        return "([^/]+)";
      }) +
      "/?$",
  );
  routes.push([method, rx, names, handler]);
}

// auth and workspace
on("GET", "/auth/status", () =>
  json({
    setupRequired: false,
    user,
    publicUrl: origin(),
    workspace,
    workspaces: [workspace],
    hosted: true,
    operator: false,
  }),
);
on("POST", "/auth/logout", () => {
  setTimeout(() => (location.href = "/"), 50);
  return json({ ok: true });
});
on("GET", "/auth/sessions", () =>
  json([{ id: "s1", label: "Chrome on Windows (this demo)", createdAt: iso(0), expires: Date.now() + 7 * DAY, current: true }]),
);
on("POST", "/auth/sessions/revoke-others", () => json({ ok: true }));
on("DELETE", "/auth/sessions/:id", () => json({ ok: true }));
on("POST", "/auth/password", () => demoOnly());
on("GET", "/workspaces", () => json([workspace]));
on("POST", "/workspaces/:id/select", () => json({ ok: true }));
on("POST", "/workspaces", () => demoOnly());
on("GET", "/team", () =>
  json([
    { ...user, role: "owner", joinedAt: iso(120) },
    { id: "u2", name: "Arjun Mehta", email: "arjun@example.com", role: "editor", joinedAt: iso(60) },
    { id: "u3", name: "Isha Kulkarni", email: "isha@example.com", role: "viewer", joinedAt: iso(20) },
  ]),
);
on("GET", "/invitations", () =>
  json([{ id: "i1", email: "priya@example.com", role: "editor", expires: Date.now() + 5 * DAY }]),
);
on("POST", "/invitations", () => json({ url: `${origin()}/#invitation-demo` }));
on("GET", "/audit", () =>
  json(
    codes.slice(0, 6).map((c, i) => ({
      id: i + 1,
      event: "code.created",
      subject: c.id,
      details: { name: c.name, type: c.type },
      createdAt: c.createdAt,
      actor: "Maya Rao",
    })),
  ),
);
on("GET", "/storage", () =>
  json({ usedBytes: assets.reduce((s, a) => s + a.size, 0) + 3_400_000, limitBytes: 100 * 1024 ** 2, maxUploadBytes: 20 * 1024 ** 2, backend: "Demo storage" }),
);
on("GET", "/backups/status", () =>
  json({ state: "succeeded", lastAttemptAt: iso(0.2), lastSuccessAt: iso(0.2), lastFailureAt: null, localCompletedAt: iso(0.2), remoteCompletedAt: null, failureStage: null, intervalHours: 24, retention: 7, remoteEnabled: false }),
);
on("GET", "/billing", () =>
  json({
    hosted: true,
    currency: "INR",
    current: { id: "free", name: "Free", codes: 25, members: 3, storageBytes: 100 * 1024 ** 2, status: "active", source: "default" },
    usage: { codes: codes.length, members: 3, storageBytes: 3_400_000, pendingInvites: 1 },
    plans: hostedPlans.map((p: any) => ({ ...p, monthlyINR: null })),
    checkoutAvailable: false,
    checkoutMessage: "Free is available now. Plus and Pro are coming soon.",
    maxOwnedWorkspaces: 3,
  }),
);
on("GET", "/support/unread", () => json({ count: 0 }));
on("GET", "/support/requests", () => json([]));
on("POST", "/support/requests", () => demoOnly());
on("GET", "/experience/unread", () =>
  json({ unread: submissions.filter((s) => !s.read).length, byCode: {} }),
);

// design library, folders, page templates
on("GET", "/templates", () => json(designTemplates));
on("POST", "/templates", ({ body }) => {
  const t = { id: uuid(), name: body.name, color: body.color, design: body.design };
  designTemplates.push(t);
  return json(t, 201);
});
on("DELETE", "/templates/:id", ({ params }) => {
  const i = designTemplates.findIndex((t) => t.id === params.id);
  if (i >= 0) designTemplates.splice(i, 1);
  return json({ ok: true });
});
on("GET", "/page-templates", () => json([]));
on("POST", "/page-templates", () => demoOnly());
on("DELETE", "/page-templates/:id", () => json({ ok: true }));
on("GET", "/folders", () => json(folders));
on("POST", "/folders", ({ body }) => {
  const f = { id: uuid(), name: String(body.name || "Folder") };
  folders.push(f);
  return json(f, 201);
});
on("DELETE", "/folders/:id", ({ params }) => {
  const i = folders.findIndex((f) => f.id === params.id);
  if (i >= 0) folders.splice(i, 1);
  codes.forEach((c) => c.folderId === params.id && (c.folderId = null));
  return json({ ok: true });
});

// media
on("GET", "/assets", () => json(assets));
on("DELETE", "/assets/:id", ({ params }) => {
  const i = assets.findIndex((a) => a.id === params.id);
  if (i >= 0) assets.splice(i, 1);
  return json({ ok: true });
});
demoHooks.upload = (file, kind) =>
  new Promise<Asset>((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("The demo accepts image files only."));
    if (file.size > 2_000_000) return reject(new Error("Demo uploads are limited to 2 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const asset: Asset = {
        id: uuid(),
        name: file.name,
        kind: kind === "logo" ? "logo" : "image",
        mime: file.type,
        size: file.size,
        pages: null,
        createdAt: new Date().toISOString(),
        url: String(reader.result),
        metadata: {},
      };
      assets.unshift(asset);
      resolve(asset);
    };
    reader.readAsDataURL(file);
  });

// analytics
on("GET", "/analytics", ({ query }) =>
  json(analytics(Math.min(90, Math.max(1, Number(query.get("days")) || 30)), query.get("codeId"))),
);

// codes
const CODE_TYPES = ["url","text","wifi","email","phone","vcard","sms","whatsapp","location","event","links","pdf","contact","business","social","gallery","audio","video","hosted-event","app","experience"];
const checkCode = (body: Row) => {
  if (!body.name?.trim()) return "Enter a name for this code.";
  if (!CODE_TYPES.includes(body.type)) return "Choose a code type.";
  if (body.type === "url" && !/^https?:\/\//i.test(body.data?.url || ""))
    return "Enter a complete website URL, including https://.";
  if (body.type === "experience") {
    try {
      validateExperienceBlocks(JSON.parse(body.data?.blocks || "[]"));
    } catch {
      return "Check the blocks on your page: every block needs its required details.";
    }
  }
  return "";
};
on("GET", "/codes", () => json(codes));
on("POST", "/codes", ({ body }) => {
  const problemText = checkCode(body);
  if (problemText) return fail(problemText);
  if (codes.length >= 60) return fail("The demo holds up to 60 codes.");
  return json(addCode(body), 201);
});
on("POST", "/codes/bulk", ({ body }) =>
  json((body.codes || []).map((c: Row) => addCode({ ...body.common, ...c })), 201),
);
on("POST", "/codes/batch", ({ body }) => {
  const picked = codes.filter((c) => body.ids.includes(c.id));
  for (const c of picked) {
    if (body.action === "delete") codes.splice(codes.indexOf(c), 1);
    else if (body.action === "move") c.folderId = body.folderId || null;
    else if (c.dynamic) c.active = body.action === "resume";
  }
  return json({ ok: true, affected: picked.length });
});
on("POST", "/codes/export", async ({ body }) => {
  const files: Record<string, Uint8Array> = {};
  for (const id of body.ids as string[]) {
    const c = byId(id);
    if (!c) continue;
    files[`${c.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${c.slug}.svg`] = strToU8(svgFor(c));
  }
  return new Response(zipSync(files) as BlobPart, { headers: { "Content-Type": "application/zip" } });
});
on("POST", "/codes/:id/duplicate", ({ params }) => {
  const c = byId(params.id);
  if (!c) return fail("QR code not found.", 404);
  return json(addCode({ ...c, id: undefined, slug: undefined, name: `${c.name.slice(0, 93)} (copy)`, scans: 0 }), 201);
});
on("PUT", "/codes/:id", ({ params, body }) => {
  const c = byId(params.id);
  if (!c) return fail("QR code not found.", 404);
  const problemText = checkCode(body);
  if (problemText) return fail(problemText);
  const keep = c.type === "experience" && !isItem(c) ? { title: c.data.title, blocks: c.data.blocks } : {};
  Object.assign(c, {
    name: body.name,
    data: { ...body.data, ...keep, ...(c.data.itemOf ? { itemOf: c.data.itemOf } : {}) },
    folderId: body.folderId ?? null,
    color: body.color,
    active: body.active,
    design: body.design,
    campaign: body.campaign,
    pageOptions: body.pageOptions,
  });
  return json(c);
});
on("DELETE", "/codes/:id", ({ params }) => {
  const c = byId(params.id);
  if (c) {
    itemsOf(c.id).forEach((i) => codes.splice(codes.indexOf(i), 1));
    codes.splice(codes.indexOf(c), 1);
  }
  return json({ ok: true });
});
function svgFor(c: Row) {
  const qr = QRCode.create(c.dynamic ? c.shortUrl : staticContent(c), { errorCorrectionLevel: "H" });
  return renderSvg(qr.modules.data, qr.modules.size, c.design, c.color, qr.modules.reservedBit);
}
function staticContent(c: Row) {
  const d = c.data;
  switch (c.type) {
    case "wifi": return `WIFI:T:${d.security || "WPA"};S:${d.ssid};P:${d.password};;`;
    case "text": return d.text || "";
    case "url": return d.url || "";
    default: return c.shortUrl;
  }
}
on("GET", "/codes/:id/download", async ({ params, query }) => {
  const c = byId(params.id);
  if (!c) return fail("QR code not found.", 404);
  const svg = svgFor(c);
  if (query.get("format") === "svg")
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
  return new Response(await svgToPng(svg, Number(query.get("size")) || 1024), { headers: { "Content-Type": "image/png" } });
});

// experiences
const template = (id: string) => {
  const c = byId(id);
  if (!c || c.type !== "experience") throw Object.assign(new Error("Experience not found."), { status: 404 });
  if (isItem(c)) throw Object.assign(new Error("This is an item page. Open its template to make changes."), { status: 400 });
  return c;
};
on("GET", "/experience/templates", () => json(starterTemplates()));
on("POST", "/experience/preview", ({ body }) => {
  const blocks = (body.blocks || [])
    .map((b: any) => blockSchema.safeParse(b))
    .filter((r: any) => r.success)
    .map((r: any) => r.data);
  const html = renderExperience(
    { title: body.title || "Preview", blocks, slug: "preview", pageOptions: body.pageOptions || {}, ticket: "preview" },
    {
      mediaUrl: (id: string) => assets.find((a) => a.id === id)?.url || "",
      preview: true,
      now: body.at ? new Date(body.at) : new Date(),
      zone: body.timeZone || "UTC",
    },
  );
  return new Response(html, { headers: { "Content-Type": "text/html" } });
});
on("GET", "/codes/:id/experience/draft", ({ params }) => {
  const c = template(params.id);
  const d = drafts.get(c.id);
  const base = d ? { title: d.title, blocks: d.blocks } : liveExperience(c);
  return json({ ...base, dirty: !!d, updatedAt: d?.updatedAt ?? null });
});
on("PUT", "/codes/:id/experience/draft", ({ params, body }) => {
  const c = template(params.id);
  if (!Array.isArray(body.blocks) || body.blocks.length > 30) return fail("This draft could not be saved.");
  drafts.set(c.id, { title: String(body.title || ""), blocks: body.blocks, updatedAt: new Date().toISOString() });
  return json({ ok: true });
});
on("DELETE", "/codes/:id/experience/draft", ({ params }) => {
  drafts.delete(template(params.id).id);
  return json({ ok: true });
});
on("POST", "/codes/:id/experience/publish", ({ params, body }) => {
  const c = template(params.id);
  const d = drafts.get(c.id);
  if (!d) return fail("There are no unpublished changes.");
  const parsed = experienceSchema.safeParse({ title: d.title, blocks: d.blocks });
  if (!parsed.success) {
    const index = parsed.error.issues.find((i: any) => i.path[0] === "blocks")?.path[1];
    return fail(typeof index === "number" ? `Block ${index + 1} is not finished. Fill in its required details.` : "Add a page title before publishing.");
  }
  let blocks;
  try {
    blocks = validateExperienceBlocks(parsed.data.blocks);
  } catch (e) {
    return fail((e as Error).message);
  }
  const list = versions.get(c.id) || [];
  if (!list.length) list.push({ version: 1, ...liveExperience(c), note: "Original", createdAt: c.createdAt, author: user.name });
  list.push({ version: list.length + 1, title: parsed.data.title, blocks, note: String(body?.note || ""), createdAt: new Date().toISOString(), author: user.name });
  versions.set(c.id, list);
  c.data = { ...c.data, title: parsed.data.title, blocks: JSON.stringify(blocks) };
  drafts.delete(c.id);
  return json({ ok: true, version: list.length });
});
on("GET", "/codes/:id/experience/versions", ({ params }) => {
  const c = template(params.id);
  return json(
    [...(versions.get(c.id) || [])].reverse().map((v) => ({ version: v.version, title: v.title, note: v.note, createdAt: v.createdAt, author: v.author })),
  );
});
on("POST", "/codes/:id/experience/versions/:version/restore", ({ params }) => {
  const c = template(params.id);
  const v = (versions.get(c.id) || []).find((x) => x.version === Number(params.version));
  if (!v) return fail("Version not found.", 404);
  drafts.set(c.id, { title: v.title, blocks: v.blocks, updatedAt: new Date().toISOString() });
  return json({ title: v.title, blocks: v.blocks, dirty: true });
});
on("GET", "/codes/:id/experience/stats", ({ params }) => {
  const c = template(params.id);
  const all = family(c).map((id) => byId(id)!);
  const scans = all.reduce((s, x) => s + x.scans, 0);
  const subs = submissions.filter((s) => family(c).includes(s.codeId));
  const rand = rng(c.id);
  const blocks = liveExperience(c).blocks;
  const actions: Row[] = [];
  for (const b of blocks) {
    if (b.type === "button") actions.push({ blockId: b.id, label: b.label, kind: "tap", count: Math.round(scans * (0.18 + rand() * 0.1)) });
    if (b.type === "links") b.items.forEach((it: any) => actions.push({ blockId: b.id, label: it.label, kind: "tap", count: Math.round(scans * 0.05) }));
    if (b.type === "form") actions.push({ blockId: b.id, label: b.title, kind: "submit", count: subs.filter((s) => s.blockId === b.id).length });
  }
  const taps = actions.filter((a) => a.kind === "tap").reduce((s, a) => s + a.count, 0);
  actions.sort((a, b) => b.count - a.count);
  return json({ scans, submissions: subs.length, taps, actions, actionsPerScan: scans ? (subs.length + taps) / scans : null, blocks: blocks.length });
});
on("GET", "/codes/:id/experience/submissions", ({ params }) => {
  const c = template(params.id);
  const ids = family(c);
  return json(
    submissions
      .filter((s) => ids.includes(s.codeId))
      .map((s) => ({ id: s.id, item: s.codeId === c.id ? "" : byId(s.codeId)?.name || "", blockId: s.blockId, form: s.form, answers: s.answers, createdAt: s.createdAt, read: s.read })),
  );
});
on("POST", "/codes/:id/experience/submissions/read", ({ params }) => {
  const ids = family(template(params.id));
  submissions.forEach((s) => ids.includes(s.codeId) && (s.read = true));
  return json({ ok: true });
});
on("DELETE", "/codes/:id/experience/submissions/:sid", ({ params }) => {
  const i = submissions.findIndex((s) => s.id === Number(params.sid));
  if (i >= 0) submissions.splice(i, 1);
  return json({ ok: true });
});
on("GET", "/codes/:id/experience/alerts", () => json({ available: false, emails: [] }));
on("PUT", "/codes/:id/experience/alerts", () => fail("Email alerts need a server with email set up."));
on("GET", "/codes/:id/experience/settings", ({ params }) =>
  json(settings.get(params.id) || { timeZone: template(params.id).data.timeZone || "UTC" }),
);
on("PUT", "/codes/:id/experience/settings", ({ params, body }) => {
  const c = template(params.id);
  settings.set(c.id, { timeZone: body.timeZone });
  c.data.timeZone = body.timeZone;
  return json({ ok: true, timeZone: body.timeZone });
});
on("GET", "/codes/:id/experience/items", ({ params }) => json(itemsOf(template(params.id).id).map(view)));
on("POST", "/codes/:id/experience/items", ({ params, body }) => {
  const c = template(params.id);
  const list = (body.items || []).slice(0, 100);
  if (!list.length || list.some((i: any) => !String(i.name || "").trim())) return fail("Each item needs a name.");
  if (codes.length + list.length > 80) return fail("The demo holds up to 80 codes.");
  return json(
    list.map((i: any) =>
      view(addCode({ name: i.name, type: "experience", dynamic: true, color: c.color, design: c.design, data: { title: i.name, itemOf: c.id, serial: i.serial || "", warrantyUntil: i.warrantyUntil || "" } })),
    ),
    201,
  );
});
on("PUT", "/codes/:id/experience/items/:itemId", ({ params, body }) => {
  const item = byId(params.itemId);
  if (!item) return fail("Item not found.", 404);
  item.name = body.name;
  item.data = { ...item.data, title: body.name, serial: body.serial || "", warrantyUntil: body.warrantyUntil || "" };
  return json(view(item));
});
on("DELETE", "/codes/:id/experience/items/:itemId", ({ params }) => {
  const i = codes.findIndex((c) => c.id === params.itemId);
  if (i >= 0) codes.splice(i, 1);
  return json({ ok: true });
});
on("POST", "/codes/:id/experience/items/:itemId/service", ({ params, body }) => {
  const item = byId(params.itemId);
  if (!item) return fail("Item not found.", 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !String(body.note || "").trim()) return fail("Enter a date like 2026-03-31 and a short note.");
  services.set(item.id, [{ id: serviceId++, date: body.date, note: body.note }, ...(services.get(item.id) || [])].sort((a, b) => (a.date < b.date ? 1 : -1)));
  return json(view(item), 201);
});
on("DELETE", "/codes/:id/experience/items/:itemId/service/:sid", ({ params }) => {
  const item = byId(params.itemId);
  if (!item) return fail("Item not found.", 404);
  services.set(item.id, (services.get(item.id) || []).filter((s) => s.id !== Number(params.sid)));
  return json(view(item));
});

// -------------------------------------------------------------- installation
function showPage(html: string, title: string) {
  document.getElementById("demo-page")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "demo-page";
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `<div class="demo-page-bar"><span>What a visitor sees</span><button type="button" aria-label="Close">Close</button></div><iframe sandbox="" title="${title}"></iframe>`;
  (dialog.querySelector("iframe") as HTMLIFrameElement).srcdoc = html;
  dialog.querySelector("button")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

export function installMockApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return real(input, init);
    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
    const path = url.pathname.slice(4);
    const body = parseJson(init?.body);
    await new Promise((r) => setTimeout(r, 40));
    for (const [m, rx, names, handler] of routes) {
      if (m !== method) continue;
      const hit = rx.exec(path);
      if (!hit) continue;
      const params: Row = {};
      names.forEach((n, i) => (params[n] = decodeURIComponent(hit[i + 1])));
      try {
        return await handler({ params, query: url.searchParams, body, method });
      } catch (e: any) {
        return fail(e.message || "Something went wrong.", e.status || 400);
      }
    }
    return method === "GET" ? fail("That is not part of the demo.", 404) : demoOnly();
  };

  // Links the real app points at the server are answered in the browser.
  document.addEventListener(
    "click",
    async (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = new URL(link.href, location.origin);
      if (href.origin !== location.origin) return;
      const download = /^\/api\/codes\/([^/]+)\/download$/.exec(href.pathname);
      const csv = /^\/api\/codes\/([^/]+)\/experience\/submissions\.csv$/.exec(href.pathname);
      const labels = /\/experience\/items\/labels$/.test(href.pathname);
      const page = /^\/r\/([^/]+)/.exec(href.pathname);
      if (!download && !csv && !labels && !page) return;
      event.preventDefault();
      event.stopPropagation();
      if (download) {
        const c = byId(download[1]);
        if (!c) return;
        const format = href.searchParams.get("format") === "svg" ? "svg" : "png";
        const svg = svgFor(c);
        saveBlob(format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg, Number(href.searchParams.get("size")) || 1024), `openqr-${c.slug}.${format}`);
      } else if (csv) {
        const c = byId(csv[1]);
        if (!c) return;
        const ids = family(c);
        const rows = submissions.filter((s) => ids.includes(s.codeId));
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r.answers)))];
        const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const text = [["Received", "Form", "Item", ...keys], ...rows.map((r) => [r.createdAt, r.form, r.codeId === c.id ? "" : byId(r.codeId)?.name || "", ...keys.map((k) => r.answers[k] ?? "")])].map((r) => r.map(cell).join(",")).join("\r\n");
        saveBlob(new Blob([text], { type: "text/csv" }), "responses.csv");
      } else if (labels) {
        const m = /codes\/([^/]+)\/experience/.exec(href.pathname);
        const parent = m && byId(m[1]);
        const cells = (parent ? itemsOf(parent.id) : []).map((i) => `<figure style="margin:0;padding:12px;border:1px dashed #999;text-align:center;font:13px system-ui"><div style="width:120px;margin:auto">${svgFor(i)}</div><b>${i.name}</b><br>${i.data.serial || ""}</figure>`).join("");
        showPage(`<body style="margin:0;padding:16px;font:14px system-ui"><p>In the full app this opens a print-ready sheet.</p><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${cells}</div></body>`, "Label sheet");
      } else if (page) {
        const c = codes.find((x) => x.slug === page[1]);
        if (c) showPage(pageHtml(c), c.name);
      }
    },
    true,
  );
}
