export type QRDesign = {
  background: string;
  module:
    | "square"
    | "rounded"
    | "dots"
    | "gapped"
    | "vertical"
    | "horizontal"
    | "connected";
  eye: FinderStyle;
  frame: "none" | "border" | "banner" | "pill" | "speech" | "ticket" | "stamp";
  caption: string;
  logo: string;
  innerEye: FinderStyle | "follow";
  outerColor: string;
  innerColor: string;
  corners: Partial<
    Record<
      "tl" | "tr" | "bl",
      {
        outer?: FinderStyle;
        inner?: FinderStyle;
        outerColor?: string;
        innerColor?: string;
      }
    >
  >;
  captionPosition: "top" | "bottom";
  captionSize: "small" | "normal" | "large";
  logoScale: number;
  mark: "none" | "globe" | "arrow" | "heart" | "scan";
};
export type FinderStyle = "square" | "rounded" | "circle" | "leaf";
export const defaultDesign: QRDesign;
export function xml(value?: unknown): string;
export function contrastRatio(a: string, b: string): number;
export function luminance(hex: string): number;
export function renderSvg(
  matrix: Uint8Array | number[],
  count: number,
  design?: Partial<QRDesign>,
  color?: string,
  reserved?: Uint8Array | number[],
): string;
