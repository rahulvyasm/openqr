import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
const PublicPdfViewer = React.lazy(
  () => import("./components/PublicPdfViewer"),
);

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
