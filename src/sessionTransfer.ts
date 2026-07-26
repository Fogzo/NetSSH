import type { ConnectionProtocol, CredentialProfile, Host } from "./types";

export type SessionImportFormat = "auto" | "netssh" | "putty" | "mobaxterm" | "csv";

export interface ImportedSession {
  name: string;
  address: string;
  protocol: ConnectionProtocol;
  port?: number;
  baudRate?: number;
  username?: string;
  credentialLabel?: string;
  site?: string;
  platform?: string;
  tags?: string[];
}

export interface SessionImportResult {
  sessions: ImportedSession[];
  warnings: string[];
  format: Exclude<SessionImportFormat, "auto">;
}

interface NetSshExport {
  product: "NetSSH";
  version: 1;
  exportedAt: string;
  devices: Host[];
  credentialProfiles: CredentialProfile[];
  security: { passwordsIncluded: false };
}

const decodeName = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

const cleanRegistryValue = (value: string) => value.replace(/^"|"$/g, "").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");

export function decodeSessionFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) { swapped[index - 2] = bytes[index + 1]; swapped[index - 1] = bytes[index]; }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder().decode(bytes);
}

function parsePutty(content: string): SessionImportResult {
  const sessions: ImportedSession[] = [];
  const warnings: string[] = [];
  const sections = content.split(/(?=\r?\n?\[HKEY_[^\]]+\])/i);
  for (const section of sections) {
    const heading = section.match(/\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\([^\]]+)\]/i);
    if (!heading) continue;
    const name = decodeName(heading[1]);
    if (name.toLowerCase() === "default settings") continue;
    const values = Object.fromEntries([...section.matchAll(/^"([^"]+)"=(.+)$/gm)].map((match) => [match[1], match[2].trim()]));
    const protocolValue = cleanRegistryValue(values.Protocol ?? '"ssh"').toLowerCase();
    const protocol: ConnectionProtocol = protocolValue === "telnet" ? "telnet" : protocolValue === "serial" ? "serial" : "ssh";
    const address = cleanRegistryValue(protocol === "serial" ? values.SerialLine ?? "" : values.HostName ?? "");
    if (!address) { warnings.push(`Skipped PuTTY session “${name}” because it has no target.`); continue; }
    const portRaw = values.PortNumber ?? "";
    const port = portRaw.startsWith("dword:") ? Number.parseInt(portRaw.slice(6), 16) : Number(cleanRegistryValue(portRaw));
    const speedRaw = values.SerialSpeed ?? "";
    const baudRate = speedRaw.startsWith("dword:") ? Number.parseInt(speedRaw.slice(6), 16) : Number(cleanRegistryValue(speedRaw));
    sessions.push({ name, address, protocol, port: protocol === "serial" ? undefined : Number.isInteger(port) ? port : protocol === "telnet" ? 23 : 22, baudRate: protocol === "serial" && Number.isInteger(baudRate) ? baudRate : undefined, username: cleanRegistryValue(values.UserName ?? "") || undefined, site: "Imported / PuTTY", platform: "Other", tags: ["imported", "putty"] });
  }
  if (!sessions.length && !warnings.length) warnings.push("No PuTTY saved sessions were found. Export HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions as a .reg file.");
  return { sessions, warnings, format: "putty" };
}

function parseMobaXterm(content: string): SessionImportResult {
  const sessions: ImportedSession[] = [];
  const warnings: string[] = [];
  let folder = "Imported / MobaXterm";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("[") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (/^SubRep$/i.test(key)) { folder = value ? `MobaXterm / ${value.replace(/\\/g, " / ")}` : "Imported / MobaXterm"; continue; }
    if (/^(ImgNum|Icon|SortIndex)$/i.test(key) || !value.startsWith("#")) continue;
    const fields = value.split("%");
    const marker = fields[0];
    const address = fields[1]?.trim();
    if (!address) { warnings.push(`Skipped MobaXterm session “${key}” because its target could not be read.`); continue; }
    const port = Number(fields[2]);
    const username = fields[3]?.trim() || undefined;
    const serial = /^#115#/i.test(marker);
    const protocol: ConnectionProtocol = serial ? "serial" : /^#98#/i.test(marker) || port === 23 ? "telnet" : "ssh";
    sessions.push({ name: key, address, protocol, port: protocol === "serial" ? undefined : Number.isInteger(port) && port > 0 ? port : protocol === "telnet" ? 23 : 22, baudRate: protocol === "serial" && Number.isInteger(port) ? port : undefined, username, site: folder, platform: "Other", tags: ["imported", "mobaxterm"] });
  }
  if (!sessions.length && !warnings.length) warnings.push("No MobaXterm bookmarks were found. Use an exported sessions file or MobaXterm.ini.");
  return { sessions, warnings, format: "mobaxterm" };
}

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
};

function parseCsv(content: string): SessionImportResult {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines.shift() ?? "").map((header) => header.toLowerCase());
  const sessions = lines.flatMap((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (!row.name || !row.address) return [];
    const protocol: ConnectionProtocol = row.protocol === "telnet" ? "telnet" : row.protocol === "serial" ? "serial" : "ssh";
    return [{ name: row.name, address: row.address, protocol, port: protocol === "serial" ? undefined : Number(row.port) || (protocol === "telnet" ? 23 : 22), baudRate: protocol === "serial" ? Number(row.baudrate) || 9600 : undefined, username: row.username || undefined, site: row.site || "Imported", platform: row.platform || "Other", tags: row.tags ? row.tags.split(";").map((tag) => tag.trim()).filter(Boolean) : ["imported"] }];
  });
  return { sessions, warnings: sessions.length ? [] : ["No valid CSV rows were found."], format: "csv" };
}

function parseNetSsh(content: string): SessionImportResult {
  const parsed = JSON.parse(content) as Partial<NetSshExport> | Host[];
  const devices = Array.isArray(parsed) ? parsed : parsed.devices ?? [];
  const profiles = Array.isArray(parsed) ? [] : parsed.credentialProfiles ?? [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const sessions = devices.map((host) => ({ name: host.name, address: host.address, protocol: host.protocol ?? "ssh", port: host.port, baudRate: host.baudRate, username: profileMap.get(host.credentialId ?? "")?.username ?? host.username, credentialLabel: profileMap.get(host.credentialId ?? "")?.label, site: host.site, platform: host.platform, tags: host.tags }));
  return { sessions, warnings: ["Passwords and enable passwords are intentionally excluded and must be entered again."], format: "netssh" };
}

export function parseSessionImport(content: string, requested: SessionImportFormat = "auto"): SessionImportResult {
  const trimmed = content.trim().replace(/^\uFEFF/, "");
  const format = requested === "auto" ? /SimonTatham\\PuTTY\\Sessions/i.test(trimmed) ? "putty" : /\[(?:Bookmarks|Bookmarks_\d+)\]/i.test(trimmed) || /=#\d+#/.test(trimmed) ? "mobaxterm" : trimmed.startsWith("{") || trimmed.startsWith("[") ? "netssh" : "csv" : requested;
  if (format === "putty") return parsePutty(trimmed);
  if (format === "mobaxterm") return parseMobaXterm(trimmed);
  if (format === "csv") return parseCsv(trimmed);
  return parseNetSsh(trimmed);
}

export function createNetSshExport(hosts: Host[], credentialProfiles: CredentialProfile[]): string {
  const payload: NetSshExport = { product: "NetSSH", version: 1, exportedAt: new Date().toISOString(), devices: hosts, credentialProfiles, security: { passwordsIncluded: false } };
  return JSON.stringify(payload, null, 2);
}

const csvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function createSessionCsv(hosts: Host[], credentialProfiles: CredentialProfile[]): string {
  const profileMap = new Map(credentialProfiles.map((profile) => [profile.id, profile]));
  const rows = hosts.map((host) => [host.name, host.address, host.protocol ?? "ssh", host.protocol === "serial" ? "" : host.port ?? ((host.protocol ?? "ssh") === "telnet" ? 23 : 22), host.baudRate ?? "", profileMap.get(host.credentialId ?? "")?.username ?? host.username ?? "", host.site, host.platform, (host.tags ?? []).join(";")]);
  return [["name", "address", "protocol", "port", "baudRate", "username", "site", "platform", "tags"], ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
}
