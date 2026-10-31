import { z } from "zod";
import { defaultDesign } from "./qr.js";
const finder = z.enum(["square", "rounded", "circle", "leaf"]);
const optionalColor = z.union([
  z.literal(""),
  z.string().regex(/^#[0-9a-f]{6}$/i),
]);
export const designSchema = z
  .object({
    background: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#ffffff"),
    module: z
      .enum([
        "square",
        "rounded",
        "dots",
        "gapped",
        "vertical",
        "horizontal",
        "connected",
      ])
      .default("square"),
    eye: finder.default("square"),
    frame: z
      .enum(["none", "border", "banner", "pill", "speech", "ticket", "stamp"])
      .default("none"),
    caption: z.string().trim().max(32).default("SCAN ME"),
    logo: z.string().max(180000).default(""),
    innerEye: z.union([finder, z.literal("follow")]).default("follow"),
    outerColor: optionalColor.default(""),
    innerColor: optionalColor.default(""),
    corners: z
      .object({
        tl: z
          .object({
            outer: finder.optional(),
            inner: finder.optional(),
            outerColor: optionalColor.optional(),
            innerColor: optionalColor.optional(),
          })
          .optional(),
        tr: z
          .object({
            outer: finder.optional(),
            inner: finder.optional(),
            outerColor: optionalColor.optional(),
            innerColor: optionalColor.optional(),
          })
          .optional(),
        bl: z
          .object({
            outer: finder.optional(),
            inner: finder.optional(),
            outerColor: optionalColor.optional(),
            innerColor: optionalColor.optional(),
          })
          .optional(),
      })
      .default({}),
    captionPosition: z.enum(["top", "bottom"]).default("bottom"),
    captionSize: z.enum(["small", "normal", "large"]).default("normal"),
    logoScale: z.number().min(0.12).max(0.18).default(0.17),
    mark: z.enum(["none", "globe", "arrow", "heart", "scan"]).default("none"),
  })
  .default(defaultDesign);
