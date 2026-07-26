import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features.css";
import "./interaction.css";
import "./themes.css";
import "./readability.css";
import "./terminal.css";
import "./topology.css";
import "@xterm/xterm/css/xterm.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
