export type View = "workspace" | "inventory" | "toolbox" | "snippets" | "assistant" | "favorites" | "history" | "credentials";

export type HostStatus = "online" | "warning" | "offline";
export type ConnectionProtocol = "ssh" | "telnet" | "serial";

export interface Host {
  id: string;
  name: string;
  address: string;
  platform: string;
  site: string;
  status: HostStatus;
  latency: number | null;
  favorite?: boolean;
  port?: number;
  username?: string;
  credentialId?: string;
  tags?: string[];
  notes?: string;
  protocol?: ConnectionProtocol;
  baudRate?: number;
  demoProfile?: "cisco-iosxe" | "cisco-nxos";
}

export interface CredentialProfile {
  id: string;
  label: string;
  username: string;
}

export interface ConnectionHistory {
  id: string;
  deviceId: string;
  deviceName: string;
  protocol: ConnectionProtocol;
  address: string;
  startedAt: number;
  success: boolean;
  detail: string;
  elapsedMs?: number;
}

export interface TerminalLine {
  kind: "command" | "output" | "info" | "warning";
  text: string;
}

export interface Session {
  id: string;
  host: Host;
  lines: TerminalLine[];
  connected: boolean;
  connectionState?: "connecting" | "connected" | "closed" | "error";
}

export type AiProvider = "openai" | "gemini" | "demo";

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  vendor: string;
  category: string;
  description?: string;
}
