import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
const PublicPdfViewer = React.lazy(
  () => import("./components/PublicPdfViewer"),
);

async function mount() {
  if (import.meta.env.VITE_HOSTED === "true") {
    try { await (await import('./hosted/browser')).prepareHosted(); }
    catch (e) { document.getElementById('root')!.textContent=(e as Error).message;return; }
  }
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname.startsWith("/view/") ? (
      <React.Suspense fallback={<p>Loading document…</p>}>
        <PublicPdfViewer />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
}
void mount();
