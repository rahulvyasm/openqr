import QRCode from "qrcode";
import sharp from "sharp";
import { z } from "zod";
import {
  defaultDesign,
  renderSvg,
  contrastRatio,
  luminance,
} from "../shared/qr.js";

export const designSchema = z
  .object({
    background: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#ffffff"),
    module: z.enum(["square", "rounded", "dots"]).default("square"),
    eye: z.enum(["square", "rounded", "circle"]).default("square"),
    frame: z.enum(["none", "border", "banner"]).default("none"),
    caption: z.string().trim().max(32).default("SCAN ME"),
    logo: z.string().max(180000).default(""),
  })
  .default(defaultDesign);

export async function normalizeDesign(input, color) {
  const design = designSchema.parse(input);
  if (contrastRatio(color, design.background) < 4.5)
    throw new Error(
      "Use a darker QR color or a lighter background (at least 4.5:1 contrast).",
    );
  if (luminance(color) >= luminance(design.background))
    throw new Error(
      "Use dark QR modules on a lighter background for reliable scanning.",
    );
  if (design.logo) {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(design.logo))
      throw new Error("Use a PNG or JPEG logo smaller than 128 KB.");
    const bytes = Buffer.from(design.logo.split(",")[1], "base64");
    if (bytes.length > 131072)
      throw new Error("Use a PNG or JPEG logo smaller than 128 KB.");
    try {
      const image = sharp(bytes, {
        limitInputPixels: 4_000_000,
        animated: false,
      });
      const metadata = await image.metadata();
      if (!["png", "jpeg"].includes(metadata.format)) throw new Error();
      design.logo =
        "data:image/png;base64," +
        (
          await image
            .resize(128, 128, { fit: "inside", withoutEnlargement: true })
            .png()
            .toBuffer()
        ).toString("base64");
    } catch {
      throw new Error(
        "Use a valid PNG or JPEG logo with at most 4 million pixels.",
      );
    }
  }
  return design;
}
export function svgFor(content, design, color) {
  const qr = QRCode.create(content, { errorCorrectionLevel: "H" });
  return renderSvg(
    qr.modules.data,
    qr.modules.size,
    design,
    color,
    qr.modules.reservedBit,
  );
}
export async function imageFor(
  content,
  design,
  color,
  format = "png",
  size = 1024,
) {
  const svg = svgFor(content, design, color);
  return format === "svg"
    ? Buffer.from(svg)
    : sharp(Buffer.from(svg), { limitInputPixels: 25_000_000 })
        .resize({ width: size })
        .png()
        .toBuffer();
}
