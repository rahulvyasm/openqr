import React from "react";
import { createRoot } from "react-dom/client";
import "../src/lite/styles";
import { installMockApi } from "../src/demo/mockApi";
import LiteApp from "../src/lite/LiteApp";

// Saved looks and logo uploads in the designer use the same in-browser stand-in as the demo.
installMockApi();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LiteApp />
  </React.StrictMode>,
);
