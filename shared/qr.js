// Shared vector renderer keeps the preview, PNG, SVG and ZIP exports consistent.
export const defaultDesign = {
  background: "#ffffff",
  module: "square",
  eye: "square",
  frame: "none",
  caption: "SCAN ME",
  logo: "",
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
  const d = { ...defaultDesign, ...design };
  const quiet = 4,
    side = count + quiet * 2,
    framed = d.frame !== "none",
    height = side + (framed ? 7 : 0);
  const eyes = [
    [0, 0],
    [count - 7, 0],
    [0, count - 7],
  ];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${Math.round((1024 * height) / side)}" viewBox="0 0 ${side} ${height}"><rect width="${side}" height="${height}" fill="${xml(d.background)}"/>`,
  ];
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++) {
      if (
        !matrix[y * count + x] ||
        eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7)
      )
        continue;
      const px = x + quiet,
        py = y + quiet;
      if (d.module === "dots" && !reserved[y * count + x])
        parts.push(
          `<circle cx="${px + 0.5}" cy="${py + 0.5}" r="0.5" fill="${xml(color)}"/>`,
        );
      else
        parts.push(
          `<rect x="${px}" y="${py}" width="1" height="1" rx="${d.module === "rounded" && !reserved[y * count + x] ? ".28" : "0"}" fill="${xml(color)}"/>`,
        );
    }
  for (const [x, y] of eyes) {
    const px = x + quiet,
      py = y + quiet;
    for (const [offset, width, fill] of [
      [0, 7, color],
      [1, 5, d.background],
      [2, 3, color],
    ]) {
      const radius =
        d.eye === "circle" ? width / 2 : d.eye === "rounded" ? width * 0.2 : 0;
      parts.push(
        `<rect x="${px + offset}" y="${py + offset}" width="${width}" height="${width}" rx="${radius}" fill="${xml(fill)}"/>`,
      );
    }
  }
  if (
    d.logo &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(d.logo)
  ) {
    const logoSize = count * 0.17,
      pos = (side - logoSize) / 2,
      padding = 0.8;
    parts.push(
      `<rect x="${pos - padding}" y="${pos - padding}" width="${logoSize + padding * 2}" height="${logoSize + padding * 2}" rx=".7" fill="${xml(d.background)}"/><image href="${d.logo}" x="${pos}" y="${pos}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  if (framed) {
    if (d.frame === "border")
      parts.push(
        `<rect x=".4" y=".4" width="${side - 0.8}" height="${height - 0.8}" rx="2" fill="none" stroke="${xml(color)}" stroke-width=".45"/>`,
      );
    if (d.frame === "banner")
      parts.push(
        `<rect x=".4" y="${side}" width="${side - 0.8}" height="6.6" rx="1" fill="${xml(color)}"/>`,
      );
    const fontSize = Math.min(
      2.2,
      (side - 6) / Math.max(1, d.caption.length * 0.65),
    );
    parts.push(
      `<text x="${side / 2}" y="${side + 4.3}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="${xml(d.frame === "banner" ? d.background : color)}">${xml(d.caption)}</text>`,
    );
  }
  return parts.join("") + "</svg>";
}
