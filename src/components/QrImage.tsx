import { memo, useMemo } from "react";
import QRCode from "qrcode";
import { renderSvg } from "../../shared/qr.js";
import type { QRDesign } from "../lib";
export default memo(function QrImage({
  content,
  color = "#163f32",
  design,
  size = 128,
}: {
  content: string;
  color?: string;
  design?: Partial<QRDesign>;
  size?: number;
}) {
  const src = useMemo(() => {
    try {
      const qr = QRCode.create(content || "OpenQR", {
        errorCorrectionLevel: "H",
      });
      return (
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          renderSvg(
            qr.modules.data,
            qr.modules.size,
            design,
            color,
            qr.modules.reservedBit,
          ),
        )
      );
    } catch {
      return null;
    }
  }, [content, color, design]);
  return src ? (
    <img
      src={src}
      width={size}
      height={size}
      style={{ objectFit: "contain" }}
      alt="Scannable QR code"
    />
  ) : (
    <div className="qr-error">Content is too long for a QR code.</div>
  );
});
