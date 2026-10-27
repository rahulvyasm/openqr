import { xml } from "../shared/qr.js";

export function shell(title, body, color = "#285b48") {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${xml(title)} · OpenQR</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f7f1;color:#253b30;font:16px/1.7 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:30px 20px}main{width:100%;max-width:460px;text-align:center}h1{font-size:30px;line-height:1.3;letter-spacing:-1px;margin:18px 0 12px;overflow-wrap:anywhere}p{color:#73816b;white-space:pre-line;overflow-wrap:anywhere}.avatar{width:76px;height:76px;border-radius:25px;display:grid;place-items:center;color:white;background:${xml(color)};font-size:28px;font-weight:600;margin:0 auto}.links{display:grid;gap:12px;margin:30px 0}a.link{padding:16px 20px;border:1px solid #dfe7d7;border-radius:12px;background:#fff;color:${xml(color)};text-decoration:none;font-size:15px;font-weight:600;display:flex;justify-content:space-between;gap:15px;text-align:left;overflow-wrap:anywhere}a.link:hover{border-color:${xml(color)}}footer{font-size:12px;color:#9eaa95;margin-top:40px}small{font-size:12px;color:#95a189}</style></head><body><main>${body}<footer>Created with OpenQR</footer></main></body></html>`;
}

export function hostedPage(code, assets, ticket) {
  const d = code.data,
    p = code.pageOptions || {},
    accent = p.accent || code.color,
    theme = p.theme || "soft",
    title = code.type === "contact" ? d.fullName : d.title;
  const media = (id) =>
    `/r/${encodeURIComponent(code.slug)}/media/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`;
  const file = assets.find((a) => a.id === d.pdfId),
    cover = d.coverId
      ? `<img class="page-cover" src="${media(d.coverId)}" alt="${xml(title)}">`
      : "";
  const avatar = d.portraitId
    ? `<img class="portrait" src="${media(d.portraitId)}" alt="${xml(title)}">`
    : `<div class="identity">${xml(title.trim().slice(0, 2).toUpperCase())}</div>`;
  const link = (label, url, platform = "website") =>
    `<a class="action" href="${xml(url)}" rel="noopener noreferrer nofollow"><span class="platform">${xml({ instagram: "◎", facebook: "f", linkedin: "in", youtube: "▶", tiktok: "♪", x: "𝕏", github: "⌘", website: "↗" }[platform] || "↗")}</span><span>${xml(label)}</span><b>↗</b></a>`;
  const buttons = [];
  if (["contact", "business"].includes(code.type)) {
    if (d.phone)
      buttons.push(link("Call us", `tel:${d.phone.replace(/[ ()-]/g, "")}`));
    if (d.email) buttons.push(link("Send an email", `mailto:${d.email}`));
    if (d.website) buttons.push(link("Visit website", new URL(d.website).href));
    if (d.address)
      buttons.push(
        link(
          "Get directions",
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`,
        ),
      );
  }
  let content = "";
  if (code.type === "pdf") {
    content = `<div class="document"><span class="document-icon">PDF</span><div><strong>${xml(file?.name || "Document")}</strong><small>${file?.pages || ""} ${file?.pages === 1 ? "page" : "pages"} · ${file ? Math.max(1, Math.round(file.size / 1024)) : 0} KB</small></div></div><div class="actions">${link("Open PDF", `/view/${encodeURIComponent(code.slug)}/${encodeURIComponent(d.pdfId)}?ticket=${encodeURIComponent(ticket)}`)}${link("Download PDF", media(d.pdfId))}</div>`;
  }
  if (code.type === "contact") {
    content = `<a class="primary-action" href="/r/${encodeURIComponent(code.slug)}/contact.vcf?ticket=${encodeURIComponent(ticket)}">↓ Save contact</a><div class="actions">${buttons.join("")}</div>`;
  }
  if (code.type === "business") {
    let hours = [];
    try {
      hours = JSON.parse(d.hours || "[]");
    } catch {}
    content = `<div class="actions">${buttons.join("")}</div>${d.address ? `<section><h2>Come say hello.</h2><p>${xml(d.address)}</p></section>` : ""}${hours.length ? `<section><h2>Our opening hours</h2><div class="hours">${hours.map((h, i) => `<div><span>${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]}</span><strong>${h.closed ? "Closed" : `${xml(h.open)} – ${xml(h.close)}`}</strong></div>`).join("")}</div></section>` : ""}`;
  }
  if (["business", "social"].includes(code.type)) {
    const links = JSON.parse(d.links || "[]");
    content += `<div class="actions">${links.map((l) => link(l.title, new URL(l.url).href, l.platform)).join("")}</div>`;
  }
  const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.7 system-ui,sans-serif;color:#293c32;background:${theme === "minimal" ? "#fff" : theme === "bold" ? accent : "#f0f3ec"};padding:35px 18px;min-height:100vh}main{max-width:480px;margin:auto;background:#fff;border:1px solid #e5eadd;border-radius:22px;overflow:hidden;box-shadow:0 15px 50px #193c2610}.page-cover{width:100%;height:190px;object-fit:cover;display:block}.body{padding:34px 30px;text-align:center}.identity,.portrait{width:80px;height:80px;display:grid;place-items:center;border-radius:${theme === "minimal" ? "50%" : "24px"};margin:0 auto 22px;background:${accent};color:#fff;font-size:27px;font-weight:600;object-fit:cover}.portrait{border:4px solid #fff;box-shadow:0 0 0 1px #e7ebdf}h1{font-size:30px;line-height:1.25;letter-spacing:-1px;margin:10px 0 12px;overflow-wrap:anywhere}h2{font-size:17px;letter-spacing:-.3px;margin:0 0 14px}.subheading{font-size:12px;letter-spacing:.5px;color:${accent};margin:0 0 14px}.description{color:#8b9782;font-size:13px;line-height:1.9;white-space:pre-line;margin:14px 0 25px;overflow-wrap:anywhere}.actions{display:grid;gap:10px;margin-top:19px}.action{display:flex;align-items:center;text-align:left;gap:12px;border:1px solid #e3e9dc;border-radius:12px;padding:15px;text-decoration:none;color:${accent};font-size:13px;font-weight:600}.action>span:nth-child(2){flex:1;overflow-wrap:anywhere}.action b{font-weight:400;color:#a5b096}.platform{width:23px;text-align:center;font-size:17px}.primary-action{display:block;padding:15px;background:${accent};color:#fff;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;margin:24px 0}.document{display:flex;gap:14px;align-items:center;text-align:left;background:#f5f7f0;border:1px solid #e7ecdf;border-radius:12px;padding:18px;margin-top:25px}.document-icon{display:grid;place-items:center;width:42px;height:50px;background:#fff;border:1px solid #dce5d0;border-radius:7px;color:${accent};font-size:11px;font-weight:700}.document>div{flex:1;min-width:0}.document strong{display:block;font-size:12px;overflow-wrap:anywhere}.document small{display:block;font-size:10px;color:#a0ad92;margin-top:4px}.preview-document{text-align:left;margin-top:25px;font-size:12px;color:#8f9d81}summary{cursor:pointer}iframe{width:100%;height:480px;border:1px solid #e2e8db;border-radius:8px;margin-top:15px}section{text-align:left;border-top:1px solid #e9eee1;margin-top:29px;padding-top:24px}section p{font-size:13px;color:#95a28a;white-space:pre-line;overflow-wrap:anywhere}.hours>div{display:flex;justify-content:space-between;padding:8px 0;font-size:11px;color:#95a28a}.hours strong{font-weight:500;color:#789069}footer{text-align:center;font-size:10px;color:#abb59f;padding:0 20px 25px}@media(max-width:420px){body{padding:20px 13px}.body{padding:27px 23px}h1{font-size:27px}}`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${xml(title)} · OpenQR</title><style>${css}</style></head><body><main>${cover}<div class="body">${avatar}<h1>${xml(title)}</h1>${code.type === "contact" && (d.company || d.jobTitle) ? `<p class="subheading">${xml([d.jobTitle, d.company].filter(Boolean).join(" · "))}</p>` : ""}<p class="description">${xml(d.description || "")}</p>${content}</div>${p.showBrand !== false ? "<footer>Made with OpenQR · A little code goes a long way.</footer>" : ""}</main></body></html>`;
}
export function unavailablePage(message) {
  return shell(
    "This connection is unavailable",
    `<div class="avatar">↗</div><h1>We can’t open this connection right now.</h1><p>${xml(message)}</p><small>Please contact the person who shared this QR code.</small>`,
  );
}
export function linksPage(code) {
  const d = code.data;
  const links = JSON.parse(d.links);
  return shell(
    d.title,
    `<div class="avatar">${xml(d.title.trim().slice(0, 2).toUpperCase())}</div><h1>${xml(d.title)}</h1><p>${xml(d.description || "")}</p><div class="links">${links.map((link) => `<a class="link" href="${xml(new URL(link.url).href)}" rel="noopener noreferrer nofollow"><span>${xml(link.title)}</span><span aria-hidden="true">↗</span></a>`).join("")}</div>`,
    code.color,
  );
}
