export type QRDesign = {
  background: string;
  module: "square" | "rounded" | "dots";
  eye: "square" | "rounded" | "circle";
  frame: "none" | "border" | "banner";
  caption: string;
  logo: string;
};
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
