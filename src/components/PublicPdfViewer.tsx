import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-viewer.css";
GlobalWorkerOptions.workerSrc = workerUrl;
type Metadata = {
  title: string;
  name: string;
  pages: number;
  downloadUrl: string;
};
export default function PublicPdfViewer() {
  const [meta, setMeta] = useState<Metadata | null>(null),
    [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [width, setWidth] = useState(800),
    [text, setText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [, , slug, id] = location.pathname.split("/"),
    ticket = new URLSearchParams(location.search).get("ticket") || "",
    base = `/r/${encodeURIComponent(slug || "")}`;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width - 32)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let task: ReturnType<typeof getDocument> | undefined;
    async function load() {
      try {
        const response = await fetch(
          `${base}/document/${encodeURIComponent(id || "")}?ticket=${encodeURIComponent(ticket)}`,
          { signal: controller.signal },
        );
        const info = await response.json();
        if (!response.ok)
          throw new Error(info.error || "This document is unavailable.");
        if (cancelled) return;
        setMeta(info);
        document.title = `${info.title} · OpenQR`;
        const pdf = await fetch(info.downloadUrl, {
          signal: controller.signal,
        });
        if (!pdf.ok)
          throw new Error(
            "This document is no longer available. Open the QR page again.",
          );
        const bytes = await pdf.arrayBuffer();
        if (cancelled) return;
        task = getDocument({
          data: bytes,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          enableXfa: false,
          maxImageSize: 16_000_000,
          canvasMaxAreaInBytes: 32_000_000,
        });
        const loaded = await task.promise;
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      void task?.destroy();
    };
  }, [base, id, ticket]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false,
      render: RenderTask | undefined;
    const element = canvas.current;
    setBusy(true);
    setText("");
    async function draw() {
      try {
        const current = await doc!.getPage(page);
        if (cancelled) return;
        const original = current.getViewport({ scale: 1 }),
          scale = (Math.min(width, 900) / original.width) * zoom,
          viewport = current.getViewport({ scale });
        const ratio = Math.min(
          devicePixelRatio || 1,
          2,
          Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
        );
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        render = current.render({
          canvas: element,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
          annotationMode: 0,
        });
        await render.promise;
        const content = await current.getTextContent();
        if (!cancelled) {
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
          setBusy(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    }
    void draw();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page, width, zoom]);
  return (
    <main className="pdf-viewer">
      <header className="pdf-toolbar">
        <a href={base} className="pdf-back" aria-label="Back to QR page">
          <ArrowLeft size={18} />
        </a>
        <div className="pdf-title">
          <strong>{meta?.title || "Your document"}</strong>
          <small>{meta?.name || "OpenQR document viewer"}</small>
        </div>
        {meta && (
          <a className="pdf-download" href={meta.downloadUrl}>
            <Download size={16} />
            <span>Download</span>
          </a>
        )}
      </header>
      <nav className="pdf-controls" aria-label="Document controls">
        <button
          disabled={!doc || page <= 1 || busy}
          onClick={() => setPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={17} />
        </button>
        <span aria-live="polite">
          Page {page} of {doc?.numPages || meta?.pages || "…"}
        </span>
        <button
          disabled={!doc || page >= doc.numPages || busy}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={17} />
        </button>
        <i />
        <button
          disabled={!doc || zoom <= 0.75 || busy}
          onClick={() => setZoom(Math.max(0.75, zoom - 0.25))}
          aria-label="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          disabled={!doc || zoom >= 2 || busy}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
          aria-label="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
      </nav>
      <div className="pdf-canvas-wrap" ref={container}>
        {error ? (
          <div className="pdf-message" role="alert">
            <h1>We can’t open this document.</h1>
            <p>{error}</p>
            <a href={base}>Return to the QR page</a>
          </div>
        ) : (
          <>
            {busy && (
              <div className="pdf-loading" role="status">
                <Loader2 size={20} className="spin" />
                Loading document…
              </div>
            )}
            <canvas
              ref={canvas}
              aria-label={`Document page ${page}`}
              style={{ visibility: doc ? "visible" : "hidden" }}
            />
            <details className="pdf-text">
              <summary>Read page text</summary>
              <p>{text || "This page has no extractable text."}</p>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
