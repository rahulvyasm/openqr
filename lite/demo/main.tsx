import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/lite/styles";
import { installMockApi } from "../../src/demo/mockApi";
import App from "../../src/App";

installMockApi();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App urlRouting={false} />
    <div className="demo-bar" role="note">
      <b>LIVE DEMO</b>
      <span>Everything here works. Nothing is saved or sent.</span>
      <a className="ghost" href="/">Make a free QR</a>
      <a href="https://github.com/rahulvyasm/openqr" rel="noreferrer">Get OpenQR</a>
    </div>
  </React.StrictMode>,
);
