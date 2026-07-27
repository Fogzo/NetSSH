import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ConnectionProtocol } from "./types";

export interface ConnectionPreflightResult {
  reachable: boolean;
  banner: string | null;
  elapsedMs: number;
}

export interface TerminalEvent {
  sessionId: string;
  kind: "connected" | "data" | "info" | "error" | "closed";
  data: string;
}

export async function probeSshHostKey(target: string, port: number): Promise<{ fingerprint: string; legacyRsa: boolean }> {
  return invoke<{ fingerprint: string; legacyRsa: boolean }>("probe_ssh_host_key", { target, port });
}

export async function startTerminalSession(options: {
  sessionId: string;
  deviceId: string;
  credentialId?: string;
  protocol: ConnectionProtocol;
  target: string;
  port?: number;
  baudRate?: number;
  username?: string;
  password?: string;
  trustedFingerprint?: string;
  legacyRsa?: boolean;
  columns?: number;
  rows?: number;
}): Promise<void> {
  await invoke("start_terminal_session", {
    ...options,
    trustedFingerprint: options.trustedFingerprint ?? null,
    legacyRsa: options.legacyRsa ?? false,
    credentialId: options.credentialId ?? null,
    port: options.port ?? null,
    baudRate: options.baudRate ?? null,
    username: options.username ?? "",
    password: options.password ?? null,
    columns: options.columns ?? 120,
    rows: options.rows ?? 36,
  });
}

export async function writeTerminal(sessionId: string, data: string): Promise<void> {
  if (!isTauri()) throw new Error("Interactive terminals are available in the desktop app");
  await invoke("write_terminal", { sessionId, data });
}

export async function writeTerminalEnablePassword(sessionId: string, credentialId: string): Promise<void> {
  if (!isTauri()) throw new Error("Enable passwords are available in the desktop app");
  await invoke("write_terminal_enable_password", { sessionId, credentialId });
}

export async function closeTerminal(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_terminal", { sessionId });
}

export async function resizeTerminal(sessionId: string, columns: number, rows: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("resize_terminal", { sessionId, columns, rows });
}

export async function listenForTerminalEvents(handler: (event: TerminalEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<TerminalEvent>("terminal-event", (event) => handler(event.payload));
}

export async function preflightConnection(protocol: ConnectionProtocol, target: string, port?: number, baudRate?: number): Promise<ConnectionPreflightResult> {
  if (!isTauri()) {
    const banner = protocol === "ssh" ? "SSH-2.0-NetSSH_Browser_Preview" : protocol === "telnet" ? "Telnet service reachable (browser preview)" : `Serial port available at ${baudRate ?? 9600} baud (browser preview)`;
    return { reachable: true, banner, elapsedMs: 12 };
  }
  return invoke<ConnectionPreflightResult>("connection_preflight", { protocol, target, port, baudRate });
}
