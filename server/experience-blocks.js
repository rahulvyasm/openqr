import { z } from "zod";
import { xml } from "../shared/qr.js";
import { problem } from "./security.js";

/*
 * An experience is an ordered list of blocks stored as JSON in data.blocks.
 * The same list drives validation, asset ownership checks, the hosted page and
 * the builder preview, so nothing can render that was not validated here.
 */
export const MAX_BLOCKS = 30;
const text = (max) => z.string().trim().max(max);
const id = z.string().regex(/^[a-z0-9]{4,12}$/);
const action = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => safeAction(value), "Use an http(s), tel: or mailto: link.");
const assetId = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// A rule decides when a block is shown, in the page's time zone.
export const whenSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    from: time.optional(),
    to: time.optional(),
  })
  .refine((w) => (w.from === undefined) === (w.to === undefined), "Set both times.")
  .refine((w) => w.days.length || w.from !== undefined, "Choose days or times.");
const base = { id, when: whenSchema.optional() };

export function safeAction(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (["http:", "https:"].includes(url.protocol)) return url.href;
    if (url.protocol === "tel:" && /^tel:\+?[\d ()-]{5,30}$/.test(value))
      return value;
    if (url.protocol === "mailto:" && /^mailto:[^\s@]+@[^\s@]+/.test(value))
      return value.slice(0, 2000);
  } catch {
    /* Falls through to rejection. */
  }
  return null;
}

const field = z.object({
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  label: text(80).min(1),
  type: z.enum(["text", "email", "phone", "textarea", "choice", "rating"]),
  required: z.boolean().default(false),
  options: z.array(text(60).min(1)).max(8).default([]),
});
export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("heading"),
    text: text(120).min(1),
    subtext: text(300).default(""),
  }),
  z.object({ ...base, type: z.literal("text"), text: text(2500).min(1) }),
  z.object({
    ...base,
    type: z.literal("image"),
    assetId,
    alt: text(200).default(""),
    caption: text(200).default(""),
  }),
  z.object({
    ...base,
    type: z.literal("video"),
    assetId,
    caption: text(200).default(""),
  }),
  z.object({
    ...base,
    type: z.literal("button"),
    label: text(60).min(1),
    url: action,
  }),
  z.object({
    ...base,
    type: z.literal("links"),
    items: z
      .array(z.object({ label: text(60).min(1), url: action }))
      .min(1)
      .max(10),
  }),
  z.object({
    ...base,
    type: z.literal("file"),
    assetId,
    label: text(80).min(1),
  }),
  z.object({
    ...base,
    type: z.literal("item"),
    title: text(80).min(1),
  }),
  z.object({
    ...base,
    type: z.literal("form"),
    title: text(100).min(1),
    intro: text(300).default(""),
    submitLabel: text(40).default("Send"),
    successMessage: text(300).default("Thank you. We received your response."),
    fields: z.array(field).min(1).max(8),
  }),
]);
export const experienceSchema = z.object({
  title: text(100).min(1),
  blocks: z.array(blockSchema).max(MAX_BLOCKS),
});

export function parseBlocks(data) {
  try {
    return z.array(blockSchema).max(MAX_BLOCKS).parse(
      JSON.parse(data.blocks || "[]"),
    );
  } catch {
    throw problem(
      "Check the blocks on your page: every block needs its required details.",
    );
  }
}
export function validateExperienceBlocks(blocks) {
  const parsed = experienceSchema.shape.blocks.safeParse(blocks);
  if (!parsed.success)
    throw problem(
      "Check the blocks on your page: every block needs its required details.",
    );
  const seen = new Set();
  for (const block of parsed.data) {
    if (seen.has(block.id)) throw problem("Block identifiers must be unique.");
    seen.add(block.id);
    if (block.type === "form") {
      const fields = new Set();
      for (const f of block.fields) {
        if (fields.has(f.id)) throw problem("Form field identifiers must be unique.");
        fields.add(f.id);
        if (f.type === "choice" && f.options.length < 2)
          throw problem("A choice question needs at least two options.");
      }
    }
  }
  return parsed.data;
}
export function validateExperience(code) {
  const d = code.data;
  if (!code.dynamic) throw problem("Use a dynamic code for an experience.");
  if (!d.title?.trim() || d.title.length > 100)
    throw problem("Enter a page title with at most 100 characters.");
  validateExperienceBlocks(parseBlocks(d));
  return "https://openqr.invalid/hosted-page";
}
export function blockAssets(blocks) {
  return [...new Set(blocks.map((block) => block.assetId).filter(Boolean))];
}
export function blockAssetsOfData(data) {
  try {
    const blocks = JSON.parse(data.blocks || "[]");
    return Array.isArray(blocks)
      ? [...new Set(blocks.map((block) => block?.assetId).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}
export function assertBlockAssets(db, blocks, workspaceId) {
  for (const block of blocks) {
    if (!block.assetId) continue;
    const row = db
      .prepare("SELECT kind FROM assets WHERE id=? AND workspace_id=?")
      .get(block.assetId, workspaceId);
    const expected =
      block.type === "image"
        ? ["image", "logo"]
        : block.type === "video"
          ? ["video"]
          : ["pdf"];
    if (!row || !expected.includes(row.kind))
      throw problem("Choose a valid file from this workspace.");
  }
}

export function validZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function isVisible(block, now = new Date(), zone = "UTC") {
  const w = block.when;
  if (!w) return true;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: validZone(zone) ? zone : "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  if (w.days?.length && !w.days.includes(day)) return false;
  if (w.from === undefined) return true;
  const at = `${parts.hour}:${parts.minute}`;
  return w.from <= w.to ? at >= w.from && at < w.to : at >= w.from || at < w.to;
}

export function formAnswers(block, input) {
  const answers = {};
  for (const f of block.fields) {
    let value = String(input[`f_${f.id}`] ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (f.type === "textarea") value = value.slice(0, 3000);
    else value = value.slice(0, 500);
    if (!value) {
      if (f.required) return { error: `Please fill in “${f.label}”.` };
      continue;
    }
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return { error: `Enter a valid email address for “${f.label}”.` };
    if (f.type === "phone" && !/^\+?[\d ()-]{5,30}$/.test(value))
      return { error: `Enter a valid phone number for “${f.label}”.` };
    if (f.type === "choice" && !f.options.includes(value))
      return { error: `Choose one of the options for “${f.label}”.` };
    if (f.type === "rating" && !/^[1-5]$/.test(value))
      return { error: `Choose a rating for “${f.label}”.` };
    answers[f.label] = value;
  }
  return { answers };
}

const css = (p) => {
  const accent = p.accent || "#285b48",
    dark = p.theme === "bold",
    radius = p.corners === "square" ? "0" : "16px";
  return `*{box-sizing:border-box}body{margin:0;min-height:100vh;font:16px/1.65 ${p.font === "serif" ? "Georgia,serif" : "system-ui,-apple-system,Segoe UI,sans-serif"};color:${dark ? "#fff" : "#1f2d26"};background:${dark ? accent : p.theme === "minimal" ? "#fff" : "#f0f3ec"};padding:28px 16px}main{max-width:480px;margin:auto;display:grid;gap:16px}.xp-card{background:${dark ? "#ffffff14" : "#fff"};border:1px solid ${dark ? "#ffffff30" : "#e4eadc"};border-radius:${radius};padding:22px;overflow:hidden}h1{font-size:32px;line-height:1.15;letter-spacing:-1px;margin:4px 0 6px;overflow-wrap:anywhere}h2{font-size:20px;letter-spacing:-.4px;margin:0 0 6px}p{margin:0;white-space:pre-line;overflow-wrap:anywhere;color:${dark ? "#ffffffcc" : "#5d6b63"}}.xp-sub{font-size:15px}.xp-image,.xp-video{display:block;width:100%;border-radius:${radius};background:#0001}.xp-image{height:auto}figure{margin:0}figcaption{font-size:13px;color:${dark ? "#ffffffb0" : "#7d8b82"};padding-top:8px}.xp-btn{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;border-radius:${radius === "0" ? "0" : "14px"};text-decoration:none;font-weight:600;font-size:15px;border:1.5px solid ${dark ? "#fff" : accent};color:${p.buttonStyle === "solid" && !dark ? "#fff" : dark ? accent : accent};background:${p.buttonStyle === "solid" && !dark ? accent : dark ? "#fff" : "transparent"}}.xp-stack{display:grid;gap:10px}label{display:grid;gap:6px;font-size:14px;font-weight:600;margin-top:14px}input,textarea,select{font:inherit;font-weight:400;padding:12px 14px;border:1px solid #cfd8c8;border-radius:${radius === "0" ? "0" : "10px"};background:#fff;color:#1f2d26;width:100%}textarea{min-height:96px;resize:vertical}.xp-rate{display:flex;gap:8px;margin-top:6px}.xp-rate label{margin:0;flex:1;position:relative}.xp-rate input{position:absolute;opacity:0}.xp-rate span{display:block;text-align:center;padding:12px 0;border:1px solid #cfd8c8;border-radius:10px;background:#fff;color:#1f2d26}.xp-rate input:checked+span{background:${accent};color:#fff;border-color:${accent}}.xp-rate input:focus-visible+span{outline:2px solid ${accent};outline-offset:2px}button.xp-send{margin-top:18px;width:100%;padding:15px;border:0;border-radius:${radius === "0" ? "0" : "12px"};background:${dark ? "#fff" : accent};color:${dark ? accent : "#fff"};font:600 15px inherit;font-family:inherit;cursor:pointer}.xp-note{padding:12px 14px;border-radius:10px;margin-top:14px;font-size:14px}.xp-ok{background:#e4f6e9;color:#1d5a32}.xp-err{background:#fde8e6;color:#8a2a22}.xp-item dl{margin:14px 0 0;display:grid;gap:8px}.xp-item dl div{display:flex;justify-content:space-between;gap:12px}.xp-item dt{color:#7d8b82;font-size:14px}.xp-item dd{margin:0;font-weight:600;text-align:right;overflow-wrap:anywhere}.xp-item h3{font-size:15px;margin:20px 0 6px}.xp-item ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}.xp-item li{display:grid;gap:2px;padding:10px 12px;border-radius:10px;background:#0000000a}.xp-item time{font-size:12px;color:#7d8b82}.xp-trap{position:absolute;left:-9999px;height:0;overflow:hidden}.xp-foot{text-align:center;font-size:12px;color:${dark ? "#ffffff99" : "#9aa690"};padding:10px 0 4px}a:focus-visible,button:focus-visible{outline:2px solid ${accent};outline-offset:3px}`;
};

export function renderExperience(
  { title, blocks, slug, pageOptions = {}, ticket },
  {
    mediaUrl,
    sent = null,
    error = null,
    values = {},
    preview = false,
    now = new Date(),
    zone = "UTC",
    item = null,
  } = {},
) {
  const go = (blockId, index = 0) =>
    preview
      ? "#"
      : `/r/${encodeURIComponent(slug)}/go/${encodeURIComponent(blockId)}?i=${index}&ticket=${encodeURIComponent(ticket)}`;
  const arrow = '<span aria-hidden="true">↗</span>';
  const renderField = (f) => {
    const name = `f_${f.id}`,
      value = xml(values[name] ?? ""),
      req = f.required ? " required" : "";
    if (f.type === "textarea")
      return `<label>${xml(f.label)}${f.required ? " *" : ""}<textarea name="${name}" maxlength="3000"${req}>${value}</textarea></label>`;
    if (f.type === "choice")
      return `<label>${xml(f.label)}${f.required ? " *" : ""}<select name="${name}"${req}><option value=""></option>${f.options.map((o) => `<option${values[name] === o ? " selected" : ""}>${xml(o)}</option>`).join("")}</select></label>`;
    if (f.type === "rating")
      return `<div role="group" aria-label="${xml(f.label)}"><label style="margin-bottom:0">${xml(f.label)}${f.required ? " *" : ""}</label><div class="xp-rate">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}"${values[name] === String(n) ? " checked" : ""}><span>${n}</span></label>`).join("")}</div></div>`;
    const kind =
      f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text";
    return `<label>${xml(f.label)}${f.required ? " *" : ""}<input type="${kind}" name="${name}" maxlength="500" value="${value}"${req}></label>`;
  };
  const day = (value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(+d)
      ? ""
      : d.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
  };
  const renderItem = (b) => {
    // Without an item (the template itself) a sample shows how the page will look.
    const sample = !item,
      data = item || {
        name: "Sample item",
        serial: "SN-0001",
        warrantyUntil: new Date(now.getTime() + 200 * 86400000)
          .toISOString()
          .slice(0, 10),
        history: [{ date: new Date(now).toISOString().slice(0, 10), note: "Example service entry" }],
      };
    const today = now.toISOString().slice(0, 10);
    const warranty = data.warrantyUntil
      ? data.warrantyUntil >= today
        ? `Active until ${day(data.warrantyUntil)}`
        : `Expired on ${day(data.warrantyUntil)}`
      : "";
    return `<div class="xp-card xp-item"><h2>${xml(b.title)}</h2>${sample ? '<p class="xp-sub">Example details. Each item shows its own.</p>' : ""}<dl><div><dt>Item</dt><dd>${xml(data.name)}</dd></div>${data.serial ? `<div><dt>Serial</dt><dd>${xml(data.serial)}</dd></div>` : ""}${warranty ? `<div><dt>Warranty</dt><dd>${xml(warranty)}</dd></div>` : ""}</dl><h3>Service history</h3>${data.history.length ? `<ul>${data.history.map((h) => `<li><time>${xml(day(h.date))}</time><span>${xml(h.note)}</span></li>`).join("")}</ul>` : "<p>No service recorded yet.</p>"}</div>`;
  };
  const renderBlock = (b) => {
    switch (b.type) {
      case "item":
        return renderItem(b);
      case "heading":
        return `<div class="xp-card"><h1>${xml(b.text)}</h1>${b.subtext ? `<p class="xp-sub">${xml(b.subtext)}</p>` : ""}</div>`;
      case "text":
        return `<div class="xp-card"><p style="color:inherit">${xml(b.text)}</p></div>`;
      case "image":
        return `<figure><img class="xp-image" loading="lazy" src="${xml(mediaUrl(b.assetId))}" alt="${xml(b.alt)}">${b.caption ? `<figcaption>${xml(b.caption)}</figcaption>` : ""}</figure>`;
      case "video":
        return `<figure><video class="xp-video" controls playsinline preload="metadata" src="${xml(mediaUrl(b.assetId))}"></video>${b.caption ? `<figcaption>${xml(b.caption)}</figcaption>` : ""}</figure>`;
      case "button":
        return `<a class="xp-btn" href="${xml(go(b.id))}" rel="noopener noreferrer nofollow"><span>${xml(b.label)}</span>${arrow}</a>`;
      case "links":
        return `<div class="xp-stack">${b.items.map((item, i) => `<a class="xp-btn" href="${xml(go(b.id, i))}" rel="noopener noreferrer nofollow"><span>${xml(item.label)}</span>${arrow}</a>`).join("")}</div>`;
      case "file":
        return `<a class="xp-btn" href="${xml(mediaUrl(b.assetId))}" rel="noopener"><span>${xml(b.label)}</span><span aria-hidden="true">↓</span></a>`;
      case "form": {
        const done = sent === b.id;
        return `<div class="xp-card" id="b-${xml(b.id)}"><h2>${xml(b.title)}</h2>${b.intro ? `<p>${xml(b.intro)}</p>` : ""}${
          done
            ? `<div class="xp-note xp-ok" role="status">${xml(b.successMessage)}</div>`
            : `${error?.block === b.id ? `<div class="xp-note xp-err" role="alert">${xml(error.message)}</div>` : ""}<form method="post" action="${preview ? "#" : `/r/${encodeURIComponent(slug)}/submit/${encodeURIComponent(b.id)}`}"><input type="hidden" name="ticket" value="${xml(ticket || "")}"><div class="xp-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>${b.fields.map(renderField).join("")}<button class="xp-send" type="${preview ? "button" : "submit"}">${xml(b.submitLabel || "Send")}</button></form>`
        }</div>`;
      }
    }
    return "";
  };
  const body = blocks
    .filter((block) => isVisible(block, now, zone))
    .map(renderBlock)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${xml(title)} · OpenQR</title><style>${css(pageOptions)}</style></head><body><main>${body}${pageOptions.showBrand === false ? "" : '<div class="xp-foot">Made with OpenQR</div>'}</main></body></html>`;
}

let counter = 0;
const bid = () =>
  `b${(Date.now() + counter++).toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`;
const fid = (n) => `q${n}`;
export function templates() {
  const ids = () => bid();
  return [
    {
      id: "product",
      intent: "Bring a product to life",
      name: "Product companion",
      description:
        "Story, how-to video, manual, warranty registration and a way to report a problem.",
      title: "Meet your new product",
      blocks: [
        {
          id: ids(),
          type: "heading",
          text: "Meet your new product",
          subtext: "Everything you need to get started, in one place.",
        },
        { id: ids(), type: "item", title: "Your product" },
        {
          id: ids(),
          type: "text",
          text: "Thank you for choosing us. Here you will find setup help, the manual and a quick way to reach support.",
        },
        {
          id: ids(),
          type: "button",
          label: "Read the setup guide",
          url: "https://example.com/guide",
        },
        {
          id: ids(),
          type: "form",
          title: "Register your warranty",
          intro: "Register once and we will keep your purchase on file.",
          submitLabel: "Register",
          successMessage: "You are registered. Keep this page for later.",
          fields: [
            { id: fid(1), label: "Your name", type: "text", required: true, options: [] },
            { id: fid(2), label: "Email", type: "email", required: true, options: [] },
            { id: fid(3), label: "Where did you buy it?", type: "text", required: false, options: [] },
          ],
        },
        {
          id: ids(),
          type: "form",
          title: "Report a problem",
          intro: "Tell us what went wrong and we will get back to you.",
          submitLabel: "Send report",
          successMessage: "Report received. We will be in touch.",
          fields: [
            { id: fid(1), label: "Email", type: "email", required: true, options: [] },
            { id: fid(2), label: "What happened?", type: "textarea", required: true, options: [] },
          ],
        },
      ],
    },
    {
      id: "event",
      intent: "Run an event",
      name: "Event welcome",
      description: "Welcome note, schedule links and an RSVP form.",
      title: "Welcome to the event",
      blocks: [
        {
          id: ids(),
          type: "heading",
          text: "Welcome",
          subtext: "We are glad you are here. Here is what to know.",
        },
        {
          id: ids(),
          type: "text",
          text: "Doors open at 6 pm. Look for the registration desk by the main entrance.",
        },
        {
          id: ids(),
          type: "links",
          items: [
            { label: "Full schedule", url: "https://example.com/schedule" },
            { label: "Venue map", url: "https://example.com/map" },
          ],
        },
        {
          id: ids(),
          type: "form",
          title: "Will you join us?",
          intro: "Let us know so we can plan for you.",
          submitLabel: "RSVP",
          successMessage: "See you there!",
          fields: [
            { id: fid(1), label: "Your name", type: "text", required: true, options: [] },
            { id: fid(2), label: "Email", type: "email", required: true, options: [] },
            { id: fid(3), label: "Attending", type: "choice", required: true, options: ["Yes", "Maybe", "No"] },
          ],
        },
      ],
    },
    {
      id: "enquiry",
      intent: "Grow my business",
      name: "Business enquiry",
      description: "Introduce what you do and collect leads with a short form.",
      title: "Let's talk",
      blocks: [
        {
          id: ids(),
          type: "heading",
          text: "Let's talk",
          subtext: "Tell us what you need and we will reply within a day.",
        },
        {
          id: ids(),
          type: "button",
          label: "Call us",
          url: "tel:+10000000000",
        },
        {
          id: ids(),
          type: "form",
          title: "Send an enquiry",
          intro: "",
          submitLabel: "Send enquiry",
          successMessage: "Thanks. We will be in touch soon.",
          fields: [
            { id: fid(1), label: "Your name", type: "text", required: true, options: [] },
            { id: fid(2), label: "Email", type: "email", required: true, options: [] },
            { id: fid(3), label: "Phone", type: "phone", required: false, options: [] },
            { id: fid(4), label: "How can we help?", type: "textarea", required: true, options: [] },
          ],
        },
      ],
    },
    {
      id: "feedback",
      intent: "Welcome guests",
      name: "Guest feedback",
      description: "A warm welcome and a quick rating form.",
      title: "How was your visit?",
      blocks: [
        {
          id: ids(),
          type: "heading",
          text: "How was your visit?",
          subtext: "Thirty seconds helps us improve.",
        },
        {
          id: ids(),
          type: "form",
          title: "Your feedback",
          intro: "",
          submitLabel: "Send feedback",
          successMessage: "Thank you for telling us.",
          fields: [
            { id: fid(1), label: "Rating", type: "rating", required: true, options: [] },
            { id: fid(2), label: "Anything we should know?", type: "textarea", required: false, options: [] },
          ],
        },
      ],
    },
  ];
}
