import React from "react";
import ReactDOM from "react-dom/client";
// Must load before any service client sends a request.
import "./rateLimit";
import App from "./App";
import { DialogHost } from "./ui/dialog";
import { BusyBar } from "./ui/busy";
import { loadSnapshots } from "./snapshots";
import { applyToDocument } from "./i18n";
// Self-hosted, so reading the app makes no request to a font service.
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/outfit";
import "./styles.css";
import "./design.css";

applyToDocument();

// Root's dev bar adds a top margin to the body; full-height views subtract it.
const syncTopOffset = () =>
  document.documentElement.style.setProperty("--top-offset", getComputedStyle(document.body).marginTop);
syncTopOffset();
const offsetObserver = new MutationObserver(syncTopOffset);
offsetObserver.observe(document.head, { childList: true });
offsetObserver.observe(document.body, { attributes: true, childList: true });

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

// The saved copies first, so a reopened project shows at once.
loadSnapshots().then(() =>
  root.render(
    <React.StrictMode>
      <BusyBar />
      <App />
      <DialogHost />
    </React.StrictMode>,
  ),
);
