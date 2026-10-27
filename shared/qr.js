// Shared vector renderer keeps the preview, PNG, SVG and ZIP exports consistent.
export const defaultDesign = {
  background: "#ffffff",
  module: "square",
  eye: "square",
  frame: "none",
  caption: "SCAN ME",
  logo: "",
  innerEye: "follow",
  outerColor: "",
  innerColor: "",
  corners: {},
  captionPosition: "bottom",
  captionSize: "normal",
  logoScale: 0.17,
  mark: "none",
};
export function xml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
export function contrastRatio(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function luminance(hex) {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((h) => {
      const n = parseInt(h, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function renderSvg(
  matrix,
  count,
  design = {},
  color = "#163f32",
  reserved = [],
) {
  const d = { ...defaultDesign, ...design },
    side = count + 8,
    framed = d.frame !== "none",
    height = side + (framed ? 7 : 0),
    offset = framed && d.captionPosition === "top" ? 7 : 0;
  const eyes = [
      [0, 0, "tl"],
      [count - 7, 0, "tr"],
      [0, count - 7, "bl"],
    ],
    dark = (x, y) =>
      x >= 0 && y >= 0 && x < count && y < count && matrix[y * count + x];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${Math.round((1024 * height) / side)}" viewBox="0 0 ${side} ${height}"><rect width="${side}" height="${height}" fill="${xml(d.background)}"/><g transform="translate(0 ${offset})">`,
  ];
  const cell = (x, y, r) => {
    const [tl, tr, br, bl] = r;
    return `<path d="M${x + tl},${y}H${x + 1 - tr}Q${x + 1},${y} ${x + 1},${y + tr}V${y + 1 - br}Q${x + 1},${y + 1} ${x + 1 - br},${y + 1}H${x + bl}Q${x},${y + 1} ${x},${y + 1 - bl}V${y + tl}Q${x},${y} ${x + tl},${y}Z" fill="${xml(color)}"/>`;
  };
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++) {
      if (
        !dark(x, y) ||
        eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7)
      )
        continue;
      const px = x + 4,
        py = y + 4,
        critical = reserved[y * count + x];
      if (d.module === "dots" && !critical)
        parts.push(
          `<circle cx="${px + 0.5}" cy="${py + 0.5}" r=".5" fill="${xml(color)}"/>`,
        );
      else if (d.module === "connected" && !critical)
        parts.push(
          cell(px, py, [
            !dark(x - 1, y) && !dark(x, y - 1) ? 0.45 : 0,
            !dark(x + 1, y) && !dark(x, y - 1) ? 0.45 : 0,
            !dark(x + 1, y) && !dark(x, y + 1) ? 0.45 : 0,
            !dark(x - 1, y) && !dark(x, y + 1) ? 0.45 : 0,
          ]),
        );
      else {
        const g = !critical && d.module === "gapped" ? 0.05 : 0,
          v = !critical && d.module === "vertical" ? 0.06 : 0,
          h = !critical && d.module === "horizontal" ? 0.06 : 0;
        parts.push(
          `<rect x="${px + g + v}" y="${py + g + h}" width="${1 - 2 * (g + v)}" height="${1 - 2 * (g + h)}" rx="${!critical && ["rounded", "vertical", "horizontal"].includes(d.module) ? ".28" : "0"}" fill="${xml(color)}"/>`,
        );
      }
    }
  const shape = (x, y, width, style, fill) =>
    style === "leaf"
      ? `<path d="M${x},${y}H${x + width * 0.7}Q${x + width},${y} ${x + width},${y + width * 0.3}V${y + width}H${x + width * 0.3}Q${x},${y + width} ${x},${y + width * 0.7}Z" fill="${xml(fill)}"/>`
      : `<rect x="${x}" y="${y}" width="${width}" height="${width}" rx="${style === "circle" ? width * 0.4 : style === "rounded" ? width * 0.2 : 0}" fill="${xml(fill)}"/>`;
  for (const [x, y, key] of eyes) {
    const c = d.corners?.[key] || {},
      outer = c.outer || d.eye,
      inner = c.inner || (d.innerEye === "follow" ? outer : d.innerEye),
      oc = c.outerColor || d.outerColor || color,
      ic = c.innerColor || d.innerColor || color;
    parts.push(
      shape(x + 4, y + 4, 7, outer, oc),
      shape(x + 5, y + 5, 5, outer, d.background),
      shape(x + 6, y + 6, 3, inner, ic),
    );
  }
  const hasLogo =
    d.logo && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(d.logo);
  if (hasLogo || d.mark !== "none") {
    const size = count * d.logoScale,
      pos = (side - size) / 2;
    parts.push(
      `<rect x="${pos - 0.8}" y="${pos - 0.8}" width="${size + 1.6}" height="${size + 1.6}" rx=".7" fill="${xml(d.background)}"/>`,
    );
    if (hasLogo)
      parts.push(
        `<image href="${d.logo}" x="${pos}" y="${pos}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    else {
      const marks = {
        globe:
          '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
        arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
        heart:
          '<path d="M12 20S2 14 2 8c0-5 7-7 10-1 3-6 10-4 10 1 0 6-10 12-10 12Z"/>',
        scan: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M5 12h14"/>',
      };
      parts.push(
        `<g transform="translate(${pos} ${pos}) scale(${size / 24})" fill="none" stroke="${xml(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${marks[d.mark] || marks.scan}</g>`,
      );
    }
  }
  parts.push("</g>");
  if (framed) {
    const y = d.captionPosition === "top" ? 0 : side,
      filled = ["banner", "pill", "speech"].includes(d.frame);
    if (["border", "ticket", "stamp"].includes(d.frame))
      parts.push(
        `<rect x=".4" y=".4" width="${side - 0.8}" height="${height - 0.8}" rx="${d.frame === "stamp" ? ".5" : "2"}" fill="none" stroke="${xml(color)}" stroke-width=".45" ${d.frame === "stamp" ? 'stroke-dasharray=".7 .7"' : ""}/>`,
      );
    if (d.frame === "ticket")
      for (const x of [0, side])
        parts.push(
          `<circle cx="${x}" cy="${height / 2}" r="1.2" fill="${xml(d.background)}" stroke="${xml(color)}" stroke-width=".4"/>`,
        );
    if (filled)
      parts.push(
        `<rect x="${d.frame === "pill" ? 2 : 0.4}" y="${y + 0.4}" width="${side - (d.frame === "pill" ? 4 : 0.8)}" height="6.2" rx="${d.frame === "pill" ? 3 : "1"}" fill="${xml(color)}"/>`,
      );
    if (d.frame === "speech")
      parts.push(
        `<path d="M${side / 2 - 1} ${y + (y ? ".5" : "6.5")}l1 ${y ? -1 : 1} 1 ${y ? 1 : -1}" fill="${xml(color)}"/>`,
      );
    const factor = { small: 0.8, normal: 1, large: 1.15 }[d.captionSize] || 1,
      font = Math.min(
        2.2 * factor,
        (side - 6) / Math.max(1, d.caption.length * 0.65),
      );
    parts.push(
      `<text x="${side / 2}" y="${y + 4.3}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${font}" font-weight="bold" fill="${xml(filled ? d.background : color)}">${xml(d.caption)}</text>`,
    );
  }
  return parts.join("") + "</svg>";
}
