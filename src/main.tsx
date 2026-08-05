import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features.css";
import "./interaction.css";
import "./themes.css";
import "./terminal.css";
import "./topology.css";
import "./readability.css";
import "./engineer-notes.css";
import "./device-discovery.css";
import "@xterm/xterm/css/xterm.css";
import { createId } from "./id";

if (typeof crypto.randomUUID !== "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => createId("uuid").slice(5),
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
