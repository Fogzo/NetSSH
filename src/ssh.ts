import { invoke } from "@tauri-apps/api/core";

import type { ConnectionProtocol } from "./types";

export interface ConnectionPreflightResult {
  reachable: boolean;
  banner: string | null;
  elapsedMs: number;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function preflightConnection(protocol: ConnectionProtocol, target: string, port?: number, baudRate?: number): Promise<ConnectionPreflightResult> {
  if (!isTauri()) {
    const banner = protocol === "ssh" ? "SSH-2.0-NetSSH_Browser_Preview" : protocol === "telnet" ? "Telnet service reachable (browser preview)" : `Serial port available at ${baudRate ?? 9600} baud (browser preview)`;
    return { reachable: true, banner, elapsedMs: 12 };
  }
  return invoke<ConnectionPreflightResult>("connection_preflight", { protocol, target, port, baudRate });
}
