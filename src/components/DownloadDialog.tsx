import { useState } from "react";
import { Download, FileImage, FileCode2, CheckCircle2 } from "lucide-react";
import type { Code } from "../lib";
import Modal from "./Modal";
import QrImage from "./QrImage";
import { codeContent } from "../lib";
export default function DownloadDialog({
  code,
  onClose,
}: {
  code: Code;
  onClose: () => void;
}) {
  const [format, setFormat] = useState("png"),
    [size, setSize] = useState(1024);
  return (
    <Modal title="Ready for the world." onClose={onClose}>
      <div className="download-content">
        <div className="download-preview">
          <QrImage
            content={codeContent(code)}
            color={code.color}
            design={code.design}
            size={210}
          />
        </div>
        <h3>{code.name}</h3>
        <p>Download your final, scannable code.</p>
        <div className="format-options">
          <button
            className={format === "png" ? "selected" : ""}
            onClick={() => setFormat("png")}
          >
            <FileImage size={20} />
            <strong>PNG</strong>
            <span>Print & digital</span>
          </button>
          <button
            className={format === "svg" ? "selected" : ""}
            onClick={() => setFormat("svg")}
          >
            <FileCode2 size={20} />
            <strong>SVG</strong>
            <span>Scales to any size</span>
          </button>
        </div>
        {format === "png" && (
          <label>
            Image width
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              <option value={512}>512 px · Everyday sharing</option>
              <option value={1024}>1024 px · High resolution</option>
              <option value={2048}>2048 px · Large prints</option>
            </select>
          </label>
        )}
        <span className="download-quality">
          <CheckCircle2 size={14} />
          High error correction. Your saved design included.
        </span>
        <a
          href={`/api/codes/${code.id}/download?format=${format}&size=${size}`}
          className="button primary full"
        >
          <Download size={16} />
          Download {format.toUpperCase()}
        </a>
      </div>
    </Modal>
  );
}
