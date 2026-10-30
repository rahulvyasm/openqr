// Draws an SVG onto a white canvas and returns it as a PNG, entirely in the browser.
export function svgToPng(svg: string, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = img.naturalHeight / img.naturalWidth || 1;
      canvas.width = size;
      canvas.height = Math.round(size * ratio);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image."))), "image/png");
    };
    img.onerror = () => reject(new Error("Could not create the image."));
    img.src = url;
  });
}
