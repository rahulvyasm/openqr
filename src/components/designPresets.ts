import type { QRDesign } from "../lib";
import { defaultDesign } from "../../shared/qr.js";
export const presets = [
  {
    name: "Forest",
    color: "#285b48",
    design: { ...defaultDesign, module: "rounded", eye: "rounded" },
  },
  {
    name: "Midnight",
    color: "#202b50",
    design: { ...defaultDesign, module: "dots", eye: "rounded" },
  },
  {
    name: "Terracotta",
    color: "#924e3c",
    design: {
      ...defaultDesign,
      module: "rounded",
      frame: "border",
      caption: "MEET SOMETHING GOOD",
    },
  },
  {
    name: "Berry",
    color: "#733855",
    design: { ...defaultDesign, module: "dots", eye: "circle" },
  },
  { name: "Classic", color: "#1e2521", design: { ...defaultDesign } },
] as { name: string; color: string; design: QRDesign }[];
