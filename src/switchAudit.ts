import { invoke } from "@tauri-apps/api/core";
import { probeSshHostKey } from "./ssh";
import type { CredentialProfile, Host } from "./types";

export interface LivePortAuditResult {
  port: string;
  description: string;
  interfaceStatus: string;
  lineProtocol: string;
  lastInput: string;
  inactiveWeeks: number | null;
  protected: boolean;
  candidate: boolean;
  reason: string;
}

export interface LiveSwitchAudit {
  deviceName: string;
  address: string;
  checkedAt: number;
  minimumWeeks: number;
  elapsedMs: number;
  ports: LivePortAuditResult[];
  rawOutput: string;
}

const physicalInterface = /^(?:FastEthernet|GigabitEthernet|TenGigabitEthernet|TwentyFiveGigE|FortyGigabitEthernet|HundredGigE|Ethernet|Fa\d|Gi\d|Te\d|Eth\d)/i;
const protectedDescription = /(?:uplink|trunk|firewall|router|server|access point|\bap[-_ ]|wireless|wan|port-channel|peer-link|stack|vss|vpc)/i;

export function inactivityWeeks(value: string): number | null {
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  if (clean === "never") return Number.POSITIVE_INFINITY;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(clean)) return 0;
  let days = 0;
  const years = clean.match(/(\d+)y/);
  const weeks = clean.match(/(\d+)w/);
  const dayPart = clean.match(/(\d+)d/);
  const hours = clean.match(/(\d+)h/);
  if (years) days += Number(years[1]) * 365;
  if (weeks) days += Number(weeks[1]) * 7;
  if (dayPart) days += Number(dayPart[1]);
  if (hours && days === 0) return 0;
  return years || weeks || dayPart ? Math.floor(days / 7) : null;
}

export function parseCiscoInterfaceAudit(output: string, minimumWeeks: number): LivePortAuditResult[] {
  const starts = [...output.matchAll(/^([^\s\r\n]+) is ([^,\r\n]+), line protocol is ([^\r\n]+)/gm)];
  return starts.flatMap((match, index) => {
    const port = match[1];
    if (!physicalInterface.test(port)) return [];
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? output.length;
    const block = output.slice(start, end);
    const description = block.match(/^\s*Description:\s*(.+)$/mi)?.[1]?.trim() ?? "";
    const lastInput = block.match(/^\s*Last input\s+([^,\s]+)/mi)?.[1] ?? "unknown";
    const inactiveWeeks = inactivityWeeks(lastInput);
    const interfaceStatus = match[2].trim();
    const lineProtocol = match[3].trim();
    const down = /(?:down|disabled|notconnect)/i.test(interfaceStatus) || /down/i.test(lineProtocol);
    const oldEnough = inactiveWeeks === Number.POSITIVE_INFINITY || (inactiveWeeks != null && inactiveWeeks >= minimumWeeks);
    const protectedPort = protectedDescription.test(description);
    const candidate = down && oldEnough && !protectedPort;
    const reason = !down ? "Interface is currently active" : !oldEnough ? `Last input is newer than ${minimumWeeks} weeks` : protectedPort ? "Description suggests infrastructure; investigate" : lastInput === "never" ? "No input recorded since the last counter reset/reload" : `No input recorded for approximately ${inactiveWeeks} weeks`;
    return [{ port, description, interfaceStatus, lineProtocol, lastInput, inactiveWeeks: Number.isFinite(inactiveWeeks) ? inactiveWeeks : null, protected: protectedPort, candidate, reason }];
  });
}

export async function runLiveSwitchAudit(host: Host, credential: CredentialProfile, minimumWeeks: number): Promise<LiveSwitchAudit> {
  const port = host.port ?? 22;
  const hostKey = await probeSshHostKey(host.address, port);
  const knownHosts = JSON.parse(localStorage.getItem("netssh.knownHosts") ?? "{}") as Record<string, string>;
  const knownHostId = `${host.address}:${port}`;
  const existingFingerprint = knownHosts[knownHostId];
  if (existingFingerprint !== hostKey.fingerprint) {
    const message = existingFingerprint
      ? `WARNING: The SSH host key for ${knownHostId} has changed.\n\nSaved: ${existingFingerprint}\nPresented: ${hostKey.fingerprint}`
      : `Trust this SSH host key for ${knownHostId}?\n\n${hostKey.fingerprint}`;
    if (!window.confirm(message)) throw new Error("Switch audit cancelled before trusting the SSH host key");
    knownHosts[knownHostId] = hostKey.fingerprint;
    localStorage.setItem("netssh.knownHosts", JSON.stringify(knownHosts));
  }
  const result = await invoke<{ output: string; elapsedMs: number }>("collect_switch_interface_data", {
    deviceId: host.id,
    credentialId: credential.id,
    target: host.address,
    port,
    username: credential.username,
    trustedFingerprint: hostKey.fingerprint,
    legacyRsa: hostKey.legacyRsa,
  });
  return { deviceName: host.name, address: host.address, checkedAt: Date.now(), minimumWeeks, elapsedMs: result.elapsedMs, ports: parseCiscoInterfaceAudit(result.output, minimumWeeks), rawOutput: result.output };
}

function csvValue(value: string | number | null) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function createSwitchAuditCsv(audit: LiveSwitchAudit): string {
  const rows = [["Switch", "Address", "Port", "Description", "Interface status", "Line protocol", "Last input", "Approx. inactive weeks", "Protected", "Recommendation", "Reason"]];
  audit.ports.forEach((port) => rows.push([audit.deviceName, audit.address, port.port, port.description, port.interfaceStatus, port.lineProtocol, port.lastInput, port.inactiveWeeks == null ? "" : String(port.inactiveWeeks), port.protected ? "Yes" : "No", port.candidate ? "Review for shutdown" : "Keep / investigate", port.reason]));
  return rows.map((row) => row.map(csvValue).join(",")).join("\r\n");
}
