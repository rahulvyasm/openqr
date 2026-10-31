import QRCode from "qrcode";
import { renderSvg } from "../../shared/qr.js";
import {
  api,
  codeContent,
  demoHooks,
  saveBlob,
  type Code,
  type Asset,
} from "../lib";
import { svgToPng } from "../demo/png";
import { zipSync, strToU8 } from "fflate";

export async function prepareHosted() {
  demoHooks.downloadBatch = async (ids, format) => {
    if (!ids.length || ids.length > 100)
      throw new Error("Select between 1 and 100 codes.");
    const codes = await api<Code[]>("/codes");
    const files: Record<string, Uint8Array> = {};
    for (const id of ids) {
      const c = codes.find((c) => c.id === id);
      if (!c) throw new Error("A selected code is no longer available.");
      const qr = QRCode.create(codeContent(c), { errorCorrectionLevel: "H" });
      const svg = renderSvg(
        qr.modules.data,
        qr.modules.size,
        c.design,
        c.color,
        qr.modules.reservedBit,
      );
      files[`openqr-${c.slug}.${format}`] =
        format === "svg"
          ? strToU8(svg)
          : new Uint8Array(await (await svgToPng(svg, 1024)).arrayBuffer());
    }
    saveBlob(
      new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], {
        type: "application/zip",
      }),
      "openqr-codes.zip",
    );
  };
  // Supabase email verification arrives at the same site; tokens are exchanged
  // for HttpOnly cookies immediately, then removed from the address bar.
  const params = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  if (query.has("token_hash")) {
    const result = await api<{ recovery: boolean }>("/auth/verify-link", {
      token_hash: query.get("token_hash"),
      type: query.get("type") || "email",
    });
    history.replaceState(
      null,
      "",
      location.pathname + (result.recovery ? "#reset=hosted-recovery" : ""),
    );
  } else if (params.has("access_token")) {
    await api("/auth/complete", {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
    });
    history.replaceState(null, "", location.pathname);
    if (params.get("type") === "recovery")
      throw new Error(
        "Request a new password reset email. The recovery email template needs to use the secure token-hash link.",
      );
  }
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!link) return;
      const url = new URL(link.href, location.origin);
      if (url.origin !== location.origin) return;
      const match = url.pathname.match(
        /^\/api\/codes\/([a-f0-9-]+)\/download$/i,
      );
      if (!match) return;
      event.preventDefault();
      void (async () => {
        try {
          const c = await api<Code>(`/codes/${match[1]}`);
          const qr = QRCode.create(codeContent(c), {
            errorCorrectionLevel: "H",
          });
          const svg = renderSvg(
            qr.modules.data,
            qr.modules.size,
            c.design,
            c.color,
            qr.modules.reservedBit,
          );
          const format =
            url.searchParams.get("format") === "svg" ? "svg" : "png";
          const requested = Number(url.searchParams.get("size") || 1024);
          const size = [512, 1024, 2048].includes(requested) ? requested : 1024;
          const blob =
            format === "svg"
              ? new Blob([svg], { type: "image/svg+xml" })
              : await svgToPng(svg, size);
          saveBlob(blob, `openqr-${c.slug}.${format}`);
        } catch (e) {
          window.alert((e as Error).message);
        }
      })();
    },
    true,
  );
  demoHooks.upload = async (file, kind) => {
    let upload = file;
    if (kind === "logo") {
      const image = await createImageBitmap(file);
      const scale = Math.min(1, 128 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      upload = new File(
        [
          await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) =>
                b ? resolve(b) : reject(new Error("Could not read this logo.")),
              "image/png",
            ),
          ),
        ],
        file.name,
        { type: "image/png" },
      );
    }
    const res = await fetch("/api/assets" + (kind ? "?kind=logo" : ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: upload,
      credentials: "same-origin",
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Upload failed.");
    return result as Asset;
  };
}
