import { xml } from "../shared/qr.js";

function shell(title, body, color = "#285b48") {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${xml(title)} · OpenQR</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f7f1;color:#253b30;font:16px/1.7 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:30px 20px}main{width:100%;max-width:460px;text-align:center}h1{font-size:30px;line-height:1.3;letter-spacing:-1px;margin:18px 0 12px;overflow-wrap:anywhere}p{color:#73816b;white-space:pre-line;overflow-wrap:anywhere}.avatar{width:76px;height:76px;border-radius:25px;display:grid;place-items:center;color:white;background:${xml(color)};font-size:28px;font-weight:600;margin:0 auto}.links{display:grid;gap:12px;margin:30px 0}a.link{padding:16px 20px;border:1px solid #dfe7d7;border-radius:12px;background:#fff;color:${xml(color)};text-decoration:none;font-size:15px;font-weight:600;display:flex;justify-content:space-between;gap:15px;text-align:left;overflow-wrap:anywhere}a.link:hover{border-color:${xml(color)}}footer{font-size:12px;color:#9eaa95;margin-top:40px}small{font-size:12px;color:#95a189}</style></head><body><main>${body}<footer>Created with OpenQR</footer></main></body></html>`;
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
