import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Activity, ArrowDownCircle, Bell, Bot, BrainCircuit, Calculator, Check, ChevronDown, ChevronRight, CircleDot, ClipboardCheck, ClipboardPaste,
  Clock3, Code2, Command, Copy, Database, FileDown, FileText, FileUp, Gauge, Globe2, Grid2X2, HardDrive,
  KeyRound, Layers3, Menu, MoreHorizontal, Network, PanelLeftClose, Pencil, Plus, Rss,
  ExternalLink, Eye, EyeOff, LockKeyhole, Radio, RefreshCw, Router, Search, Send, Server, Settings, ShieldCheck, Sparkles, Star,
  TerminalSquare, Trash2, UserRound, Wifi, Wrench, X, Zap,
} from "lucide-react";
import { aiProviders, closeProviderWebApp, openProviderWebApp, providerIsConnected, removeProviderKey, resizeProviderWebApp, saveProviderKey, sendAiMessage } from "./ai";
import { ciscoDemoHosts, hosts as initialHosts, recentCommands, snippets } from "./data";
import { calculateSubnet, type SubnetResult } from "./network";
import { runDiagnostic, type DiagnosticKind, type DiagnosticResult } from "./diagnostics";
import { openWifiPrivacySettings, runWifiDiagnostic, signalHealth, type WifiDiagnostic } from "./wifi";
import { closeTerminal, listSerialPorts, listenForTerminalEvents, preflightConnection, probeSshHostKey, resizeTerminal, startTerminalSession, writeTerminal, writeTerminalEnablePassword, type SerialPortInfo } from "./ssh";
import { deleteCredentialEnablePassword, deleteCredentialPassword, deleteDevicePassword, hasCredentialEnablePassword, hasCredentialPassword, hasDevicePassword, isNativeApp, saveCredentialEnablePassword, saveCredentialPassword } from "./credentials";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { createSwitchAuditCsv, runLiveSwitchAudit, type LiveSwitchAudit } from "./switchAudit";
import { createNetSshExport, createSessionCsv, decodeSessionFile, parseSessionImport, type ImportedSession, type SessionImportFormat } from "./sessionTransfer";
import { TopologyDesigner } from "./TopologyDesigner";
import { fetchSecurityAdvisories, openSecurityAdvisory, securityFeedFallback, type SecurityAdvisory } from "./securityFeed";
import { findCiscoCommandSuggestions, type CiscoCommandSuggestion } from "./ciscoCommands";
import { EngineerNotes } from "./EngineerNotes";
import { DeviceDiscoveryModal } from "./DeviceDiscovery";
import type { AiMessage, AiProvider, CommandSnippet, ConnectionHistory, ConnectionProtocol, CredentialProfile, DeviceRole, Host, Session, TerminalLine, View } from "./types";
import packageMetadata from "../package.json";

const APP_VERSION = packageMetadata.version;

const navItems: { id: View; label: string; icon: typeof TerminalSquare }[] = [
  { id: "workspace", label: "Workspace", icon: TerminalSquare },
  { id: "inventory", label: "Inventory", icon: Server },
  { id: "topology", label: "Topology", icon: Network },
  { id: "toolbox", label: "Toolbox", icon: Wrench },
  { id: "snippets", label: "Snippets", icon: Code2 },
  { id: "notes", label: "Engineer notes", icon: FileText },
  { id: "assistant", label: "AI assistant", icon: Bot },
];

const statusLabel = { online: "Reachable", warning: "Attention", offline: "Offline" };
type Appearance = "dark" | "light" | "system";
type AppPreferences = { appearance: Appearance; compactWorkspace: boolean; showConnectionWarnings: boolean; cliAutocomplete: boolean; defaultProtocol: ConnectionProtocol; sites: string[]; platforms: string[] };
type UserProfile = { name: string; role: string; onboardingComplete: boolean };
type AppNotification = { id: string; message: string; createdAt: number; read: boolean };
type ConnectionCredentials = { username: string; password?: string; savePassword: boolean };
const defaultPlatforms = ["Cisco IOS-XE", "Cisco NX-OS", "Arista EOS", "Juniper JunOS", "Palo Alto", "Fortinet FortiOS", "Linux", "Other"];
const defaultSites = [...new Set(initialHosts.map((host) => host.site))].sort();
const defaultPreferences: AppPreferences = { appearance: "dark", compactWorkspace: false, showConnectionWarnings: true, cliAutocomplete: true, defaultProtocol: "ssh", sites: defaultSites, platforms: defaultPlatforms };
const defaultUserProfile: UserProfile = { name: "", role: "Network Engineer", onboardingComplete: false };
const deviceRoleLabels: Record<DeviceRole, string> = { core: "Core", distribution: "Distribution", access: "Access", router: "Router", firewall: "Firewall", "wireless-controller": "WLC", "access-point": "Access point", server: "Server", other: "Other" };
const deviceRoles = Object.entries(deviceRoleLabels) as [DeviceRole, string][];

function deviceRoleValue(host: Host): DeviceRole {
  if (host.deviceRole) return host.deviceRole;
  const value = `${host.name} ${host.platform} ${(host.tags ?? []).join(" ")}`.toLowerCase();
  if (value.includes("firewall") || /(^|\W)fw(\W|$)/.test(value)) return "firewall";
  if (value.includes("wireless") || value.includes("wlc")) return "wireless-controller";
  if (value.includes("access point") || /(^|\W)ap(\W|$)/.test(value)) return "access-point";
  if (value.includes("router") || /(^|\W)rtr(\W|$)/.test(value)) return "router";
  if (value.includes("core")) return "core";
  if (value.includes("dist")) return "distribution";
  if (value.includes("access")) return "access";
  if (value.includes("server") || value.includes("linux")) return "server";
  return "other";
}

function deviceRoleLabel(host: Host) {
  return deviceRoleLabels[deviceRoleValue(host)];
}

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NE";
  return `${parts[0][0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

type CiscoDemoState = { input: string; pages: string[]; history: string[]; historyIndex: number };

function ciscoPrompt(host: Host) {
  return `${host.name}#`;
}

function ciscoDemoWelcome(host: Host) {
  const system = host.demoProfile === "cisco-nxos" ? "Cisco Nexus Operating System (NX-OS)" : "Cisco IOS XE Software";
  return `\x1b[2J\x1b[H\x1b[1;36mNetSSH Cisco test session\x1b[0m\r\n${system}\r\nThis local simulator is safe: commands do not reach a real device.\r\n\r\n${ciscoPrompt(host)}`;
}

function ciscoDemoCommand(host: Host, command: string): { output: string; pages?: string[] } {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return { output: ciscoPrompt(host) };
  if (normalized === "clear" || normalized === "cls") return { output: `\x1b[2J\x1b[H${ciscoPrompt(host)}` };
  if (normalized === "show version") return { output: `${host.demoProfile === "cisco-nxos" ? "Cisco Nexus Operating System (NX-OS) Software\r\n  system: version 10.4(3)\r\n  Hardware: cisco Nexus9000 C93180YC-FX" : "Cisco IOS XE Software, Version 17.12.04\r\nCisco IOS Software [Dublin], Catalyst L3 Switch Software\r\nModel Number                    : C9300-48P"}\r\nUptime is 18 weeks, 4 days, 03:21:17\r\n${ciscoPrompt(host)}` };
  if (normalized === "show ip interface brief" || normalized === "sh ip int br") return { output: `Interface              IP-Address      OK? Method Status                Protocol\r\nVlan10                 10.24.10.2      YES NVRAM  up                    up\r\nVlan20                 10.24.20.2      YES NVRAM  up                    up\r\nGigabitEthernet1/0/1   unassigned      YES unset  up                    up\r\nGigabitEthernet1/0/2   unassigned      YES unset  down                  down\r\n${ciscoPrompt(host)}` };
  if (normalized === "show vlan brief") return { output: `VLAN Name                             Status    Ports\r\n---- -------------------------------- --------- -------------------------------\r\n1    default                          active    Gi1/0/20, Gi1/0/21\r\n10   USERS                            active    Gi1/0/1, Gi1/0/2, Gi1/0/3\r\n20   VOICE                            active    Gi1/0/4, Gi1/0/5\r\n99   MANAGEMENT                       active\r\n${ciscoPrompt(host)}` };
  if (normalized === "show interfaces status" || normalized === "sh int status") return {
    output: "Port      Name               Status       Vlan       Duplex  Speed Type\r\nGi1/0/1   USER-DESK-01       connected    10         a-full a-1000 10/100/1000BaseTX\r\nGi1/0/2   USER-DESK-02       connected    10         a-full a-1000 10/100/1000BaseTX\r\nGi1/0/3   AP-LONDON-01       connected    trunk      a-full a-1000 10/100/1000BaseTX\r\nGi1/0/4   PHONE-04           connected    20         a-full a-1000 10/100/1000BaseTX\r\n\x1b[7m--More--\x1b[0m",
    pages: [
      "Gi1/0/5   PHONE-05           connected    20         a-full a-1000 10/100/1000BaseTX",
      "Gi1/0/6   PRINTER-01         connected    10         a-full a-1000 10/100/1000BaseTX",
      "Gi1/0/7                      notconnect   1            auto   auto 10/100/1000BaseTX",
      "Gi1/0/8                      disabled     1            auto   auto 10/100/1000BaseTX",
      "Gi1/0/47  DIST-UPLINK-A      connected    trunk        full    10G SFP-10GBase-SR",
      "Gi1/0/48  DIST-UPLINK-B      connected    trunk        full    10G SFP-10GBase-SR",
    ],
  };
  if (normalized === "help" || normalized === "?") return { output: `Useful demo commands:\r\n  show version\r\n  show ip interface brief\r\n  show interfaces status   (includes --More--)\r\n  show vlan brief\r\n  clear\r\n${ciscoPrompt(host)}` };
  return { output: `% Invalid input detected at '^' marker. Try 'help'.\r\n${ciscoPrompt(host)}` };
}

function advanceCiscoPager(host: Host, state: CiscoDemoState, lineCount: number) {
  const lines = state.pages.splice(0, lineCount);
  const suffix = state.pages.length ? "\r\n\x1b[7m--More--\x1b[0m" : `\r\n${ciscoPrompt(host)}`;
  return `\r\x1b[2K${lines.join("\r\n")}${suffix}`;
}

function cleanTerminalOutput(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/[\u0000\u0007]/g, "");
}

function safeFileName(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "terminal";
}

function saveTerminalTranscript(session: Session) {
  const protocol = (session.host.protocol ?? "ssh").toUpperCase();
  const exportedAt = new Date();
  const header = [
    "NetSSH terminal transcript",
    `Device: ${session.host.name}`,
    `Address: ${session.host.address}`,
    `Protocol: ${protocol}`,
    `Site: ${session.host.site}`,
    `Platform: ${session.host.platform}`,
    `Saved: ${exportedAt.toLocaleString()}`,
    "-".repeat(72),
    "",
  ].join("\n");
  const transcript = cleanTerminalOutput(session.lines.map((line) => line.kind === "output" ? line.text : `\n[${line.kind.toUpperCase()}] ${line.text}\n`).join(""));
  const value = `${header}${transcript.trimEnd()}\n`;
  const date = exportedAt.toISOString().replace(/[:.]/g, "-");
  const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(session.host.name)}-${date}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function App() {
  const [view, setView] = useState<View>("workspace");
  const [deviceHosts, setDeviceHosts] = useState<Host[]>(() => {
    try {
      const saved = localStorage.getItem("netssh.devices");
      const stored = saved ? JSON.parse(saved) as Host[] : initialHosts;
      if (!import.meta.env.DEV) return stored;
      return [...ciscoDemoHosts, ...stored.filter((host) => !ciscoDemoHosts.some((demo) => demo.id === host.id))];
    } catch {
      return import.meta.env.DEV ? [...ciscoDemoHosts, ...initialHosts] : initialHosts;
    }
  });
  const [credentialProfiles, setCredentialProfiles] = useState<CredentialProfile[]>(() => {
    try { return JSON.parse(localStorage.getItem("netssh.credentialProfiles") ?? "[]") as CredentialProfile[]; }
    catch { return []; }
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState("");
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [deviceDiscoveryOpen, setDeviceDiscoveryOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionTransferOpen, setSessionTransferOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const ciscoDemoStates = useRef(new Map<string, CiscoDemoState>());
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem("netssh.preferences") ?? "{}") }; }
    catch { return defaultPreferences; }
  });
  useEffect(() => {
    if (!isNativeApp()) return;
    requestAnimationFrame(() => { void invoke("complete_startup").catch(() => undefined); });
  }, []);
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try { return { ...defaultUserProfile, ...JSON.parse(localStorage.getItem("netssh.userProfile") ?? "{}") }; }
    catch { return defaultUserProfile; }
  });
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try { return !(JSON.parse(localStorage.getItem("netssh.userProfile") ?? "{}") as Partial<UserProfile>).onboardingComplete; }
    catch { return true; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [notifications, setNotifications] = useState<AppNotification[]>([
    { id: "phase-3", message: "Phase 3 workspace tools are ready: tabs, split panes, and AI side panel.", createdAt: Date.now(), read: false },
  ]);
  const [history, setHistory] = useState<ConnectionHistory[]>(() => {
    try {
      const saved = localStorage.getItem("netssh.history");
      return saved ? JSON.parse(saved) as ConnectionHistory[] : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("netssh.devices", JSON.stringify(deviceHosts));
  }, [deviceHosts]);

  useEffect(() => {
    localStorage.setItem("netssh.credentialProfiles", JSON.stringify(credentialProfiles));
  }, [credentialProfiles]);

  useEffect(() => {
    localStorage.setItem("netssh.history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("netssh.preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    localStorage.setItem("netssh.userProfile", JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listenForTerminalEvents((event) => {
      const text = event.kind === "data" ? event.data : cleanTerminalOutput(event.data);
      setSessions((current) => current.map((session) => {
        if (session.id !== event.sessionId) return session;
        if (event.kind === "connected") return { ...session, connected: true, connectionState: "connected", lines: [...session.lines, { kind: "info", text }] };
        if (event.kind === "closed") return { ...session, connected: false, connectionState: "closed", lines: [...session.lines, { kind: "warning", text }] };
        if (event.kind === "error") return { ...session, connected: false, connectionState: "error", lines: [...session.lines, { kind: "warning", text }] };
        if (!text) return session;
        return { ...session, lines: [...session.lines, { kind: event.kind === "info" ? "info" : "output", text }] };
      }));
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const importDeviceSessions = (imported: ImportedSession[], source: string) => {
    const nextProfiles = [...credentialProfiles];
    const nextHosts = [...deviceHosts];
    let added = 0;
    let duplicates = 0;
    for (const item of imported) {
      const port = item.protocol === "serial" ? undefined : item.port ?? (item.protocol === "telnet" ? 23 : 22);
      const duplicate = nextHosts.some((host) => host.address.toLowerCase() === item.address.toLowerCase() && (host.protocol ?? "ssh") === item.protocol && (item.protocol === "serial" || (host.port ?? ((host.protocol ?? "ssh") === "telnet" ? 23 : 22)) === port));
      if (duplicate) { duplicates += 1; continue; }
      let credentialId: string | undefined;
      if (item.protocol !== "serial" && item.username) {
        let profile = nextProfiles.find((candidate) => candidate.username.toLowerCase() === item.username!.toLowerCase() && (!item.credentialLabel || candidate.label.toLowerCase() === item.credentialLabel.toLowerCase()));
        if (!profile) {
          profile = { id: `credential-${crypto.randomUUID()}`, label: item.credentialLabel ?? `${source} · ${item.username}`, username: item.username };
          nextProfiles.push(profile);
        }
        credentialId = profile.id;
      }
      nextHosts.push({ id: `imported-${crypto.randomUUID()}`, name: item.name, address: item.address, protocol: item.protocol, port, baudRate: item.baudRate, credentialId, platform: item.platform ?? "Other", deviceRole: item.deviceRole ?? "other", site: item.site ?? `Imported / ${source}`, status: "online", latency: null, tags: [...new Set([...(item.tags ?? []), "imported"])], notes: `Imported from ${source}` });
      added += 1;
    }
    setCredentialProfiles(nextProfiles);
    setDeviceHosts(nextHosts);
    return { added, duplicates, profiles: nextProfiles.length - credentialProfiles.length };
  };

  const importDiscoveredHosts = (discovered: Host[]) => {
    const nextHosts = [...deviceHosts];
    let added = 0;
    let updated = 0;
    let duplicates = 0;
    for (const host of discovered) {
      const duplicateIndex = nextHosts.findIndex((existing) => existing.address.toLowerCase() === host.address.toLowerCase() && (existing.protocol ?? "ssh") === "ssh" && (existing.port ?? 22) === (host.port ?? 22));
      if (duplicateIndex >= 0) {
        const existing = nextHosts[duplicateIndex];
        const discoveredHostname = host.name.trim();
        const discoveredPlatform = host.platform.trim();
        const nameIsAddress = !existing.name.trim() || existing.name.trim().toLowerCase() === existing.address.trim().toLowerCase();
        const platformIsGeneric = !existing.platform.trim() || existing.platform.trim().toLowerCase() === "other";
        const merged = {
          ...existing,
          ...(nameIsAddress && discoveredHostname && discoveredHostname.toLowerCase() !== host.address.toLowerCase() ? { name: discoveredHostname } : {}),
          ...(platformIsGeneric && discoveredPlatform && discoveredPlatform.toLowerCase() !== "other" ? { platform: discoveredPlatform } : {}),
          ...(existing.credentialId ? {} : host.credentialId ? { credentialId: host.credentialId } : {}),
          ...(host.latency != null ? { latency: host.latency, status: "online" as const } : {}),
        };
        if (merged.name !== existing.name || merged.platform !== existing.platform || merged.credentialId !== existing.credentialId || merged.latency !== existing.latency || merged.status !== existing.status) {
          nextHosts[duplicateIndex] = merged;
          updated += 1;
        } else {
          duplicates += 1;
        }
        continue;
      }
      nextHosts.unshift(host);
      added += 1;
    }
    setDeviceHosts(nextHosts);
    setDeviceDiscoveryOpen(false);
    setView("inventory");
    notify(`${added} discovered device${added === 1 ? "" : "s"} added${updated ? ` · ${updated} existing device${updated === 1 ? "" : "s"} updated` : ""}${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}`);
    return { added, duplicates, updated };
  };

  const startNativeSession = async (id: string, host: Host, username = "", password?: string, reconnecting = false): Promise<string | null> => {
    const protocol = host.protocol ?? "ssh";
    const assignedCredential = credentialProfiles.find((credential) => credential.id === host.credentialId);
    const port = protocol === "serial" ? undefined : host.port ?? (protocol === "telnet" ? 23 : 22);
    const cleanUsername = username.trim();
    const connectionMessage = reconnecting
      ? `Reconnecting to ${host.address}${protocol === "serial" ? ` at ${host.baudRate ?? 9600} baud` : `:${port}`}…`
      : protocol === "ssh" ? `Preparing SSH connection to ${host.address}:${port}…` : protocol === "serial" ? `Opening ${host.address} at ${host.baudRate ?? 9600} baud…` : `Connecting to ${host.address}:${port} over TELNET…`;
    setSessions((current) => current.map((session) => session.id === id ? { ...session, connected: false, connectionState: "connecting", suggestedUsername: cleanUsername || session.suggestedUsername, lines: [...session.lines, { kind: "info", text: connectionMessage }] } : session));
    let trustedFingerprint: string | undefined;
    let legacyRsa = false;
    let legacyKex = false;
    try {
      if (protocol === "ssh") {
        const hostKey = await probeSshHostKey(host.address, port ?? 22);
        const fingerprint = hostKey.fingerprint;
        legacyRsa = hostKey.legacyRsa;
        legacyKex = hostKey.legacyKex;
        const knownHosts = JSON.parse(localStorage.getItem("netssh.knownHosts") ?? "{}") as Record<string, string>;
        const knownHostId = `${host.address}:${port ?? 22}`;
        const existingFingerprint = knownHosts[knownHostId];
        if (existingFingerprint !== fingerprint) {
          const warning = existingFingerprint
            ? `WARNING: The SSH host key for ${knownHostId} has changed.\n\nSaved: ${existingFingerprint}\nPresented: ${fingerprint}\n\nOnly continue if this change is expected.`
            : `Trust this SSH host key for ${knownHostId}?\n\n${fingerprint}\n\nConfirm this fingerprint with your network administrator before continuing.`;
          if (!window.confirm(warning)) {
            setSessions((current) => current.map((session) => session.id === id ? { ...session, connectionState: "closed", lines: [...session.lines, { kind: "warning", text: "Connection cancelled before trusting the SSH host key." }] } : session));
            return null;
          }
          knownHosts[knownHostId] = fingerprint;
          localStorage.setItem("netssh.knownHosts", JSON.stringify(knownHosts));
        }
        trustedFingerprint = fingerprint;
      }
      setSessions((current) => current.map((session) => session.id === id ? { ...session, suggestedUsername: cleanUsername || session.suggestedUsername, lines: [...session.lines, { kind: "info", text: protocol === "serial" ? `Opening ${host.address} at ${host.baudRate ?? 9600} baud…` : protocol === "ssh" && !cleanUsername ? `SSH transport ready for ${host.address}:${port}; enter login details in the terminal…` : protocol === "telnet" && !cleanUsername ? `Connected to ${host.address}:${port}; enter credentials when prompted…` : `Authenticating ${cleanUsername}@${host.address}:${port} over ${protocol.toUpperCase()}…` }, ...(protocol === "telnet" ? [{ kind: "warning" as const, text: "Telnet credentials and session traffic are not encrypted. Use only on a trusted management network." }] : []), ...(legacyKex ? [{ kind: "warning" as const, text: "Compatibility mode: this device requires a legacy SHA-1 key exchange. Upgrade its SSH configuration when possible." }] : [])] } : session));
      await startTerminalSession({ sessionId: id, deviceId: host.id, credentialId: assignedCredential?.id, protocol, target: host.address, port, baudRate: host.baudRate, username: cleanUsername, password, trustedFingerprint, legacyRsa, legacyKex });
      setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: true, detail: `${protocol.toUpperCase()} session connected` }, ...current].slice(0, 250));
      return id;
    } catch (caught) {
      const detail = String(caught);
      setSessions((current) => current.map((session) => session.id === id ? { ...session, connected: false, connectionState: "error", lines: [...session.lines, { kind: "warning", text: detail }] } : session));
      setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: false, detail }, ...current].slice(0, 250));
      notify(detail);
      return null;
    }
  };

  const connect = async (host: Host, forceNew = false): Promise<string | null> => {
    const protocol = host.protocol ?? "ssh";
    const existing = sessions.find((session) => session.host.id === host.id && (session.connected || session.connectionState === "connecting" || session.connectionState === "awaiting-credentials"));
    if (existing && !forceNew) {
      setActiveSession(existing.id);
      setView("workspace");
      return existing.id;
    } else {
      const id = `session-${host.id}-${Date.now()}`;
      if (host.demoProfile) {
        ciscoDemoStates.current.set(id, { input: "", pages: [], history: [], historyIndex: 0 });
        setSessions((current) => [...current, { id, host, connected: true, connectionState: "connected", lines: [{ kind: "output", text: ciscoDemoWelcome(host) }] }]);
        setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: true, detail: "Local Cisco test session opened" }, ...current].slice(0, 250));
        setActiveSession(id);
        setView("workspace");
        return id;
      }
      if (isNativeApp()) {
        const assignedCredential = credentialProfiles.find((credential) => credential.id === host.credentialId);
        const connectionUsername = assignedCredential?.username.trim() ?? host.username?.trim() ?? "";
        setSessions((current) => [...current, { id, host, connected: false, connectionState: "connecting", lines: [] }]);
        setActiveSession(id);
        setView("workspace");
        return startNativeSession(id, host, connectionUsername);
      }
      let preflight;
      try {
        preflight = await preflightConnection(protocol, host.address, protocol === "serial" ? undefined : host.port ?? (protocol === "telnet" ? 23 : 22), host.baudRate);
      } catch (caught) {
        const detail = String(caught);
        setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: false, detail }, ...current].slice(0, 250));
        notify(detail);
        return null;
      }
      setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: true, detail: preflight.banner ?? `${protocol.toUpperCase()} target reachable`, elapsedMs: preflight.elapsedMs }, ...current].slice(0, 250));
      setSessions((current) => [...current, {
        id,
        host,
        connected: true,
        lines: [
          { kind: "info", text: `${protocol.toUpperCase()} preflight completed for ${host.address}${protocol === "serial" ? ` at ${host.baudRate ?? 9600} baud` : `:${host.port ?? (protocol === "telnet" ? 23 : 22)}`} in ${preflight.elapsedMs} ms` },
          { kind: "info", text: preflight.banner ?? `${protocol.toUpperCase()} service reachable` },
          ...(preferences.showConnectionWarnings ? [{ kind: "warning" as const, text: protocol === "serial" ? "Interactive serial transport is not enabled yet." : "Browser preview cannot open native terminal sessions. Run the desktop app to connect." }] : []),
        ],
      }]);
      setActiveSession(id);
      setView("workspace");
      return id;
    }
  };

  const authenticateSession = async (id: string, credentials: ConnectionCredentials) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    const assignedCredential = credentialProfiles.find((credential) => credential.id === session.host.credentialId);
    if (credentials.savePassword && credentials.password && assignedCredential) {
      try { await saveCredentialPassword(assignedCredential.id, credentials.password); }
      catch (caught) { notify(`Credential could not be saved: ${String(caught)}`); }
    }
    await startNativeSession(id, session.host, credentials.username.trim(), credentials.password);
  };

  const reconnectSession = async (id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session || session.connectionState === "connecting") return;
    if (session.host.demoProfile) {
      ciscoDemoStates.current.set(id, { input: "", pages: [], history: [], historyIndex: 0 });
      setSessions((current) => current.map((item) => item.id === id ? {
        ...item,
        connected: true,
        connectionState: "connected",
        lines: [...item.lines, { kind: "info", text: `Reconnected to ${item.host.name}` }, { kind: "output", text: ciscoDemoWelcome(item.host) }],
      } : item));
      return;
    }
    if (!isNativeApp()) {
      notify("Reconnect is available for live sessions in the NetSSH desktop app.");
      return;
    }
    if (session.connected || session.connectionState === "connected") {
      await closeTerminal(id).catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    const assignedCredential = credentialProfiles.find((credential) => credential.id === session.host.credentialId);
    const username = session.suggestedUsername ?? assignedCredential?.username ?? session.host.username ?? "";
    await startNativeSession(id, session.host, username, undefined, true);
  };

  const closeSessions = (ids: string[]) => {
    const closing = new Set(ids);
    ids.forEach((id) => {
      void closeTerminal(id);
      ciscoDemoStates.current.delete(id);
    });
    const remaining = sessions.filter((session) => !closing.has(session.id));
    setSessions(remaining);
    if (activeSession && closing.has(activeSession)) setActiveSession(remaining.at(-1)?.id ?? null);
  };
  const closeSession = (id: string) => closeSessions([id]);

  const appendLines = (id: string, lines: TerminalLine[]) => {
    setSessions((current) => current.map((session) => session.id === id
      ? { ...session, lines: [...session.lines, ...lines] }
      : session));
  };

  const sendTerminalData = (id: string, data: string) => {
    const target = sessions.find((session) => session.id === id);
    if (!target?.host.demoProfile) {
      void writeTerminal(id, data).catch((caught) => appendLines(id, [{ kind: "warning", text: String(caught) }]));
      return;
    }
    const state = ciscoDemoStates.current.get(id) ?? { input: "", pages: [], history: [], historyIndex: 0 };
    state.history ??= [];
    state.historyIndex ??= state.history.length;
    let output = "";
    if (!state.pages.length && (data === "\x1b[A" || data === "\x1b[B")) {
      const previousInput = state.input;
      if (data === "\x1b[A" && state.history.length) state.historyIndex = Math.max(0, state.historyIndex - 1);
      if (data === "\x1b[B" && state.history.length) state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
      state.input = state.historyIndex < state.history.length ? state.history[state.historyIndex] : "";
      output = `${"\b \b".repeat(previousInput.length)}${state.input}`;
      ciscoDemoStates.current.set(id, state);
      if (output) appendLines(id, [{ kind: "output", text: output }]);
      return;
    }
    for (const character of data) {
      if (character === "\n" && data.includes("\r")) continue;
      if (state.pages.length) {
        if (character === " ") output += advanceCiscoPager(target.host, state, 4);
        else if (character === "\r" || character === "\n") output += advanceCiscoPager(target.host, state, 1);
        else if (character.toLowerCase() === "q" || character === "\u0003") {
          state.pages = [];
          output += `\r\x1b[2K${ciscoPrompt(target.host)}`;
        }
        continue;
      }
      if (character === "\r" || character === "\n") {
        const response = ciscoDemoCommand(target.host, state.input);
        const executed = state.input.trim();
        if (executed && state.history.at(-1) !== executed) state.history.push(executed);
        state.historyIndex = state.history.length;
        state.input = "";
        state.pages = response.pages ?? [];
        output += `\r\n${response.output}`;
      } else if (character === "\u007f" || character === "\b") {
        if (state.input) {
          state.input = state.input.slice(0, -1);
          output += "\b \b";
        }
      } else if (character === "\u0003") {
        state.input = "";
        output += `^C\r\n${ciscoPrompt(target.host)}`;
      } else if (character === "\u0015") {
        output += "\b \b".repeat(state.input.length);
        state.input = "";
      } else if (character === "\f") {
        output += `\x1b[2J\x1b[H${ciscoPrompt(target.host)}${state.input}`;
      } else if (character === "\t") {
        if ("show ".startsWith(state.input.toLowerCase())) {
          const completion = "show ".slice(state.input.length);
          state.input += completion;
          output += completion;
        }
      } else if (character >= " " && !character.startsWith("\x1b")) {
        state.input += character;
        output += character;
      }
    }
    ciscoDemoStates.current.set(id, state);
    if (output) appendLines(id, [{ kind: "output", text: output }]);
  };

  const notify = (message: string) => {
    setToast(message);
    setNotifications((current) => [{ id: crypto.randomUUID(), message, createdAt: Date.now(), read: false }, ...current].slice(0, 30));
    window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentSession = sessions.find((session) => session.id === activeSession);

  const lightMode = preferences.appearance === "light" || (preferences.appearance === "system" && !systemDark);

  return (
    <div className={`app-shell ${lightMode ? "theme-light" : "theme-dark"} ${preferences.compactWorkspace ? "compact-workspace" : ""}`}>
      <Sidebar view={view} setView={setView} open={sidebarOpen} setOpen={setSidebarOpen} onSearch={() => setSearchOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onEditProfile={() => setProfileEditorOpen(true)} onShowOnboarding={() => setOnboardingOpen(true)} userProfile={userProfile} notify={notify} deviceCount={deviceHosts.length} />
      <main className={`main ${sidebarOpen ? "" : "main-expanded"}`}>
        <Topbar view={view} onSearch={() => setSearchOpen(true)} notifications={notifications} notificationsOpen={notificationsOpen} onToggleNotifications={() => { setNotificationsOpen((open) => !open); setSettingsOpen(false); setNotifications((current) => current.map((item) => ({ ...item, read: true }))); }} onClearNotifications={() => setNotifications([])} onOpenSettings={() => { setSettingsOpen(true); setNotificationsOpen(false); }} />
        <div className="content">
          {view === "inventory" && <div className="inventory-discovery-launcher"><button className="secondary-button" onClick={() => setDeviceDiscoveryOpen(true)}><Network size={15} /> Discover device range</button></div>}
          {view === "workspace" && (
            <Workspace sessions={sessions} activeId={activeSession} session={currentSession} hosts={deviceHosts} userName={userProfile.name} autocompleteEnabled={preferences.cliAutocomplete} onAuthenticate={authenticateSession} onReconnect={reconnectSession} onActivate={setActiveSession} onClose={closeSession} onCloseMany={closeSessions} onConnect={connect} onNewSession={(host) => connect(host, true)} onCommand={appendLines} onTerminalData={sendTerminalData} onAddDevice={() => setAddDeviceOpen(true)} onShowInventory={() => setView("inventory")} notify={notify} />
          )}
          {view === "inventory" && <Inventory hosts={deviceHosts} onConnect={connect} onAdd={() => setAddDeviceOpen(true)} onTransfer={() => setSessionTransferOpen(true)} onEdit={setEditingHost} onFavorite={(id) => setDeviceHosts((current) => current.map((host) => host.id === id ? { ...host, favorite: !host.favorite } : host))} onDelete={(id) => { setDeviceHosts((current) => current.filter((host) => host.id !== id)); deleteDevicePassword(id).catch(() => undefined); notify("Device removed"); }} />}
          {view === "topology" && <TopologyDesigner hosts={deviceHosts} onConnect={(host) => { setView("workspace"); void connect(host); }} notify={notify} />}
          {view === "toolbox" && <Toolbox hosts={deviceHosts} credentialProfiles={credentialProfiles} notify={notify} />}
          {view === "snippets" && <Snippets notify={notify} onRun={(snippet) => {
            if (!activeSession) { notify("Open a device session before running a snippet"); setView("workspace"); return; }
            const target = sessions.find((session) => session.id === activeSession);
            if (!target?.connected) { notify("The selected session is not connected"); return; }
            writeTerminal(activeSession, `${snippet.command}${target.host.protocol === "serial" ? "\r" : "\r\n"}`).then(() => notify(`Sent ${snippet.name}`)).catch((caught) => notify(String(caught)));
            setView("workspace");
          }} />}
          {view === "notes" && <EngineerNotes notify={notify} />}
          {view === "assistant" && <AiAssistant notify={notify} />}
          {view === "favorites" && <Favorites hosts={deviceHosts} onConnect={connect} onFavorite={(id) => setDeviceHosts((current) => current.map((host) => host.id === id ? { ...host, favorite: !host.favorite } : host))} onShowInventory={() => setView("inventory")} />}
          {view === "history" && <History entries={history} hosts={deviceHosts} onConnect={connect} onClear={() => { setHistory([]); notify("Connection history cleared"); }} />}
          {view === "credentials" && <Credentials profiles={credentialProfiles} hosts={deviceHosts} notify={notify} onSave={async (profile, password, enablePassword) => {
            if (password) await saveCredentialPassword(profile.id, password);
            if (enablePassword) await saveCredentialEnablePassword(profile.id, enablePassword);
            setCredentialProfiles((current) => current.some((item) => item.id === profile.id) ? current.map((item) => item.id === profile.id ? profile : item) : [profile, ...current]);
          }} onDelete={async (profile) => {
            await deleteCredentialPassword(profile.id).catch(() => undefined);
            await deleteCredentialEnablePassword(profile.id).catch(() => undefined);
            setCredentialProfiles((current) => current.filter((item) => item.id !== profile.id));
            setDeviceHosts((current) => current.map((host) => host.credentialId === profile.id ? { ...host, credentialId: undefined } : host));
          }} onAssign={(hostId, credentialId) => setDeviceHosts((current) => current.map((host) => host.id === hostId ? { ...host, credentialId: credentialId || undefined, username: undefined } : host))} />}
        </div>
      </main>
      {searchOpen && <CommandPalette hosts={deviceHosts} onClose={() => setSearchOpen(false)} onConnect={connect} onNavigate={setView} />}
      {(addDeviceOpen || editingHost) && <AddDeviceModal existingHosts={deviceHosts} credentialProfiles={credentialProfiles} initialHost={editingHost ?? undefined} defaultProtocol={preferences.defaultProtocol} configuredSites={preferences.sites} configuredPlatforms={preferences.platforms} onClose={() => { setAddDeviceOpen(false); setEditingHost(null); }} onSave={(host) => {
        notify(`${host.name} ${editingHost ? "updated" : "added"}`);
        setDeviceHosts((current) => editingHost ? current.map((item) => item.id === host.id ? host : item) : [host, ...current]);
        setAddDeviceOpen(false); setEditingHost(null); setView("inventory");
      }} />}
      {settingsOpen && <SettingsModal preferences={preferences} onClose={() => setSettingsOpen(false)} onSave={(next) => { setPreferences(next); setSettingsOpen(false); notify("Settings saved"); }} />}
      {deviceDiscoveryOpen && <DeviceDiscoveryModal credentialProfiles={credentialProfiles} configuredSites={preferences.sites} existingHosts={deviceHosts} onClose={() => setDeviceDiscoveryOpen(false)} onImport={importDiscoveredHosts} />}
      {onboardingOpen && <UserProfileModal profile={userProfile} onboarding onClose={() => setOnboardingOpen(false)} onSave={(profile) => { setUserProfile(profile); setOnboardingOpen(false); notify(`Welcome to NetSSH, ${profile.name.split(" ")[0]}`); }} />}
      {profileEditorOpen && <UserProfileModal profile={userProfile} onClose={() => setProfileEditorOpen(false)} onReset={() => { setUserProfile(defaultUserProfile); setProfileEditorOpen(false); setOnboardingOpen(true); }} onSave={(profile) => { setUserProfile(profile); setProfileEditorOpen(false); notify("Profile updated"); }} />}
      {sessionTransferOpen && <SessionTransferModal hosts={deviceHosts} credentialProfiles={credentialProfiles} configuredSites={preferences.sites} onClose={() => setSessionTransferOpen(false)} onImport={importDeviceSessions} notify={notify} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function Sidebar({ view, setView, open, setOpen, onSearch, onOpenSettings, onEditProfile, onShowOnboarding, userProfile, notify, deviceCount }: { view: View; setView: (view: View) => void; open: boolean; setOpen: (open: boolean) => void; onSearch: () => void; onOpenSettings: () => void; onEditProfile: () => void; onShowOnboarding: () => void; userProfile: UserProfile; notify: (message: string) => void; deviceCount: number }) {
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <aside className={`sidebar ${open ? "" : "sidebar-closed"}`}>
      <div className="brand"><div className="brand-mark"><Network size={20} /></div><span>NetSSH</span><button className="icon-button collapse" onClick={() => setOpen(!open)}>{open ? <PanelLeftClose size={17} /> : <Menu size={17} />}</button></div>
      <button className="search-button" onClick={onSearch}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <nav>
        <div className="nav-label">Control center</div>
        {navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === "inventory" && <em>{deviceCount}</em>}</button>)}
      </nav>
      <div className="sidebar-section">
        <div className="nav-label">Quick access</div>
        <button className={`nav-item ${view === "favorites" ? "active" : ""}`} onClick={() => setView("favorites")}><Star size={18} /><span>Favourites</span></button>
        <button className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}><Clock3 size={18} /><span>History</span></button>
        <button className={`nav-item ${view === "credentials" ? "active" : ""}`} onClick={() => setView("credentials")}><KeyRound size={18} /><span>Credentials</span></button>
      </div>
      <div className="sidebar-footer">
        <div className="sync-card"><div className="sync-icon"><ShieldCheck size={17} /></div><div><strong>Local vault</strong><small>Encrypted & secure</small></div><span className="status-dot" /></div>
        <div className="profile-wrap">{profileOpen && <div className="profile-menu"><button onClick={() => { setProfileOpen(false); onEditProfile(); }}><UserRound size={14} /><span><strong>Your profile</strong><small>Name and role</small></span></button><button onClick={() => { setProfileOpen(false); onOpenSettings(); }}><Settings size={14} /><span><strong>Preferences</strong><small>Workspace, sites, and platforms</small></span></button><button onClick={() => { setProfileOpen(false); setView("credentials"); }}><KeyRound size={14} /><span><strong>Credential vault</strong><small>Manage reusable logins</small></span></button><button onClick={() => { setProfileOpen(false); onShowOnboarding(); }}><Sparkles size={14} /><span><strong>Welcome tour</strong><small>Review the NetSSH basics</small></span></button><button onClick={() => { setProfileOpen(false); notify(`NetSSH ${APP_VERSION} · Local workspace`); }}><Network size={14} /><span><strong>About NetSSH</strong><small>Version {APP_VERSION}</small></span></button></div>}<button className="profile" aria-label="Open profile menu" onClick={() => setProfileOpen((value) => !value)}><span className="avatar">{profileInitials(userProfile.name)}</span><span><strong>{userProfile.name || "Network Engineer"}</strong><small>{userProfile.role || "Local workspace"}</small></span><MoreHorizontal size={18} /></button></div>
      </div>
    </aside>
  );
}

function Topbar({ view, onSearch, notifications, notificationsOpen, onToggleNotifications, onClearNotifications, onOpenSettings }: { view: View; onSearch: () => void; notifications: AppNotification[]; notificationsOpen: boolean; onToggleNotifications: () => void; onClearNotifications: () => void; onOpenSettings: () => void }) {
  const titles: Record<View, string> = { workspace: "Workspace", inventory: "Device inventory", topology: "Network topology", toolbox: "Network toolbox", snippets: "Command snippets", notes: "Engineer notes", assistant: "AI assistant", favorites: "Favourite devices", history: "Connection history", credentials: "Credential vault" };
  const unread = notifications.filter((item) => !item.read).length;
  return <header className="topbar"><div><h1>{titles[view]}</h1><span className="breadcrumb">NetSSH <ChevronRight size={12} /> {titles[view]}</span></div><div className="top-actions"><button className="mini-search" onClick={onSearch}><Search size={15} /> Quick search</button><div className="top-popover-wrap"><button className={`icon-button ${notificationsOpen ? "active" : ""}`} aria-label="Notifications" onClick={onToggleNotifications}><Bell size={18} />{unread > 0 && <em className="notification-count">{unread}</em>}</button>{notificationsOpen && <NotificationCenter notifications={notifications} onClear={onClearNotifications} />}</div><button className="icon-button" aria-label="Settings" onClick={onOpenSettings}><Settings size={18} /></button></div></header>;
}

function NotificationCenter({ notifications, onClear }: { notifications: AppNotification[]; onClear: () => void }) {
  return <section className="notification-center"><div><strong>Notifications</strong>{notifications.length > 0 && <button onClick={onClear}>Clear all</button>}</div>{notifications.length ? <div className="notification-list">{notifications.map((item) => <article key={item.id}><span><Bell size={13} /></span><div><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div></article>)}</div> : <div className="notification-empty"><Check size={20} /><span>You’re all caught up</span></div>}</section>;
}

function UserProfileModal({ profile, onboarding = false, onClose, onReset, onSave }: { profile: UserProfile; onboarding?: boolean; onClose: () => void; onReset?: () => void; onSave: (profile: UserProfile) => void }) {
  const [step, setStep] = useState(onboarding ? 0 : 1);
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role || "Network Engineer");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 0) { setStep(1); return; }
    const cleanName = name.trim();
    if (!cleanName) return;
    onSave({ name: cleanName, role: role.trim() || "Network Engineer", onboardingComplete: true });
  };
  return <div className="modal-backdrop onboarding-backdrop" onMouseDown={onClose}><form className="onboarding-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="onboarding-close" onClick={onClose} aria-label="Close onboarding"><X size={17} /></button>
    {step === 0 ? <>
      <div className="onboarding-brand"><span><Network size={25} /></span><strong>NetSSH</strong></div>
      <div className="onboarding-intro"><span className="eyebrow"><Sparkles size={13} /> Welcome aboard</span><h2>Your network engineering workspace</h2><p>Keep connections, diagnostics, topology designs, reusable commands, and vendor advisories together in one focused application.</p></div>
      <div className="onboarding-features"><div><span><TerminalSquare size={18} /></span><strong>Connect</strong><small>SSH, Telnet, and Serial sessions with tabs and split panes.</small></div><div><span><Wrench size={18} /></span><strong>Troubleshoot</strong><small>Subnet, Wi-Fi, DNS, ping, trace, port, and switch-audit tools.</small></div><div><span><ShieldCheck size={18} /></span><strong>Work locally</strong><small>Profiles and inventory stay on this device; secrets use the OS vault.</small></div></div>
      <div className="onboarding-footer"><span>Step 1 of 2</span><button className="primary-button">Set up my workspace <ChevronRight size={15} /></button></div>
    </> : <>
      <div className="onboarding-profile-head"><span className="profile-preview">{profileInitials(name)}</span><div><span className="eyebrow"><UserRound size={13} /> Local profile</span><h2>{onboarding ? "Make NetSSH yours" : "Your profile"}</h2><p>This name is shown only inside your local NetSSH workspace.</p></div></div>
      <div className="onboarding-fields"><label><span>Your name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Morgan" autoComplete="name" /></label><label><span>Role or team</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Network Engineer" /></label></div>
      <div className="profile-privacy"><ShieldCheck size={15} /><span>Your profile is stored locally and is never included in AI prompts or exported session files.</span></div>
      <div className="onboarding-footer">{onReset && <button type="button" className="profile-reset" onClick={onReset}>Reset onboarding</button>}<button type="button" className="onboarding-back" onClick={() => onboarding ? setStep(0) : onClose()}>{onboarding ? "Back" : "Cancel"}</button><span>{onboarding ? "Step 2 of 2" : "Local profile"}</span><button className="primary-button" disabled={!name.trim()}>{onboarding ? "Finish setup" : "Save profile"}</button></div>
    </>}
  </form></div>;
}

type AppUpdateStatus = "idle" | "checking" | "current" | "available" | "updating" | "unsupported" | "error";

function AppUpdateSection() {
  const [version, setVersion] = useState("Loading…");
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setVersion("Browser preview");
      setStatus("unsupported");
      return;
    }
    getVersion().then(setVersion).catch(() => setVersion("Desktop build"));
  }, []);

  const checkForUpdates = async () => {
    if (!isTauri()) {
      setStatus("unsupported");
      return;
    }
    setStatus("checking");
    setError("");
    try {
      const update = await check();
      setAvailableUpdate(update);
      setStatus(update ? "available" : "current");
    } catch (caught) {
      setAvailableUpdate(null);
      setError(String(caught));
      setStatus("error");
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setStatus("updating");
    setError("");
    setProgress(0);
    let downloaded = 0;
    let contentLength = 0;
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      await relaunch();
    } catch (caught) {
      setError(String(caught));
      setStatus("error");
      setProgress(null);
    }
  };

  const statusContent = status === "checking"
    ? <><Activity size={14} className="spin" /> Checking GitHub Releases…</>
    : status === "current"
      ? <><Check size={14} /> You’re up to date.</>
      : status === "available"
        ? <><ArrowDownCircle size={14} /> NetSSH {availableUpdate?.version} is ready.</>
        : status === "updating"
          ? <><Activity size={14} className="spin" /> Installing update{progress != null ? ` · ${progress}%` : "…"}</>
          : status === "unsupported"
            ? <><ShieldCheck size={14} /> Updates are available in the packaged desktop app.</>
            : status === "error"
              ? <><X size={14} /> {error}</>
              : <><ShieldCheck size={14} /> Signed updates are checked manually.</>;

  return <section className="update-section"><div className="update-section-head"><div><strong>Application updates</strong><small>Signed releases are downloaded from GitHub</small></div><span className="update-version">v{version}</span></div><div className={`update-status ${status}`}>{statusContent}</div>{availableUpdate?.body && <p className="update-notes">{availableUpdate.body}</p>}{progress != null && status === "updating" && <div className="update-progress"><i style={{ width: `${progress}%` }} /></div>}<div className="update-actions"><button className="secondary-button" onClick={() => void checkForUpdates()} disabled={status === "checking" || status === "updating"}><RefreshCw size={14} className={status === "checking" ? "spin" : ""} /> Check for updates</button>{availableUpdate && <button className="primary-button" onClick={() => void installUpdate()} disabled={status === "updating"}><ArrowDownCircle size={14} /> Update now</button>}</div></section>;
}

function SettingsModal({ preferences, onClose, onSave }: { preferences: AppPreferences; onClose: () => void; onSave: (preferences: AppPreferences) => void }) {
  const [draft, setDraft] = useState(preferences);
  return <div className="modal-backdrop settings-backdrop" onMouseDown={onClose}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><Settings size={18} /></span><div><h3>NetSSH settings</h3><p>Workspace preferences are stored locally on this device.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="settings-body"><AppUpdateSection /><label className="settings-select"><span><strong>Appearance</strong><small>Choose a light, dark, or operating-system theme</small></span><select value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value as Appearance })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use system setting</option></select></label><label className="settings-select"><span><strong>Default connection protocol</strong><small>Used when creating a new device profile</small></span><select value={draft.defaultProtocol} onChange={(event) => setDraft({ ...draft, defaultProtocol: event.target.value as ConnectionProtocol })}><option value="ssh">SSH</option><option value="telnet">Telnet</option><option value="serial">Serial</option></select></label><label className="settings-toggle"><span><strong>Compact workspace</strong><small>Reduce tab, toolbar, and terminal spacing</small></span><input type="checkbox" checked={draft.compactWorkspace} onChange={(event) => setDraft({ ...draft, compactWorkspace: event.target.checked })} /></label><label className="settings-toggle"><span><strong>CLI autocomplete</strong><small>Suggest common network commands while typing in terminals</small></span><input type="checkbox" checked={draft.cliAutocomplete} onChange={(event) => setDraft({ ...draft, cliAutocomplete: event.target.checked })} /></label><label className="settings-toggle"><span><strong>Connection safety notices</strong><small>Show authentication and trust limitations in new sessions</small></span><input type="checkbox" checked={draft.showConnectionWarnings} onChange={(event) => setDraft({ ...draft, showConnectionWarnings: event.target.checked })} /></label><ConfigList title="Inventory sites" description="Available when adding or editing a device" items={draft.sites} placeholder="Add a site" onChange={(sites) => setDraft({ ...draft, sites })} /><ConfigList title="Device platforms" description="Vendor and operating-system choices" items={draft.platforms} placeholder="Add a platform" onChange={(platforms) => setDraft({ ...draft, platforms })} /><div className="settings-security"><ShieldCheck size={16} /><span>Credentials remain in the operating system vault. NetSSH does not store passwords in preferences.</span></div></div><div className="modal-actions settings-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => onSave(draft)}>Save settings</button></div></section></div>;
}

function ConfigList({ title, description, items, placeholder, onChange }: { title: string; description: string; items: string[]; placeholder: string; onChange: (items: string[]) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const clean = value.trim();
    if (!clean || items.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    onChange([...items, clean]); setValue("");
  };
  return <section className="config-list"><div><strong>{title}</strong><small>{description}</small></div><div className="config-chips">{items.map((item) => <span key={item}>{item}<button aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((value) => value !== item))}><X size={11} /></button></span>)}</div><div className="config-add"><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder} /><button onClick={add}><Plus size={13} /> Add</button></div></section>;
}

function SessionConnectionBadges({ session, compact = false }: { session: Session; compact?: boolean }) {
  const protocol = session.host.protocol ?? "ssh";
  const stateLabel = session.connectionState === "connecting" ? "Connecting" : session.connected ? "Connected" : session.connectionState === "error" ? "Error" : "Closed";
  const connectionTone = session.connected ? "good" : session.connectionState === "connecting" ? "pending" : "bad";
  const latencyTone = (session.host.latency ?? 0) > 150 ? "bad" : (session.host.latency ?? 0) > 50 ? "pending" : "good";
  return <div className={`session-connection-badges ${compact ? "compact" : ""}`}><span className={`terminal-info-badge ${connectionTone}`}><CircleDot size={10} />{stateLabel}</span><span className={`terminal-info-badge protocol ${protocol}`}><ShieldCheck size={10} />{protocol === "ssh" ? "SSH encrypted" : protocol === "telnet" ? "Telnet unencrypted" : "Local serial"}</span><span className={`terminal-info-badge ${session.host.status === "online" ? "good" : session.host.status === "warning" ? "pending" : "bad"}`}><Router size={10} />{statusLabel[session.host.status]}</span>{session.host.latency != null && <span className={`terminal-info-badge latency-badge ${latencyTone}`}><Activity size={10} />{session.host.latency} ms</span>}</div>;
}

function Workspace({ sessions, activeId, session, hosts, userName, autocompleteEnabled, onAuthenticate, onReconnect, onActivate, onClose, onCloseMany, onConnect, onNewSession, onCommand, onTerminalData, onAddDevice, onShowInventory, notify }: { sessions: Session[]; activeId: string | null; session?: Session; hosts: Host[]; userName: string; autocompleteEnabled: boolean; onAuthenticate: (id: string, credentials: ConnectionCredentials) => Promise<void>; onReconnect: (id: string) => Promise<void>; onActivate: (id: string) => void; onClose: (id: string) => void; onCloseMany: (ids: string[]) => void; onConnect: (host: Host) => void; onNewSession: (host: Host) => Promise<string | null>; onCommand: (id: string, lines: TerminalLine[]) => void; onTerminalData: (id: string, data: string) => void; onAddDevice: () => void; onShowInventory: () => void; notify: (message: string) => void }) {
  const [layout, setLayout] = useState<"single" | "split" | "ai">("single");
  const [primaryId, setPrimaryId] = useState<string | null>(activeId);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<string | null>(activeId);
  const [pickerMode, setPickerMode] = useState<"tab" | "split" | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [aiWebMode, setAiWebMode] = useState(false);
  const primary = sessions.find((item) => item.id === primaryId) ?? session;
  const secondary = sessions.find((item) => item.id === secondaryId);
  useEffect(() => {
    if (layout !== "split" && activeId) setPrimaryId(activeId);
  }, [activeId, layout]);
  useEffect(() => {
    if (primaryId && !sessions.some((item) => item.id === primaryId)) setPrimaryId(activeId);
    if (secondaryId && (!sessions.some((item) => item.id === secondaryId) || secondaryId === primaryId)) {
      const replacement = sessions.find((item) => item.id !== primaryId);
      if (replacement) setSecondaryId(replacement.id);
      else {
      setSecondaryId(null);
      setLayout("single");
      }
    }
  }, [sessions, primaryId, secondaryId, activeId, layout]);
  useEffect(() => {
    if (layout !== "split" || (focusedPane !== primary?.id && focusedPane !== secondaryId)) setFocusedPane(primary?.id ?? null);
  }, [layout, primary?.id, secondaryId, focusedPane]);
  useEffect(() => {
    if (!tabContextMenu) return;
    const closeMenu = () => setTabContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("click", closeMenu); window.removeEventListener("blur", closeMenu); window.removeEventListener("keydown", closeOnEscape); };
  }, [tabContextMenu]);
  if (!session || !primary) return <WorkspaceHome hosts={hosts} userName={userName} onConnect={onConnect} onAddDevice={onAddDevice} onShowInventory={onShowInventory} />;
  const toggleSplit = () => {
    if (layout === "split") { setLayout("single"); return; }
    const available = sessions.find((item) => item.id !== primary.id);
    if (available) { setPrimaryId(primary.id); setSecondaryId(available.id); setLayout("split"); }
    else setPickerMode("split");
  };
  const selectDevice = async (host: Host) => {
    const mode = pickerMode;
    setPickerMode(null);
    const id = await onNewSession(host);
    if (id && mode === "split") { setPrimaryId(primary.id); setSecondaryId(id); setLayout("split"); onActivate(primary.id); }
  };
  const activateTab = (id: string) => {
    if (layout === "split" && id === secondaryId) {
      setSecondaryId(primary.id);
      setFocusedPane(id);
    }
    setPrimaryId(id);
    onActivate(id);
  };
  const selectPrimary = (id: string) => {
    if (id === secondaryId) setSecondaryId(primary.id);
    setPrimaryId(id);
    onActivate(id);
    setFocusedPane(id);
  };
  const selectSecondary = (id: string) => {
    if (!secondary) return;
    if (id === primary.id) { setPrimaryId(secondary.id); setSecondaryId(primary.id); onActivate(secondary.id); }
    else setSecondaryId(id);
    setFocusedPane(id);
  };
  return (
    <section className="terminal-layout">
      <div className="session-tabs">
        {sessions.map((item) => <button key={item.id} className={`session-tab ${item.id === activeId ? "active" : ""}`} onClick={() => activateTab(item.id)} onContextMenu={(event) => { event.preventDefault(); setSessionMenuOpen(false); setTabContextMenu({ id: item.id, x: Math.min(event.clientX, window.innerWidth - 225), y: Math.min(event.clientY, window.innerHeight - 145) }); }}><span className={`device-state ${item.host.status}`} /><span>{item.host.name}</span><X size={13} onClick={(event) => { event.stopPropagation(); onClose(item.id); }} /></button>)}
        <button className="new-tab" aria-label="Open new session tab" title="Open new session tab" onClick={() => setPickerMode("tab")}><Plus size={15} /></button>
      </div>
      {tabContextMenu && <div className="tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => { onClose(tabContextMenu.id); setTabContextMenu(null); }}><X size={14} /><span>Close tab</span></button><button disabled={sessions.length < 2} onClick={() => { onCloseMany(sessions.filter((item) => item.id !== tabContextMenu.id).map((item) => item.id)); setTabContextMenu(null); }}><Layers3 size={14} /><span>Close other tabs</span></button><div /><button className="menu-danger" onClick={() => { onCloseMany(sessions.map((item) => item.id)); setTabContextMenu(null); }}><Trash2 size={14} /><span>Close all tabs</span></button></div>}
      <div className="terminal-toolbar"><div className="terminal-toolbar-device"><CircleDot size={14} /><strong>{primary.host.name}</strong><span className="terminal-toolbar-address">{primary.host.address}</span><SessionConnectionBadges session={primary} /></div><div className="terminal-toolbar-actions"><button className="terminal-toolbar-action" disabled={primary.connectionState === "connecting"} aria-label={`Reconnect ${primary.host.name}`} title={`Reconnect ${primary.host.name}`} onClick={() => void onReconnect(primary.id)}><RefreshCw size={14} className={primary.connectionState === "connecting" ? "spin" : ""} /><span>Reconnect</span></button><button className="terminal-toolbar-action" disabled={!primary.lines.length} aria-label={`Save ${primary.host.name} terminal transcript`} title="Save terminal transcript as a text file" onClick={() => { saveTerminalTranscript(primary); notify("Terminal transcript saved"); }}><FileDown size={14} /><span>Save log</span></button><button className={layout === "split" ? "toolbar-active" : ""} aria-label="Toggle split sessions" title="Toggle split sessions" onClick={toggleSplit}><Grid2X2 size={15} /></button><button className={layout === "ai" ? "toolbar-active" : ""} aria-label="Toggle AI side panel" title="Toggle AI side panel" onClick={() => setLayout(layout === "ai" ? "single" : "ai")}><Bot size={15} /></button><div className="session-menu-wrap"><button className={sessionMenuOpen ? "toolbar-active" : ""} aria-label="Session options" onClick={() => { setTabContextMenu(null); setSessionMenuOpen((open) => !open); }}><MoreHorizontal size={16} /></button>{sessionMenuOpen && <div className="session-menu"><button onClick={async () => { setSessionMenuOpen(false); await onNewSession(primary.host); }}><Plus size={14} /><span><strong>Duplicate tab</strong><small>Open another independent session</small></span></button><button onClick={() => { setSessionMenuOpen(false); toggleSplit(); }}><Grid2X2 size={14} /><span><strong>{layout === "split" ? "Close split view" : "Split with session"}</strong><small>{layout === "split" ? "Return to one pane" : "Choose a second device pane"}</small></span></button><button onClick={() => { navigator.clipboard?.writeText(primary.host.address); setSessionMenuOpen(false); notify("Address copied"); }}><Copy size={14} /><span><strong>Copy address</strong><small>{primary.host.address}</small></span></button>{primary.host.credentialId && <button onClick={() => { setSessionMenuOpen(false); writeTerminalEnablePassword(primary.id, primary.host.credentialId!).then(() => notify("Enable password sent securely")).catch((caught) => notify((caught as Error).message)); }}><KeyRound size={14} /><span><strong>Send enable password</strong><small>Use only at the device enable prompt</small></span></button>}<button className="menu-danger" onClick={() => { setSessionMenuOpen(false); onClose(primary.id); }}><Trash2 size={14} /><span><strong>Close session</strong><small>Close this workspace tab</small></span></button><button className="menu-danger" onClick={() => { setSessionMenuOpen(false); onCloseMany(sessions.map((item) => item.id)); }}><Trash2 size={14} /><span><strong>Close all sessions</strong><small>Close every workspace tab</small></span></button></div>}</div></div></div>
      {layout === "single" && <Terminal session={primary} autocompleteEnabled={autocompleteEnabled} onAuthenticate={onAuthenticate} onReconnect={() => onReconnect(primary.id)} onData={(data) => onTerminalData(primary.id, data)} />}
      {layout === "split" && secondary && <div className="workspace-panes"><SessionPane session={primary} sessions={sessions} excludedId={secondary.id} active={focusedPane === primary.id} autocompleteEnabled={autocompleteEnabled} onAuthenticate={onAuthenticate} onReconnect={() => onReconnect(primary.id)} onSelect={selectPrimary} onActivate={() => setFocusedPane(primary.id)} onData={(data) => onTerminalData(primary.id, data)} /><SessionPane session={secondary} sessions={sessions} excludedId={primary.id} active={focusedPane === secondary.id} autocompleteEnabled={autocompleteEnabled} onAuthenticate={onAuthenticate} onReconnect={() => onReconnect(secondary.id)} onSelect={selectSecondary} onActivate={() => setFocusedPane(secondary.id)} onData={(data) => onTerminalData(secondary.id, data)} /></div>}
      {layout === "ai" && <div className={`workspace-panes ai-workspace ${aiWebMode ? "web-provider-workspace" : ""}`}><SessionPane session={primary} sessions={sessions} active autocompleteEnabled={autocompleteEnabled} onAuthenticate={onAuthenticate} onReconnect={() => onReconnect(primary.id)} onSelect={(id) => { setPrimaryId(id); onActivate(id); }} onActivate={() => onActivate(primary.id)} onData={(data) => onTerminalData(primary.id, data)} /><AiSidePanel session={primary} notify={notify} onWebModeChange={setAiWebMode} /></div>}
      {pickerMode && <SessionPicker hosts={hosts} title={pickerMode === "split" ? "Open session beside this one" : "Open a new session tab"} onClose={() => setPickerMode(null)} onSelect={selectDevice} onAddDevice={() => { setPickerMode(null); onAddDevice(); }} />}
    </section>
  );
}

function SessionPane({ session, sessions, excludedId, active, autocompleteEnabled, onAuthenticate, onReconnect, onSelect, onActivate, onData }: { session: Session; sessions: Session[]; excludedId?: string; active: boolean; autocompleteEnabled: boolean; onAuthenticate: (id: string, credentials: ConnectionCredentials) => Promise<void>; onReconnect: () => Promise<void>; onSelect: (id: string) => void; onActivate: () => void; onData: (data: string) => void }) {
  return <section className={`session-pane ${active ? "active" : ""}`} onMouseDown={onActivate}><div className="pane-heading"><span className={`device-state ${session.host.status}`} /><div className="pane-session-select"><select aria-label="Session displayed in this pane" value={session.id} onChange={(event) => { event.stopPropagation(); onSelect(event.target.value); }}>{sessions.map((item) => <option value={item.id} disabled={item.id === excludedId} key={item.id}>{item.host.name} · {item.host.address}</option>)}</select><ChevronDown size={12} /></div><SessionConnectionBadges session={session} compact /></div><Terminal session={session} autoFocus={active} autocompleteEnabled={autocompleteEnabled} onAuthenticate={onAuthenticate} onReconnect={onReconnect} onData={onData} /></section>;
}

function SessionPicker({ hosts, title, onClose, onSelect, onAddDevice }: { hosts: Host[]; title: string; onClose: () => void; onSelect: (host: Host) => void; onAddDevice: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = hosts.filter((host) => `${host.name} ${host.address} ${host.site} ${host.platform}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="session-picker" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><TerminalSquare size={18} /></span><div><h3>{title}</h3><p>Each selection creates an independent workspace tab.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="picker-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices by name, address, site, or platform" /></div><div className="picker-devices">{filtered.map((host) => <button key={host.id} onClick={() => onSelect(host)}><span className="device-icon"><Router size={17} /></span><span><strong>{host.name}</strong><small>{host.address} · {host.site}</small></span><span className="protocol-pill">{(host.protocol ?? "ssh").toUpperCase()}</span><ChevronRight size={15} /></button>)}{filtered.length === 0 && <div className="picker-empty"><Search size={22} /><span>No matching devices</span></div>}</div><div className="picker-footer"><span>{hosts.length} inventory devices</span><button className="secondary-button" onClick={onAddDevice}><Plus size={14} /> Add device</button></div></section></div>;
}

function AiSidePanel({ session, notify, onWebModeChange }: { session: Session; notify: (message: string) => void; onWebModeChange: (active: boolean) => void }) {
  const [provider, setProvider] = useState<AiProvider>("demo");
  const [webProvider, setWebProvider] = useState<"openai" | "gemini" | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([{ ...assistantWelcome, id: `side-welcome-${session.id}`, content: `I’m ready to help with ${session.host.name}. Enable session context below if you want to include recent terminal output.` }]);
  const [draft, setDraft] = useState("");
  const [attachContext, setAttachContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState<Record<"openai" | "gemini", boolean>>({ openai: false, gemini: false });
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { Promise.all([providerIsConnected("openai"), providerIsConnected("gemini")]).then(([openai, gemini]) => setConnected({ openai, gemini })); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => {
    onWebModeChange(webProvider !== null);
    return () => onWebModeChange(false);
  }, [webProvider, onWebModeChange]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean || sending) return;
    if (provider !== "demo" && !connected[provider]) { notify(`Connect ${aiProviders[provider].name} in the AI assistant settings first`); return; }
    const context = attachContext ? `\n\nSession context from ${session.host.name} (${session.host.platform}):\n${session.lines.slice(-6).map((line) => line.text).join("\n")}` : "";
    const userMessage: AiMessage = { id: crypto.randomUUID(), role: "user", content: clean, createdAt: Date.now() };
    const requestMessage: AiMessage = { ...userMessage, content: `${clean}${context}` };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages); setDraft(""); setSending(true);
    try {
      const response = await sendAiMessage(provider, [...messages, requestMessage]);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response, createdAt: Date.now() }]);
    } catch (caught) { notify((caught as Error).message); }
    finally { setSending(false); }
  };
  const selectProvider = (value: string) => {
    if (value === "openai-web" || value === "gemini-web") {
      if (!isNativeApp()) {
        notify("Embedded provider web chat is available in the NetSSH desktop app.");
        return;
      }
      setWebProvider(value === "openai-web" ? "openai" : "gemini");
      return;
    }
    setWebProvider(null);
    setProvider(value as AiProvider);
  };
  return <aside className="workspace-ai"><div className="workspace-ai-head"><div><span><BrainCircuit size={16} /></span><div><strong>Network copilot</strong><small>Beside {session.host.name}</small></div></div><div className="provider-select"><span className="provider-dot" style={{ background: aiProviders[webProvider ?? provider].accent }} /><select value={webProvider ? `${webProvider}-web` : provider} onChange={(event) => selectProvider(event.target.value)} aria-label="Side panel AI provider"><option value="demo">Demo</option><option value="openai">OpenAI API</option><option value="gemini">Gemini API</option><option value="openai-web">ChatGPT Web</option><option value="gemini-web">Gemini Web</option></select><ChevronDown size={13} /></div></div>{webProvider ? <EmbeddedProviderView provider={webProvider} notify={notify} compact onExternal={() => setWebProvider(null)} /> : <><div className="workspace-ai-notice"><ShieldCheck size={13} />Session output is excluded unless you enable context.</div><div className="side-chat-scroll">{messages.map((message) => <ChatMessage key={message.id} message={message} provider={provider} />)}{sending && <div className="chat-message assistant-message"><span className="message-avatar"><Bot size={15} /></span><div className="message-bubble typing"><i /><i /><i /></div></div>}<div ref={bottomRef} /></div><form className="side-composer" onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this session…" rows={3} /><label><input type="checkbox" checked={attachContext} onChange={(event) => setAttachContext(event.target.checked)} /><span><Layers3 size={12} /> Include recent session context</span></label><button className="primary-button" disabled={!draft.trim() || sending}><Send size={14} /> Send</button></form></>}</aside>;
}

function WorkspaceHome({ hosts, userName, onConnect, onAddDevice, onShowInventory }: { hosts: Host[]; userName: string; onConnect: (host: Host) => void; onAddDevice: () => void; onShowInventory: () => void }) {
  const [advisories, setAdvisories] = useState<SecurityAdvisory[]>(securityFeedFallback);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedStatus, setFeedStatus] = useState("Loading official feeds");
  const refreshFeed = async () => {
    setFeedLoading(true);
    try {
      const latest = await fetchSecurityAdvisories();
      setAdvisories(latest);
      setFeedStatus(latest === securityFeedFallback ? "Official source shortcuts" : "Live · Cisco and Fortinet");
    } catch {
      setAdvisories(securityFeedFallback);
      setFeedStatus("Feed unavailable · official links shown");
    } finally {
      setFeedLoading(false);
    }
  };
  useEffect(() => { void refreshFeed(); }, []);
  return (
    <div className="page workspace-home">
      <div className="workspace-overview">
        <section className="welcome-card">
          <span className="welcome-icon"><TerminalSquare size={21} /></span>
          <div className="welcome-copy"><span className="eyebrow"><Sparkles size={13} /> NetSSH workspace</span><h2>Welcome back{userName ? `, ${userName.split(/\s+/)[0]}` : ""}</h2><p>Select a recent device or start a new connection.</p></div>
          <div className="welcome-actions"><button className="primary-button" onClick={() => hosts[0] ? onConnect(hosts[0]) : onAddDevice()}><TerminalSquare size={16} /> Connect</button><button className="secondary-button" onClick={onAddDevice}><Plus size={16} /> Add device</button></div>
          <div className="welcome-devices">{hosts.slice(0, 3).map((host) => <button key={host.id} onClick={() => onConnect(host)}><span className={`device-state ${host.status}`} /><span><strong>{host.name}</strong><small>{host.address}</small></span><ChevronRight size={14} /></button>)}</div>
        </section>
        <section className="panel security-feed-panel">
          <div className="panel-title"><div><h3><Rss size={15} /> Network security feed</h3><p>{feedStatus}</p></div><button className={feedLoading ? "feed-refresh loading" : "feed-refresh"} onClick={() => void refreshFeed()} disabled={feedLoading} aria-label="Refresh network security feed"><RefreshCw size={15} /></button></div>
          <div className="security-feed-list">{advisories.slice(0, 5).map((advisory) => <button className="security-feed-row" key={advisory.id} onClick={() => void openSecurityAdvisory(advisory.url)}><span className={`advisory-vendor ${advisory.vendor.toLowerCase()}`}>{advisory.vendor}</span><span className="advisory-copy"><strong>{advisory.title}</strong><small>{advisory.published}</small></span><span className={`advisory-severity ${advisory.severity.toLowerCase()}`}>{advisory.severity}</span><ExternalLink size={13} /></button>)}</div>
          <div className="security-feed-note"><ShieldCheck size={13} /> Always confirm affected releases in the vendor advisory before changing software.</div>
        </section>
      </div>
      <div className="section-heading"><div><h3>Jump back in</h3><p>Your recently accessed devices</p></div><button onClick={onShowInventory}>View inventory <ChevronRight size={15} /></button></div>
      <div className="device-grid">{hosts.slice(0, 4).map((host) => <DeviceCard key={host.id} host={host} onConnect={onConnect} />)}</div>
      <div className="dashboard-grid">
        <section className="panel activity-panel"><div className="panel-title"><div><h3>Network pulse</h3><p>Live overview</p></div><span className="live-pill"><i /> Live</span></div><div className="metrics"><Metric icon={Gauge} value="99.7%" label="Availability" trend="+0.2%" /><Metric icon={Activity} value="18 ms" label="Avg latency" trend="-3 ms" /><Metric icon={Server} value="5 / 6" label="Reachable" trend="1 alert" warning /></div></section>
        <section className="panel command-panel"><div className="panel-title"><div><h3>Recent commands</h3><p>Run again in one click</p></div><button><MoreHorizontal size={17} /></button></div>{recentCommands.slice(0, 3).map((command) => <div className="command-row" key={command}><code>{command}</code><button><Copy size={14} /></button></div>)}</section>
      </div>
    </div>
  );
}

function DeviceCard({ host, onConnect, onFavorite }: { host: Host; onConnect: (host: Host) => void; onFavorite?: (id: string) => void }) {
  return <button className="device-card" onClick={() => onConnect(host)}><div className="device-top"><span className="device-icon"><Router size={20} /></span><Star size={15} role={onFavorite ? "button" : undefined} tabIndex={onFavorite ? 0 : undefined} aria-label={host.favorite ? `Remove ${host.name} from favourites` : `Add ${host.name} to favourites`} className={host.favorite ? "starred" : ""} onClick={(event) => { if (!onFavorite) return; event.stopPropagation(); onFavorite(host.id); }} onKeyDown={(event) => { if (onFavorite && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); onFavorite(host.id); } }} /></div><strong>{host.name}</strong><code>{host.address}</code><div className="device-meta"><span className={`device-state ${host.status}`} />{statusLabel[host.status]}<span>·</span>{host.latency ? `${host.latency} ms` : "No response"}</div><div className="device-footer"><span>{deviceRoleLabel(host)} · {host.platform} · {(host.protocol ?? "ssh").toUpperCase()}</span><ChevronRight size={15} /></div></button>;
}

function Metric({ icon: Icon, value, label, trend, warning }: { icon: typeof Gauge; value: string; label: string; trend: string; warning?: boolean }) {
  return <div className="metric"><span className="metric-icon"><Icon size={18} /></span><div><strong>{value}</strong><span>{label}</span></div><em className={warning ? "warning" : ""}>{trend}</em></div>;
}

function TerminalLogin({ session, onAuthenticate }: { session: Session; onAuthenticate: (id: string, credentials: ConnectionCredentials) => Promise<void> }) {
  const [username, setUsername] = useState(session.suggestedUsername ?? "");
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || submitting) return;
    setSubmitting(true);
    await onAuthenticate(session.id, { username: username.trim(), password: password || undefined, savePassword: Boolean(password) && savePassword });
    setSubmitting(false);
  };
  return <div className="terminal terminal-login"><form onSubmit={submit}><div className="terminal-login-brand"><TerminalSquare size={20} /><span><strong>{session.host.name}</strong><small>{session.host.address} · SSH authentication</small></span></div><p>SSH authenticates before the switch can open its command prompt. Enter a username, or assign a saved login to connect automatically next time.</p><label><span>Username</span><input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label><span>Password <em>optional</em></span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Leave blank for keyboard-interactive or passwordless login" /></label>{session.host.credentialId && password && <label className="terminal-login-save"><input type="checkbox" checked={savePassword} onChange={(event) => setSavePassword(event.target.checked)} /><span>Save to the assigned credential profile</span></label>}<button className="primary-button" disabled={!username.trim() || submitting}>{submitting ? "Connecting…" : password ? "Connect" : "Try without password"}</button></form><div className="terminal-status disconnected"><span><i /> SSH · Waiting for login</span><span>Credentials stay local</span></div></div>;
}

function Terminal({ session, onData, onAuthenticate, onReconnect, autocompleteEnabled, autoFocus = true }: { session: Session; onData: (data: string) => void; onAuthenticate: (id: string, credentials: ConnectionCredentials) => Promise<void>; onReconnect: () => Promise<void>; autocompleteEnabled: boolean; autoFocus?: boolean }) {
  if (session.connectionState === "awaiting-credentials") return <TerminalLogin session={session} onAuthenticate={onAuthenticate} />;
  return <InteractiveTerminal session={session} onData={onData} onReconnect={onReconnect} autocompleteEnabled={autocompleteEnabled} autoFocus={autoFocus} />;
}

function InteractiveTerminal({ session, onData, onReconnect, autocompleteEnabled, autoFocus = true }: { session: Session; onData: (data: string) => void; onReconnect: () => Promise<void>; autocompleteEnabled: boolean; autoFocus?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const onDataRef = useRef(onData);
  const onReconnectRef = useRef(onReconnect);
  const connectedRef = useRef(session.connected);
  const connectionStateRef = useRef(session.connectionState);
  const renderedLines = useRef(0);
  const inputBuffer = useRef("");
  const suggestionRef = useRef<CiscoCommandSuggestion | null>(null);
  const suggestionsRef = useRef<CiscoCommandSuggestion[]>([]);
  const [suggestions, setSuggestions] = useState<CiscoCommandSuggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  onDataRef.current = onData;
  onReconnectRef.current = onReconnect;
  connectedRef.current = session.connected || session.connectionState === "connecting";
  connectionStateRef.current = session.connectionState;

  const updateSuggestions = (value: string) => {
    const matches = autocompleteEnabled ? findCiscoCommandSuggestions(value) : [];
    suggestionsRef.current = matches;
    suggestionRef.current = matches[0] ?? null;
    setSuggestionIndex(0);
    setSuggestions(matches);
  };

  const acceptSuggestion = (suggestion: CiscoCommandSuggestion) => {
    const command = suggestion.command;
    const leadingWhitespace = inputBuffer.current.match(/^\s*/)?.[0] ?? "";
    const enteredCommand = inputBuffer.current.slice(leadingWhitespace.length);
    if (command.toLowerCase().startsWith(enteredCommand.toLowerCase())) {
      const suffix = command.slice(enteredCommand.length);
      if (suffix) onDataRef.current(suffix);
    } else {
      onDataRef.current(`\u0015${leadingWhitespace}${command}`);
    }
    inputBuffer.current = `${leadingWhitespace}${command}`;
    suggestionsRef.current = [];
    suggestionRef.current = null;
    setSuggestions([]);
    terminalRef.current?.focus();
    requestAnimationFrame(() => terminalRef.current?.focus());
  };

  const moveSuggestion = (direction: number) => {
    const availableSuggestions = suggestionsRef.current;
    if (!availableSuggestions.length) return;
    setSuggestionIndex((current) => {
      const next = (current + direction + availableSuggestions.length) % availableSuggestions.length;
      suggestionRef.current = availableSuggestions[next] ?? null;
      return next;
    });
  };

  const writeLine = (terminal: XTerm, line: TerminalLine) => {
    if (line.kind === "output") terminal.write(line.text);
    else if (line.kind === "command") terminal.write(`\r\n\x1b[1;32m${line.text}\x1b[0m`);
    else if (line.kind === "warning") terminal.write(`\r\n\x1b[1;31m${line.text}\x1b[0m\r\n`);
    else terminal.write(`\r\n\x1b[36m${line.text}\x1b[0m\r\n`);
  };

  const copySelection = async () => {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) return;
    await writeClipboardText(terminal.getSelection());
    terminal.focus();
    setContextMenu(null);
  };

  const pasteClipboard = async () => {
    const terminal = terminalRef.current;
    if (!terminal || !connectedRef.current) return;
    try {
      const text = await readClipboardText();
      if (text) onDataRef.current(text.replace(/\r?\n/g, "\r"));
      terminal.focus();
      setContextMenu(null);
    } catch {
      terminal.write("\r\n\x1b[33mClipboard access was not available. Use the operating-system paste shortcut.\x1b[0m\r\n");
    }
  };

  const selectAll = () => {
    terminalRef.current?.selectAll();
    terminalRef.current?.focus();
    setContextMenu(null);
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: "#070b10",
        foreground: "#d7dee7",
        cursor: "#72e6b1",
        cursorAccent: "#07100c",
        selectionBackground: "#285844",
        black: "#0a0f14", red: "#ff7b72", green: "#72e6b1", yellow: "#e3b341", blue: "#79c0ff", magenta: "#d2a8ff", cyan: "#56d4dd", white: "#d7dee7",
        brightBlack: "#64717e", brightRed: "#ffa198", brightGreen: "#aff5b4", brightYellow: "#f2cc60", brightBlue: "#a5d6ff", brightMagenta: "#e2c5ff", brightCyan: "#a2e8ec", brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    session.lines.forEach((line) => writeLine(terminal, line));
    renderedLines.current = session.lines.length;
    const fit = () => {
      try {
        fitAddon.fit();
        void resizeTerminal(session.id, terminal.cols, terminal.rows);
      } catch {}
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(hostRef.current);
    const dataSubscription = terminal.onData((data) => {
      if (connectedRef.current) {
        terminal.scrollToBottom();
        if (autocompleteEnabled) {
          if (data === "\r" || data === "\n" || data === "\u0003" || data === "\u0015") inputBuffer.current = "";
          else if (data === "\u007f" || data === "\b") inputBuffer.current = inputBuffer.current.slice(0, -1);
          else if (!data.startsWith("\u001b") && [...data].every((character) => character >= " ")) inputBuffer.current += data;
          updateSuggestions(inputBuffer.current);
        }
        onDataRef.current(data);
      }
      else terminal.write("\r\n\x1b[31mThis session is not connected.\x1b[0m\r\n");
    });
    const selectionSubscription = terminal.onSelectionChange(() => {
      if (terminal.hasSelection()) void writeClipboardText(terminal.getSelection()).catch(() => undefined);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (!connectedRef.current && !event.ctrlKey && !event.metaKey && !event.altKey && key === "r" && ["closed", "error"].includes(connectionStateRef.current ?? "")) {
        event.preventDefault();
        event.stopPropagation();
        void onReconnectRef.current();
        return false;
      }
      if (autocompleteEnabled && suggestionsRef.current.length && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        event.stopPropagation();
        moveSuggestion(event.key === "ArrowRight" ? 1 : -1);
        return false;
      }
      if (autocompleteEnabled && (event.key === "Tab" || (event.key === "Enter" && event.ctrlKey)) && suggestionRef.current) {
        event.preventDefault();
        event.stopPropagation();
        acceptSuggestion(suggestionRef.current);
        return false;
      }
      if (autocompleteEnabled && event.key === "Escape" && suggestionsRef.current.length) {
        event.preventDefault();
        suggestionsRef.current = [];
        suggestionRef.current = null;
        setSuggestions([]);
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && key === "c" && terminal.hasSelection()) {
        void copySelection();
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && key === "v") {
        void pasteClipboard();
        return false;
      }
      if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && key === "a") {
        selectAll();
        return false;
      }
      return true;
    });
    requestAnimationFrame(() => { fit(); if (autoFocus) terminal.focus(); });
    return () => {
      dataSubscription.dispose();
      selectionSubscription.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      renderedLines.current = 0;
    };
  }, [session.id, autocompleteEnabled]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    session.lines.slice(renderedLines.current).forEach((line) => writeLine(terminal, line));
    renderedLines.current = session.lines.length;
    terminal.scrollToBottom();
  }, [session.lines]);

  useEffect(() => {
    if (autoFocus) terminalRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    autocompleteRef.current?.querySelector("button.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [suggestionIndex, suggestions]);

  useEffect(() => {
    const closeContextMenu = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeContextMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeContextMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const stateLabel = session.connectionState === "connecting" ? "Connecting" : session.connected ? "Connected" : session.connectionState === "error" ? "Error" : "Closed";
  const canReconnect = !session.connected && ["closed", "error"].includes(session.connectionState ?? "");
  return <div className="terminal terminal-shell"><div className="xterm-host" ref={hostRef} aria-label={`${session.host.name} interactive terminal`} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); }} />{contextMenu && <div ref={contextMenuRef} className="terminal-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onContextMenu={(event) => event.preventDefault()}><button type="button" disabled={!terminalRef.current?.hasSelection()} onClick={() => void copySelection()}><Copy size={14} /><span>Copy selection</span><kbd>Ctrl+C</kbd></button><button type="button" disabled={!session.connected} onClick={() => void pasteClipboard()}><ClipboardPaste size={14} /><span>Paste</span><kbd>Ctrl+V</kbd></button><div /><button type="button" onClick={selectAll}><Check size={14} /><span>Select all</span><kbd>Ctrl+Shift+A</kbd></button><button type="button" onClick={() => { terminalRef.current?.clearSelection(); terminalRef.current?.focus(); setContextMenu(null); }}><X size={14} /><span>Clear selection</span></button></div>}<div ref={autocompleteRef} className={`terminal-autocomplete ${suggestions.length ? "has-suggestions" : "idle"}`}><div className="terminal-autocomplete-heading"><span><Sparkles size={11} /> Command assist</span><small><kbd>←→</kbd> navigate <kbd>Tab</kbd> accept <kbd>Esc</kbd> close</small></div>{suggestions.length ? suggestions.map((suggestion, index) => <button key={suggestion.command} title={suggestion.description} aria-label={`${suggestion.command}. ${suggestion.description}`} className={index === suggestionIndex ? `active ${suggestion.kind}` : suggestion.kind} onMouseEnter={() => { suggestionRef.current = suggestion; setSuggestionIndex(index); }} onMouseDown={(event) => event.preventDefault()} onClick={() => acceptSuggestion(suggestion)}><Command size={11} /><code>{suggestion.command}</code><em>{suggestion.kind === "show" ? "Read only" : suggestion.kind === "action" ? "Review" : "Configure"}</em></button>) : <span className="terminal-autocomplete-idle">Type a Cisco command or abbreviation · ← → select · Tab accept</span>}</div><div className={`terminal-status ${session.connected ? "connected" : "disconnected"}`}><span><i /> {(session.host.protocol ?? "ssh").toUpperCase()} · {stateLabel}</span>{canReconnect && <span className="terminal-reconnect-hint">Press R or use Reconnect</span>}<span>{autocompleteEnabled ? "Autocomplete on" : "Autocomplete off"}</span><span>xterm-256color</span><span>UTF-8</span><div className="terminal-actions">{canReconnect && <button className="terminal-reconnect-button" type="button" onClick={() => void onReconnect()} title="Reconnect session (R)"><RefreshCw size={11} /> Reconnect</button>}<button type="button" onClick={() => void copySelection()} title="Copy selection (Ctrl+C / Cmd+C)"><Copy size={11} /> Copy</button><button type="button" onClick={() => void pasteClipboard()} title="Paste (Ctrl+V / Cmd+V)"><ClipboardPaste size={11} /> Paste</button><button type="button" onClick={() => { terminalRef.current?.clear(); terminalRef.current?.focus(); }} title="Clear local scrollback"><Trash2 size={11} /> Clear</button></div></div></div>;
}

function Inventory({ hosts, onConnect, onAdd, onTransfer, onEdit, onFavorite, onDelete }: { hosts: Host[]; onConnect: (host: Host) => void; onAdd: () => void; onTransfer: () => void; onEdit: (host: Host) => void; onFavorite: (id: string) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("all");
  const [status, setStatus] = useState<"all" | Host["status"]>("all");
  const [role, setRole] = useState<"all" | DeviceRole>("all");
  const [pendingDelete, setPendingDelete] = useState<Host | null>(null);
  const sites = [...new Set(hosts.map((host) => host.site))].sort();
  const filtered = hosts.filter((host) => {
    const matchesQuery = `${host.name} ${host.address} ${host.platform} ${host.site} ${deviceRoleLabel(host)} ${(host.tags ?? []).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (site === "all" || host.site === site) && (status === "all" || host.status === status) && (role === "all" || deviceRoleValue(host) === role);
  });
  const resetFilters = () => { setQuery(""); setSite("all"); setStatus("all"); setRole("all"); };
  return <div className="page"><div className="page-intro"><div><h2>All devices</h2><p>Your complete network inventory in one place.</p></div><div className="inventory-page-actions"><button className="secondary-button" onClick={onTransfer}><FileUp size={16} /> Import / export</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add device</button></div></div><div className="filter-bar"><div className="input-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, IP, role, vendor, site, or tag" /></div><div className="select-wrap"><select aria-label="Filter by device role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="all">All device roles</option>{deviceRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={14} /></div><div className="select-wrap"><select aria-label="Filter by site" value={site} onChange={(event) => setSite(event.target.value)}><option value="all">All sites</option>{sites.map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></div><div className="select-wrap"><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="online">Reachable</option><option value="warning">Attention</option><option value="offline">Offline</option></select><ChevronDown size={14} /></div></div><div className="inventory-summary"><span>{filtered.length} of {hosts.length} devices</span>{(query || role !== "all" || site !== "all" || status !== "all") && <button onClick={resetFilters}><X size={12} /> Clear filters</button>}</div><section className="inventory-table"><div className="table-row table-head"><span>Device</span><span>Address</span><span>Role</span><span>Platform</span><span>Site</span><span>Status</span><span /></div>{filtered.map((host) => <div className="table-row" key={host.id}><span className="table-device"><span className="device-icon"><Router size={18} /></span><span><strong>{host.name}</strong><small>{(host.protocol ?? "ssh").toUpperCase()} · {host.protocol === "serial" ? `${host.address} @ ${host.baudRate ?? 9600}` : `${host.username ? `${host.username}@` : ""}${host.address}:${host.port ?? (host.protocol === "telnet" ? 23 : 22)}`}</small></span></span><code>{host.address}</code><span className="device-role-pill">{deviceRoleLabel(host)}</span><span>{host.platform}</span><span>{host.site}</span><span className={`status-pill ${host.status}`}><i />{statusLabel[host.status]}</span><span className="row-actions"><button className="delete-device favorite-device" aria-label={host.favorite ? `Remove ${host.name} from favourites` : `Add ${host.name} to favourites`} onClick={() => onFavorite(host.id)}><Star size={14} className={host.favorite ? "starred" : ""} /></button><button className="delete-device" aria-label={`Edit ${host.name}`} onClick={() => onEdit(host)}><Pencil size={14} /></button><button className="connect-button" disabled={host.status === "offline"} onClick={() => onConnect(host)}>Connect <ChevronRight size={14} /></button><button className="delete-device" aria-label={`Delete ${host.name}`} onClick={() => setPendingDelete(host)}><Trash2 size={14} /></button></span></div>)}{filtered.length === 0 && <div className="empty-inventory"><Search size={24} /><strong>No devices found</strong><span>Change the filters or add a new device.</span><button className="secondary-button" onClick={resetFilters}>Reset filters</button></div>}</section>{pendingDelete && <ConfirmModal title={`Remove ${pendingDelete.name}?`} message="This removes the device assignment but leaves reusable login profiles untouched. Existing terminal sessions remain open." confirmLabel="Remove device" onCancel={() => setPendingDelete(null)} onConfirm={() => { onDelete(pendingDelete.id); setPendingDelete(null); }} />}</div>;
}

function SessionTransferModal({ hosts, credentialProfiles, configuredSites, onClose, onImport, notify }: { hosts: Host[]; credentialProfiles: CredentialProfile[]; configuredSites: string[]; onClose: () => void; onImport: (sessions: ImportedSession[], source: string) => { added: number; duplicates: number; profiles: number }; notify: (message: string) => void }) {
  const [mode, setMode] = useState<"import" | "export">("import");
  const [format, setFormat] = useState<SessionImportFormat>("auto");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseSessionImport> | null>(null);
  const [error, setError] = useState("");
  const [importSite, setImportSite] = useState("__source__");
  const [customSite, setCustomSite] = useState("");
  const importSites = [...new Set([...configuredSites, ...hosts.map((host) => host.site)])].filter(Boolean).sort();
  const download = (name: string, type: string, value: string) => {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    notify(`${name} exported`);
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    setContent(decodeSessionFile(await file.arrayBuffer()));
    setFileName(file.name);
    setPreview(null);
    setError("");
  };
  const inspect = () => {
    try { setPreview(parseSessionImport(content, format)); setError(""); }
    catch (caught) { setPreview(null); setError(`Unable to parse this file: ${(caught as Error).message}`); }
  };
  const applyImport = () => {
    if (!preview?.sessions.length) return;
    const selectedSite = importSite === "__source__" ? null : importSite === "__new__" ? customSite.trim() : importSite;
    if (importSite === "__new__" && !selectedSite) { setError("Enter a site name for the imported sessions"); return; }
    const source = preview.format === "putty" ? "PuTTY" : preview.format === "mobaxterm" ? "MobaXterm" : preview.format === "netssh" ? "NetSSH" : "CSV";
    const sessions = selectedSite ? preview.sessions.map((session) => ({ ...session, site: selectedSite })) : preview.sessions;
    const summary = onImport(sessions, source);
    notify(`Imported ${summary.added} sessions · skipped ${summary.duplicates} duplicates · created ${summary.profiles} login profiles`);
    onClose();
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="session-transfer-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><FileUp size={18} /></span><div><h3>Import and export sessions</h3><p>Move device connection profiles without moving passwords.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="transfer-tabs"><button className={mode === "import" ? "active" : ""} onClick={() => setMode("import")}><FileUp size={15} /> Import</button><button className={mode === "export" ? "active" : ""} onClick={() => setMode("export")}><FileDown size={15} /> Export</button></div>{mode === "import" ? <div className="transfer-body"><div className="transfer-format"><label><span>Source format</span><select value={format} onChange={(event) => { setFormat(event.target.value as SessionImportFormat); setPreview(null); }}><option value="auto">Detect automatically</option><option value="netssh">NetSSH JSON</option><option value="putty">PuTTY registry export (.reg)</option><option value="mobaxterm">MobaXterm sessions / INI</option><option value="csv">CSV</option></select></label><label className="transfer-file"><span>Choose file</span><input type="file" accept=".json,.csv,.reg,.ini,.mxtsessions,.txt" onChange={(event) => void loadFile(event.target.files?.[0])} /><strong><FileUp size={14} />{fileName || "Browse for session file"}</strong></label></div><div className="transfer-import-site"><label><span>Import into site</span><select value={importSite} onChange={(event) => { setImportSite(event.target.value); setError(""); }}><option value="__source__">Keep source folders / sites</option>{importSites.map((site) => <option value={site} key={site}>{site}</option>)}<option value="__new__">Create a new site…</option></select></label>{importSite === "__new__" && <label><span>New site name</span><input value={customSite} onChange={(event) => setCustomSite(event.target.value)} placeholder="Branch offices" /></label>}</div><label className="transfer-content"><span>File contents</span><textarea value={content} onChange={(event) => { setContent(event.target.value); setPreview(null); }} rows={10} placeholder="Choose a file or paste exported session data here…" spellCheck={false} /></label>{error && <div className="modal-error">{error}</div>}{preview && <div className="transfer-preview"><div><strong>{preview.sessions.length}</strong><span>sessions detected</span></div><div><strong>{preview.format === "mobaxterm" ? "MobaXterm" : preview.format === "putty" ? "PuTTY" : preview.format.toUpperCase()}</strong><span>source format</span></div><div><strong>{preview.warnings.length}</strong><span>warnings</span></div>{preview.warnings.length > 0 && <p>{preview.warnings.join(" ")}</p>}</div>}<div className="transfer-help"><ShieldCheck size={15} /><span>Passwords, enable secrets, private keys, proxy commands, macros, and host-key trust are never imported. Imported usernames become reusable profiles that require a new vault password.</span></div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button>{preview ? <button className="primary-button" disabled={!preview.sessions.length} onClick={applyImport}>Import {preview.sessions.length} sessions</button> : <button className="primary-button" disabled={!content.trim()} onClick={inspect}>Preview import</button>}</div></div> : <div className="transfer-body"><div className="export-summary"><HardDrive size={24} /><strong>{hosts.length} device sessions ready</strong><span>Login profile labels and usernames can be included. Vault passwords and enable secrets are always excluded.</span></div><button className="export-option" onClick={() => download(`netssh-sessions-${stamp}.json`, "application/json", createNetSshExport(hosts, credentialProfiles))}><span><FileDown size={18} /></span><div><strong>NetSSH backup</strong><small>Best for restoring into NetSSH; includes sites, tags, platforms, protocols, and login-profile assignments.</small></div><em>.json</em></button><button className="export-option" onClick={() => download(`netssh-sessions-${stamp}.csv`, "text/csv", createSessionCsv(hosts, credentialProfiles))}><span><FileDown size={18} /></span><div><strong>Portable session list</strong><small>Readable CSV for review, editing, and migration into other tools.</small></div><em>.csv</em></button><div className="transfer-help"><ShieldCheck size={15} /><span>For PuTTY, export <code>HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions</code> from Registry Editor. For MobaXterm, export a sessions folder or choose <code>MobaXterm.ini</code>.</span></div></div>}</section></div>;
}

function Favorites({ hosts, onConnect, onFavorite, onShowInventory }: { hosts: Host[]; onConnect: (host: Host) => void; onFavorite: (id: string) => void; onShowInventory: () => void }) {
  const favorites = hosts.filter((host) => host.favorite);
  return <div className="page"><div className="page-intro"><div><h2>Favourite devices</h2><p>Fast access to the devices you use most.</p></div><button className="secondary-button" onClick={onShowInventory}>Manage inventory</button></div>{favorites.length ? <div className="device-grid">{favorites.map((host) => <DeviceCard key={host.id} host={host} onConnect={onConnect} onFavorite={onFavorite} />)}</div> : <section className="panel standalone-empty"><Star size={28} /><strong>No favourite devices yet</strong><span>Use the star action in Inventory to pin a device here.</span><button className="primary-button" onClick={onShowInventory}>Open inventory</button></section>}</div>;
}

function History({ entries, hosts, onConnect, onClear }: { entries: ConnectionHistory[]; hosts: Host[]; onConnect: (host: Host) => void; onClear: () => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  return <div className="page"><div className="page-intro"><div><h2>Connection history</h2><p>Local metadata from your latest connection preflights.</p></div>{entries.length > 0 && <button className="secondary-button" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> Clear history</button>}</div>{entries.length ? <section className="inventory-table history-table"><div className="history-row history-head"><span>Device</span><span>Protocol</span><span>Started</span><span>Result</span><span /></div>{entries.map((entry) => { const host = hosts.find((item) => item.id === entry.deviceId); return <div className="history-row" key={entry.id}><span><strong>{entry.deviceName}</strong><small>{entry.address}</small></span><span className="protocol-pill">{entry.protocol.toUpperCase()}</span><span>{new Date(entry.startedAt).toLocaleString()}</span><span className={entry.success ? "history-success" : "history-failure"}><i />{entry.success ? `Succeeded${entry.elapsedMs !== undefined ? ` · ${entry.elapsedMs} ms` : ""}` : "Failed"}<small title={entry.detail}>{entry.detail}</small></span><span>{host && <button className="connect-button" onClick={() => onConnect(host)}>Reconnect <ChevronRight size={14} /></button>}</span></div>})}</section> : <section className="panel standalone-empty"><Clock3 size={28} /><strong>No connection history yet</strong><span>Successful and failed connection attempts will appear here.</span></section>}{confirmClear && <ConfirmModal title="Clear connection history?" message="This permanently removes locally stored connection metadata. Your devices and credentials are not affected." confirmLabel="Clear history" onCancel={() => setConfirmClear(false)} onConfirm={() => { onClear(); setConfirmClear(false); }} />}</div>;
}

function Credentials({ profiles, hosts, notify, onSave, onDelete, onAssign }: { profiles: CredentialProfile[]; hosts: Host[]; notify: (message: string) => void; onSave: (profile: CredentialProfile, password?: string, enablePassword?: string) => Promise<void>; onDelete: (profile: CredentialProfile) => Promise<void>; onAssign: (hostId: string, credentialId: string) => void }) {
  const [stored, setStored] = useState<Record<string, { login: boolean; enable: boolean }>>({});
  const [editing, setEditing] = useState<CredentialProfile | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<CredentialProfile | null>(null);
  const refresh = async () => {
    const results = await Promise.all(profiles.map(async (profile) => [profile.id, { login: await hasCredentialPassword(profile.id), enable: await hasCredentialEnablePassword(profile.id) }] as const));
    setStored(Object.fromEntries(results));
  };
  useEffect(() => { refresh(); }, [profiles]);
  const save = async (profile: CredentialProfile, password?: string, enablePassword?: string) => {
    await onSave(profile, password, enablePassword);
    setEditing(undefined);
    await refresh();
    notify(password || enablePassword ? `${profile.label} saved securely` : `${profile.label} profile saved`);
  };
  const assignableHosts = hosts.filter((host) => (host.protocol ?? "ssh") !== "serial");
  return <div className="page"><div className="page-intro"><div><h2>Credential vault</h2><p>Create a login once, label it clearly, then assign it to any number of devices.</p></div><div className="credential-page-actions"><span className={`native-badge ${isNativeApp() ? "available" : ""}`}><LockKeyhole size={14} />{isNativeApp() ? "Native vault active" : "Native app required"}</span><button className="primary-button" onClick={() => setEditing(null)}><Plus size={16} /> New login</button></div></div>{profiles.length ? <section className="inventory-table credential-table"><div className="credential-row credential-head"><span>Login profile</span><span>Username</span><span>Assigned</span><span>Secrets</span><span /></div>{profiles.map((profile) => { const assigned = hosts.filter((host) => host.credentialId === profile.id).length; const secrets = stored[profile.id]; return <div className="credential-row" key={profile.id}><span><strong>{profile.label}</strong><small>Reusable network login</small></span><span>{profile.username}</span><span>{assigned} device{assigned === 1 ? "" : "s"}</span><span className={secrets?.login ? "vault-stored" : "vault-empty"}><i />{secrets?.login ? secrets.enable ? "Login + enable stored" : "Login password stored" : "Login password required"}</span><span className="row-actions"><button className="connect-button" onClick={() => setEditing(profile)}><Pencil size={13} /> Edit</button><button className="delete-device" aria-label={`Delete ${profile.label}`} onClick={() => setPendingDelete(profile)}><Trash2 size={14} /></button></span></div>; })}</section> : <section className="panel credential-empty"><KeyRound size={27} /><strong>No saved logins yet</strong><span>Create profiles such as “Network Admin”, “Read only”, or “Lab TACACS”.</span><button className="primary-button" onClick={() => setEditing(null)}><Plus size={15} /> Create first login</button></section>}<section className="panel credential-assignments"><div className="panel-title"><div><h3>Device assignments</h3><p>Select which reusable login each device should use</p></div></div><div className="assignment-table"><div className="assignment-row assignment-head"><span>Device</span><span>Protocol</span><span>Saved login</span></div>{assignableHosts.map((host) => <div className="assignment-row" key={host.id}><span><strong>{host.name}</strong><small>{host.address}</small></span><span className="protocol-pill">{(host.protocol ?? "ssh").toUpperCase()}</span><select aria-label={`Login for ${host.name}`} value={host.credentialId ?? ""} onChange={(event) => onAssign(host.id, event.target.value)}><option value="">Ask when connecting</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.label} · {profile.username}</option>)}</select></div>)}</div></section>{editing !== undefined && <CredentialProfileModal profile={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={save} />}{pendingDelete && <ConfirmModal title={`Delete ${pendingDelete.label}?`} message="Devices using this login will return to asking for credentials when connecting. Both login and enable passwords are removed from the vault." confirmLabel="Delete login" onCancel={() => setPendingDelete(null)} onConfirm={() => { const profile = pendingDelete; setPendingDelete(null); onDelete(profile).then(() => notify(`${profile.label} deleted`)).catch((caught) => notify((caught as Error).message)); }} />}</div>;
}

function CredentialProfileModal({ profile, onClose, onSave }: { profile?: CredentialProfile; onClose: () => void; onSave: (profile: CredentialProfile, password?: string, enablePassword?: string) => Promise<void> }) {
  const [label, setLabel] = useState(profile?.label ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [enablePassword, setEnablePassword] = useState("");
  const [enableVisible, setEnableVisible] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !username.trim()) { setError("Label and username are required."); return; }
    if (!profile && isNativeApp() && !password) { setError("Enter a password for this new login profile."); return; }
    try {
      await onSave({ id: profile?.id ?? `credential-${crypto.randomUUID()}`, label: label.trim(), username: username.trim() }, password || undefined, enablePassword || undefined);
    } catch (caught) { setError((caught as Error).message); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="confirm-modal password-modal credential-profile-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><span><KeyRound size={19} /></span><h3>{profile ? `Edit ${profile.label}` : "Create saved login"}</h3><p>The username, login password, and optional privileged-enable password can be reused across assigned devices.</p><label><small>Profile label</small><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Network Admin" /></label><label><small>Username</small><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="netadmin" /></label><label><small>{profile ? "Replace login password (optional)" : "Login password"}</small><div className="secret-input"><LockKeyhole size={15} /><input type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={profile ? "Leave blank to keep existing" : "Device login password"} /><button type="button" onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label><label><small>{profile ? "Replace enable password (optional)" : "Enable password (optional)"}</small><div className="secret-input"><ShieldCheck size={15} /><input type={enableVisible ? "text" : "password"} value={enablePassword} onChange={(event) => setEnablePassword(event.target.value)} autoComplete="new-password" placeholder={profile ? "Leave blank to keep existing" : "Privileged EXEC secret"} /><button type="button" onClick={() => setEnableVisible(!enableVisible)}>{enableVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>{error && <div className="modal-error">{error}</div>}<div className="credential-secret-note"><ShieldCheck size={14} />Enable secrets are sent only when you choose <strong>Send enable password</strong> from an active session menu.</div><div className="password-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!label.trim() || !username.trim()}>Save login</button></div></form></div>;
}

type ToolboxTool = "subnet" | "ping" | "dns" | "port" | "wifi" | "audit";

function Toolbox({ hosts, credentialProfiles, notify }: { hosts: Host[]; credentialProfiles: CredentialProfile[]; notify: (message: string) => void }) {
  const [activeTool, setActiveTool] = useState<ToolboxTool>("subnet");
  const [cidr, setCidr] = useState("10.24.16.34/20");
  const [result, setResult] = useState<SubnetResult>(() => calculateSubnet(cidr));
  const [error, setError] = useState("");
  const calculate = (event?: FormEvent) => {
    event?.preventDefault();
    try { setResult(calculateSubnet(cidr)); setError(""); } catch (caught) { setError((caught as Error).message); }
  };
  const prefixValue = (() => { const value = Number(cidr.split("/").at(-1)); return Number.isInteger(value) && value >= 0 && value <= 32 ? value : 24; })();
  const changePrefix = (prefix: number) => {
    const address = cidr.split("/")[0]?.trim() || "0.0.0.0";
    const nextCidr = `${address}/${prefix}`;
    setCidr(nextCidr);
    try { setResult(calculateSubnet(nextCidr)); setError(""); } catch (caught) { setError((caught as Error).message); }
  };
  const copy = (value: string) => { navigator.clipboard?.writeText(value); notify("Copied to clipboard"); };
  const tools = [
    { id: "subnet" as const, icon: Calculator, label: "Subnet calculator" },
    { id: "ping" as const, icon: Radio, label: "Ping & trace" },
    { id: "dns" as const, icon: Globe2, label: "DNS lookup" },
    { id: "port" as const, icon: Database, label: "Port check" },
    { id: "wifi" as const, icon: Wifi, label: "Wi-Fi diagnostics" },
    { id: "audit" as const, icon: ClipboardCheck, label: "Switch audit" },
  ];
  const toolDescription = (tool: ToolboxTool) => tool === "ping" ? "Reachability and hop path" : tool === "dns" ? "System resolver lookup" : tool === "port" ? "Timed TCP handshake" : tool === "wifi" ? "RSSI, channel and radio health" : tool === "audit" ? "Unused access-port evidence" : "Address planning";
  return <div className="page"><div className="page-intro"><div><h2>Network toolbox</h2><p>Fast, reliable utilities built into your workflow.</p></div></div><div className="tool-tabs">{tools.map((tool) => <button key={tool.id} className={activeTool === tool.id ? "active" : ""} onClick={() => setActiveTool(tool.id)}><tool.icon size={16} /> {tool.label}</button>)}</div>{activeTool === "subnet" ? <div className="tool-grid"><section className="panel calculator-panel"><div className="panel-title"><div><h3>IPv4 subnet calculator</h3><p>Enter an IPv4 address, then adjust the prefix slider</p></div><span className="tool-icon"><Calculator size={20} /></span></div><form onSubmit={calculate} className="calculator-form"><label>IP address / CIDR</label><div><input value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="192.168.1.10/24" /><button className="primary-button">Calculate</button></div>{error && <span className="form-error">{error}</span>}<div className="subnet-prefix-control"><div><strong>Prefix length</strong><span>/{prefixValue} · {result.total.toLocaleString()} total addresses</span></div><input aria-label="Subnet prefix length" type="range" min="0" max="32" step="1" value={prefixValue} onChange={(event) => changePrefix(Number(event.target.value))} /><div className="subnet-prefix-scale"><span>/0</span><span>/8</span><span>/16</span><span>/24</span><span>/32</span></div></div></form><div className="result-grid"><Result label="Network" value={result.network} copy={copy} /><Result label="Broadcast" value={result.broadcast} copy={copy} /><Result label="Subnet mask" value={result.mask} copy={copy} /><Result label="Wildcard mask" value={result.wildcard} copy={copy} /><Result label="First usable" value={result.firstHost} copy={copy} /><Result label="Last usable" value={result.lastHost} copy={copy} /></div><div className="capacity-row"><div><span>Address space</span><strong>{result.cidr}</strong></div><div><span>Usable hosts</span><strong>{result.usable.toLocaleString()}</strong></div><div><span>Total addresses</span><strong>{result.total.toLocaleString()}</strong></div><div><span>Scope</span><strong>{result.isPrivate ? "Private" : "Public"}</strong></div></div></section><aside className="tool-aside"><section className="panel"><div className="panel-title"><div><h3>Binary view</h3><p>32-bit representation</p></div></div><div className="binary-value">{result.binary.split(".").map((part, index) => <span key={index}>{part}{index < 3 && <i>.</i>}</span>)}</div></section><section className="panel quick-tools"><div className="panel-title"><div><h3>Quick tools</h3><p>Common network checks</p></div></div>{tools.slice(1).map((tool) => <button key={tool.id} onClick={() => setActiveTool(tool.id)}><span><tool.icon size={17} /></span><div><strong>{tool.label}</strong><small>{toolDescription(tool.id)}</small></div><ChevronRight size={15} /></button>)}</section></aside></div> : activeTool === "wifi" ? <WifiPanel notify={notify} /> : activeTool === "audit" ? <LiveSwitchAuditPanel hosts={hosts} credentialProfiles={credentialProfiles} notify={notify} /> : <DiagnosticPanel tool={activeTool} notify={notify} />}</div>;
}

function LiveSwitchAuditPanel({ hosts, credentialProfiles, notify }: { hosts: Host[]; credentialProfiles: CredentialProfile[]; notify: (message: string) => void }) {
  const eligibleHosts = hosts.filter((host) => (host.protocol ?? "ssh") === "ssh" && !host.demoProfile);
  const [deviceId, setDeviceId] = useState(eligibleHosts[0]?.id ?? "");
  const [minimumWeeks, setMinimumWeeks] = useState(10);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<LiveSwitchAudit | null>(null);
  const [vaultPasswordAvailable, setVaultPasswordAvailable] = useState<boolean | null>(null);
  const [auditPassword, setAuditPassword] = useState("");
  const [saveAuditPassword, setSaveAuditPassword] = useState(true);
  const selectedHost = eligibleHosts.find((host) => host.id === deviceId);
  const selectedCredential = credentialProfiles.find((credential) => credential.id === selectedHost?.credentialId);
  const candidates = audit?.ports.filter((port) => port.candidate) ?? [];
  const protectedPorts = audit?.ports.filter((port) => port.protected && /down/i.test(`${port.interfaceStatus} ${port.lineProtocol}`)) ?? [];
  useEffect(() => {
    let cancelled = false;
    setAuditPassword("");
    setVaultPasswordAvailable(null);
    if (!selectedHost || !selectedCredential || !isNativeApp()) return;
    Promise.all([hasCredentialPassword(selectedCredential.id), hasDevicePassword(selectedHost.id)])
      .then(([profilePassword, legacyDevicePassword]) => { if (!cancelled) setVaultPasswordAvailable(profilePassword || legacyDevicePassword); })
      .catch(() => { if (!cancelled) setVaultPasswordAvailable(false); });
    return () => { cancelled = true; };
  }, [selectedHost?.id, selectedCredential?.id]);
  const run = async () => {
    if (!selectedHost) { setError("Choose an SSH switch from inventory"); return; }
    if (!selectedCredential) { setError("Assign a saved credential profile to this switch before running an unattended audit"); return; }
    if (vaultPasswordAvailable === false && !auditPassword) { setError("Enter the login password for this audit, or save it in the Credential vault"); return; }
    setRunning(true); setError(""); setAudit(null);
    try {
      if (auditPassword && saveAuditPassword) await saveCredentialPassword(selectedCredential.id, auditPassword);
      const result = await runLiveSwitchAudit(selectedHost, selectedCredential, minimumWeeks, auditPassword || undefined);
      setAudit(result);
      if (auditPassword && saveAuditPassword) setVaultPasswordAvailable(true);
      setAuditPassword("");
      notify(`Found ${result.ports.filter((port) => port.candidate).length} unused-port candidates on ${selectedHost.name}`);
    } catch (caught) { setError(String(caught)); }
    finally { setRunning(false); }
  };
  const exportCsv = () => {
    if (!audit) return;
    const blobUrl = URL.createObjectURL(new Blob([createSwitchAuditCsv(audit)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl; anchor.download = `${audit.deviceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-port-audit-${new Date(audit.checkedAt).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    notify("Switch audit exported for Excel");
  };
  const copyShutdown = () => {
    const commands = candidates.map((port) => `interface ${port.port}\n description UNUSED-REVIEW-${new Date().toISOString().slice(0, 10)}\n shutdown\n exit`).join("\n");
    void writeClipboardText(commands); notify("Shutdown review template copied; validate every port before applying");
  };
  return <div className="audit-layout live-audit-layout"><section className="panel audit-main"><div className="panel-title"><div><h3>Live unused-port audit</h3><p>Run a read-only interface check directly against a selected Cisco switch</p></div><span className="tool-icon"><ClipboardCheck size={20} /></span></div><div className="audit-controls"><label><span>Switch</span><select value={deviceId} onChange={(event) => { setDeviceId(event.target.value); setAudit(null); setError(""); }}><option value="">Select a switch</option>{eligibleHosts.map((host) => <option value={host.id} key={host.id}>{host.name} · {host.site}</option>)}</select></label><label><span>Unused for at least</span><div><input type="number" min={1} max={104} value={minimumWeeks} onChange={(event) => setMinimumWeeks(Math.max(1, Number(event.target.value) || 1))} /><em>weeks</em></div></label></div><div className="live-audit-run"><span>{selectedCredential ? vaultPasswordAvailable === null ? <><Activity className="spin" size={14} /> Checking {selectedCredential.label}…</> : vaultPasswordAvailable ? <><ShieldCheck size={14} /> {selectedCredential.label} password ready</> : <><KeyRound size={14} /> {selectedCredential.label} needs a password</> : <><KeyRound size={14} /> Saved credential required</>}</span><button className="primary-button" onClick={() => void run()} disabled={running || !selectedHost || vaultPasswordAvailable === null}>{running ? <><Activity className="spin" size={14} /> Checking interfaces…</> : <><Zap size={14} /> Run live audit</>}</button></div>{selectedCredential && vaultPasswordAvailable === false && <div className="live-audit-password"><label><span>Login password for {selectedCredential.label}</span><div className="secret-input"><LockKeyhole size={14} /><input type="password" value={auditPassword} onChange={(event) => setAuditPassword(event.target.value)} autoComplete="current-password" placeholder="Enter password to continue" /></div></label><label><input type="checkbox" checked={saveAuditPassword} onChange={(event) => setSaveAuditPassword(event.target.checked)} /><span>Save to the operating-system vault</span></label></div>}{error && <div className="diagnostic-error">{error}</div>}{audit ? <><div className="audit-summary"><article><span>Physical ports checked</span><strong>{audit.ports.length}</strong></article><article><span>Shutdown candidates</span><strong>{candidates.length}</strong></article><article><span>Protected findings</span><strong>{protectedPorts.length}</strong></article><article><span>Collection time</span><strong>{audit.elapsedMs} ms</strong></article></div><div className="audit-results"><div className="audit-result-head"><span>Checked {new Date(audit.checkedAt).toLocaleString()}</span><div><button className="secondary-button" onClick={exportCsv}><FileDown size={13} /> Export CSV</button><button className="primary-button" disabled={!candidates.length} onClick={copyShutdown}>Copy shutdown template</button></div></div><div className="audit-table"><div className="audit-row audit-head"><span>Port</span><span>Description</span><span>Status</span><span>Last input</span><span>Recommendation</span></div>{audit.ports.map((port) => <div className="audit-row" key={port.port}><code>{port.port}</code><span>{port.description || "No description"}</span><span className="audit-status">{port.interfaceStatus} / {port.lineProtocol}</span><span>{port.lastInput}{port.inactiveWeeks != null ? ` · ~${port.inactiveWeeks} weeks` : ""}</span><span className={port.candidate ? "audit-candidate" : port.protected ? "audit-protected" : ""}>{port.candidate ? "Review for shutdown" : port.reason}</span></div>)}</div></div></> : <div className="audit-empty"><ClipboardCheck size={25} /><strong>Select a switch and run the audit</strong><span>NetSSH runs <code>show interfaces</code>, evaluates each physical port’s last-input age and current state, then prepares an exportable review list.</span></div>}<div className="audit-warning"><ShieldCheck size={16} /><span>“Last input” resets after reloads and may not reflect every traffic type. NetSSH never disables ports automatically. Confirm MAC history, PoE, patching, phones, access points, monitoring and infrastructure links before shutdown.</span></div></section><aside className="panel audit-import live-audit-help"><div className="panel-title"><div><h3>How it works</h3><p>No snapshots or scheduled storage</p></div></div><div className="audit-method"><strong>1 · Connect read-only</strong><span>The assigned credential profile opens a separate SSH command channel.</span><strong>2 · Inspect interfaces</strong><span>Cisco interface state, line protocol, description and last-input age are parsed locally.</span><strong>3 · Review and export</strong><span>Download CSV for Excel, add owner/change details, and validate candidates before making configuration changes.</span></div><div className="audit-method"><strong>Supported in this release</strong><span>Cisco IOS and IOS-XE style <code>show interfaces</code> output. NX-OS and other vendors will be added with vendor-specific collectors.</span></div></aside></div>;
}

function WifiPanel({ notify }: { notify: (message: string) => void }) {
  const [result, setResult] = useState<WifiDiagnostic | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setRunning(true); setError("");
    try { setResult(await runWifiDiagnostic()); }
    catch (caught) { setResult(null); setError(String(caught)); }
    finally { setRunning(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const health = signalHealth(result?.rssiDbm, result?.signalPercent);
  const signalValue = result?.rssiDbm != null ? `${result.rssiDbm} dBm` : result?.signalPercent != null ? `${result.signalPercent}%` : "Unavailable";
  const windowsPermissionError = error?.includes("Windows denied access") ?? false;
  return <div className="wifi-layout"><section className="panel wifi-panel"><div className="panel-title"><div><h3>Wireless connection health</h3><p>Read-only diagnostics from the local Wi-Fi adapter</p></div><button className="wifi-refresh" onClick={() => void refresh()} disabled={running}><RefreshCw size={15} className={running ? "spin" : ""} />{running ? "Scanning…" : "Refresh"}</button></div>{error && <div className="diagnostic-error wifi-permission-error"><span>{error}</span>{windowsPermissionError && <button onClick={() => openWifiPrivacySettings().catch((caught) => notify(String(caught)))}><Settings size={14} /> Open Windows Location settings</button>}</div>}{!result && !error ? <div className="wifi-loading"><Wifi size={28} /><strong>Inspecting wireless adapter…</strong></div> : result && <><div className="wifi-summary"><div className={`wifi-signal ${health.tone}`}><div><Wifi size={24} /><span>{result.connected ? "Connected" : "Not connected"}</span></div><strong>{signalValue}</strong><small>{result.connected ? health.label : "No active Wi-Fi link"}</small><div className="signal-track"><i style={{ width: `${result.connected ? health.score : 0}%` }} /></div></div><div className="wifi-identity"><span>Network</span><strong>{result.ssid ?? "SSID unavailable"}</strong><small>{result.bssid ?? result.interfaceName ?? result.platform}</small></div></div><div className="wifi-metrics"><WifiMetric label="Signal" value={signalValue} hint="RSSI closer to 0 is stronger" /><WifiMetric label="Noise floor" value={result.noiseDbm != null ? `${result.noiseDbm} dBm` : "Unavailable"} hint={result.snrDb != null ? `SNR ${result.snrDb} dB` : "Not exposed by this adapter"} /><WifiMetric label="Channel" value={result.channel ?? "Unknown"} hint={result.band ?? "Band unavailable"} /><WifiMetric label="Radio" value={result.radioType ?? "Unknown"} hint={[result.txRateMbps && `Tx ${result.txRateMbps} Mbps`, result.rxRateMbps && `Rx ${result.rxRateMbps} Mbps`].filter(Boolean).join(" · ") || "Rates unavailable"} /><WifiMetric label="Security" value={result.security ?? "Unknown"} hint="Verify enterprise or personal policy" /><WifiMetric label="Interface" value={result.interfaceName ?? "Unknown"} hint={`${result.platform} · ${result.elapsedMs} ms`} /></div>{result.nearbyNetworks.length > 0 && <div className="nearby-networks"><div className="wifi-section-title"><strong>Nearby access points</strong><span>{result.nearbyNetworks.length} detected</span></div><div className="nearby-head"><span>SSID / BSSID</span><span>Signal</span><span>Channel</span><span>Radio</span></div>{result.nearbyNetworks.slice(0, 12).map((network, index) => <div className="nearby-row" key={`${network.bssid ?? network.ssid}-${index}`}><span><strong>{network.ssid || "Hidden network"}</strong><small>{network.bssid ?? network.security ?? ""}</small></span><span>{network.estimatedRssiDbm != null ? `${network.estimatedRssiDbm} dBm` : network.signalPercent != null ? `${network.signalPercent}%` : "—"}</span><span>{network.channel ?? "—"}</span><span>{network.radioType ?? "—"}</span></div>)}</div>}<div className="wifi-raw"><div className="wifi-section-title"><strong>Native diagnostic output</strong><button onClick={() => { navigator.clipboard?.writeText(result.rawOutput); notify("Wi-Fi output copied"); }}><Copy size={13} /> Copy</button></div><pre>{result.rawOutput}</pre></div></>}</section><aside className="panel wifi-guidance"><div className="panel-title"><div><h3>Engineer guidance</h3><p>How to interpret the link</p></div><span className="tool-icon"><ShieldCheck size={19} /></span></div><div className="wifi-thresholds"><span><i className="excellent" />-50 dBm<strong>Excellent</strong></span><span><i className="good" />-60 to -67<strong>Good</strong></span><span><i className="fair" />-68 to -70<strong>Fair</strong></span><span><i className="weak" />-71 to -80<strong>Weak</strong></span><span><i className="poor" />Below -80<strong>Poor</strong></span></div><div className="wifi-advice"><strong>Findings</strong>{result?.recommendations.map((recommendation) => <p key={recommendation}>{recommendation}</p>) ?? <p>Run the diagnostic to see recommendations.</p>}</div><div className="wifi-privacy"><LockKeyhole size={15} /><p>SSID and BSSID stay on this device. Windows 11 and macOS may require Location access before exposing wireless details.</p></div></aside></div>;
}

function WifiMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function DiagnosticPanel({ tool, notify }: { tool: "ping" | "dns" | "port"; notify: (message: string) => void }) {
  const [mode, setMode] = useState<"ping" | "trace">("ping");
  const [target, setTarget] = useState(tool === "dns" ? "example.com" : "1.1.1.1");
  const [port, setPort] = useState("22");
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setResult(null); setError(""); setTarget(tool === "dns" ? "example.com" : "1.1.1.1"); }, [tool]);
  const kind: DiagnosticKind = tool === "ping" ? mode : tool;
  const labels = tool === "ping" ? { title: "Reachability and path", description: "Send ICMP probes or trace the route to a host", button: mode === "ping" ? "Run ping" : "Run trace" } : tool === "dns" ? { title: "DNS lookup", description: "Resolve A and AAAA records using the system resolver", button: "Resolve host" } : { title: "TCP port check", description: "Attempt a timed TCP handshake to a service", button: "Check port" };
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!target.trim()) { setError("Enter a hostname or IP address"); return; }
    const numericPort = Number(port);
    if (tool === "port" && (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)) { setError("Port must be between 1 and 65535"); return; }
    setRunning(true); setError(""); setResult(null);
    try { setResult(await runDiagnostic(kind, target.trim(), tool === "port" ? numericPort : undefined)); }
    catch (caught) { setError(String(caught)); }
    finally { setRunning(false); }
  };
  return <div className="diagnostic-layout"><section className="panel diagnostic-panel"><div className="panel-title"><div><h3>{labels.title}</h3><p>{labels.description}</p></div><span className="tool-icon">{tool === "ping" ? <Radio size={20} /> : tool === "dns" ? <Globe2 size={20} /> : <Database size={20} />}</span></div>{tool === "ping" && <div className="mode-switch"><button className={mode === "ping" ? "active" : ""} onClick={() => setMode("ping")}>Ping</button><button className={mode === "trace" ? "active" : ""} onClick={() => setMode("trace")}>Traceroute</button></div>}<form className="diagnostic-form" onSubmit={run}><label><span>Hostname or IP address</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="router.example.net" /></label>{tool === "port" && <label className="port-field"><span>Port</span><input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" /></label>}<button className="primary-button" disabled={running}>{running ? <><Activity size={15} className="spin" /> Running…</> : <><Zap size={15} /> {labels.button}</>}</button></form>{error && <div className="diagnostic-error">{error}</div>}<div className={`diagnostic-output ${result ? "has-result" : ""}`}>{result ? <><div className="output-head"><span className={result.success ? "success" : "failure"}><i />{result.success ? "Completed" : "Check failed"}</span><span>{result.elapsedMs} ms</span><button onClick={() => { navigator.clipboard?.writeText(result.output); notify("Diagnostic output copied"); }}><Copy size={14} /> Copy</button></div><pre>{result.output}</pre></> : <div className="output-empty"><TerminalSquare size={25} /><strong>Ready to run</strong><span>Results will appear here without changing the target device.</span></div>}</div></section><aside className="panel diagnostic-help"><div className="panel-title"><div><h3>Safe diagnostics</h3><p>What this tool does</p></div></div><div className="help-body"><ShieldCheck size={19} /><p>{kind === "ping" ? "Sends four ICMP echo requests. Some networks block ICMP, so a failed ping does not always mean the host is down." : kind === "trace" ? "Discovers the routed path with a maximum of 16 hops. Firewalls may hide intermediate devices." : kind === "dns" ? "Uses your operating system resolver and respects configured DNS servers, VPNs, and split DNS." : "Opens and immediately closes one TCP connection. It does not authenticate or send application data."}</p></div></aside></div>;
}

function Result({ label, value, copy }: { label: string; value: string; copy: (value: string) => void }) { return <div className="result-item"><span>{label}</span><div><code>{value}</code><button onClick={() => copy(value)}><Copy size={14} /></button></div></div>; }

function AddDeviceModal({ existingHosts, credentialProfiles, initialHost, defaultProtocol, configuredSites, configuredPlatforms, onClose, onSave }: { existingHosts: Host[]; credentialProfiles: CredentialProfile[]; initialHost?: Host; defaultProtocol: ConnectionProtocol; configuredSites: string[]; configuredPlatforms: string[]; onClose: () => void; onSave: (host: Host) => void }) {
  const [name, setName] = useState(initialHost?.name ?? "");
  const [protocol, setProtocol] = useState<ConnectionProtocol>(initialHost?.protocol ?? defaultProtocol);
  const [address, setAddress] = useState(initialHost?.address ?? "");
  const [port, setPort] = useState(String(initialHost?.port ?? ((initialHost?.protocol ?? defaultProtocol) === "telnet" ? 23 : 22)));
  const [baudRate, setBaudRate] = useState(String(initialHost?.baudRate ?? 9600));
  const [credentialId, setCredentialId] = useState(initialHost?.credentialId ?? "");
  const [platform, setPlatform] = useState(initialHost?.platform ?? configuredPlatforms[0] ?? "Other");
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(initialHost ? deviceRoleValue(initialHost) : "other");
  const [site, setSite] = useState(initialHost?.site ?? "");
  const [tags, setTags] = useState((initialHost?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(initialHost?.notes ?? "");
  const [error, setError] = useState("");
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [serialError, setSerialError] = useState("");
  const [manualSerial, setManualSerial] = useState(Boolean(initialHost?.protocol === "serial" && initialHost.address));
  const platformOptions = [...new Set([...configuredPlatforms, initialHost?.platform, platform].filter((value): value is string => Boolean(value)))];
  const siteOptions = [...new Set([...configuredSites, ...existingHosts.map((host) => host.site), initialHost?.site].filter((value): value is string => Boolean(value)))].sort();
  const refreshSerialPorts = async () => {
    setSerialLoading(true);
    setSerialError("");
    try {
      const ports = await listSerialPorts();
      setSerialPorts(ports);
      const savedPortDetected = ports.some((serialPort) => serialPort.name === address);
      if (savedPortDetected) setManualSerial(false);
      else if (!address && ports[0]) { setAddress(ports[0].name); setManualSerial(false); }
      else if (address) setManualSerial(true);
    }
    catch (caught) { setSerialError(String(caught).replace(/^Error:\s*/, "")); }
    finally { setSerialLoading(false); }
  };
  useEffect(() => { if (protocol === "serial") void refreshSerialPorts(); }, [protocol]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    const numericPort = protocol === "serial" ? undefined : Number(port);
    if (!cleanName || !cleanAddress || !site.trim()) { setError("Name, address, and site are required."); return; }
    if (protocol !== "serial" && !/^[a-zA-Z0-9.:-]+$/.test(cleanAddress)) { setError("Enter a valid hostname or IP address."); return; }
    if (protocol !== "serial" && (!Number.isInteger(numericPort) || Number(numericPort) < 1 || Number(numericPort) > 65535)) { setError("Port must be between 1 and 65535."); return; }
    if (existingHosts.some((host) => host.id !== initialHost?.id && host.address.toLowerCase() === cleanAddress.toLowerCase() && (host.protocol ?? "ssh") === protocol && (protocol === "serial" || (host.port ?? (protocol === "telnet" ? 23 : 22)) === numericPort))) { setError("A matching connection profile already exists."); return; }
    onSave({
      id: initialHost?.id ?? `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`,
      name: cleanName,
      address: cleanAddress,
      protocol,
      port: numericPort,
      baudRate: protocol === "serial" ? Number(baudRate) : undefined,
      username: undefined,
      credentialId: protocol === "serial" ? undefined : credentialId || undefined,
      platform,
      deviceRole,
      site: site.trim(),
      status: initialHost?.status ?? "online",
      latency: initialHost?.latency ?? null,
      favorite: initialHost?.favorite,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
    });
  };
  const changeProtocol = (next: ConnectionProtocol) => { setProtocol(next); if (next === "ssh" && port === "23") setPort("22"); if (next === "telnet" && port === "22") setPort("23"); };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="device-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><Router size={18} /></span><div><h3>{initialHost ? `Edit ${initialHost.name}` : "Add a network device"}</h3><p>Create a reusable SSH, Telnet, or Serial connection profile.</p></div></div><button onClick={onClose}><X size={17} /></button></div><form className="device-form" onSubmit={submit}><div className="protocol-selector">{(["ssh", "telnet", "serial"] as ConnectionProtocol[]).map((value) => <button type="button" className={protocol === value ? "active" : ""} onClick={() => changeProtocol(value)} key={value}><Radio size={14} />{value.toUpperCase()}</button>)}</div><div className="form-grid"><label><span>Device name *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="CORE-SW-03" /></label><label><span>Device role</span><select value={deviceRole} onChange={(event) => setDeviceRole(event.target.value as DeviceRole)}>{deviceRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Platform</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platformOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Site *</span><select value={site} onChange={(event) => setSite(event.target.value)}><option value="" disabled>Select a site</option>{siteOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{protocol === "serial" ? <div className="wide-field serial-port-field"><span>Serial port *</span><div className="serial-port-picker">{manualSerial ? <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="COM3 or /dev/cu.usbserial-110" autoFocus /> : <select value={address} onChange={(event) => { if (event.target.value === "__manual__") { setAddress(""); setManualSerial(true); } else setAddress(event.target.value); }} disabled={serialLoading}><option value="">{serialLoading ? "Detecting serial ports…" : serialPorts.length ? "Select a serial port" : "No serial ports detected"}</option>{serialPorts.map((serialPort) => <option value={serialPort.name} key={serialPort.name}>{serialPort.displayName}</option>)}<option value="__manual__">Enter port manually…</option></select>}<button type="button" className="serial-refresh" onClick={() => { setManualSerial(false); void refreshSerialPorts(); }} disabled={serialLoading} title="Refresh detected serial ports"><RefreshCw size={15} className={serialLoading ? "spin" : ""} /></button></div>{serialError && <small className="serial-port-error">{serialError}</small>}{!serialError && !serialLoading && <small>{serialPorts.length ? `${serialPorts.length} serial ${serialPorts.length === 1 ? "port" : "ports"} detected by the operating system.` : "Connect a USB console adapter, then refresh or enter its port manually."}</small>}</div> : <label className="wide-field"><span>Hostname or IP address *</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="10.24.1.5 or switch.example.net" /></label>}{protocol === "serial" ? <label><span>Baud rate</span><select value={baudRate} onChange={(event) => setBaudRate(event.target.value)}>{[9600, 19200, 38400, 57600, 115200].map((rate) => <option value={rate} key={rate}>{rate}</option>)}</select></label> : <><label><span>{protocol.toUpperCase()} port</span><input inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} /></label><label><span>Saved login</span><select value={credentialId} onChange={(event) => setCredentialId(event.target.value)}><option value="">Prompt in terminal</option>{credentialProfiles.map((credential) => <option value={credential.id} key={credential.id}>{credential.label} · {credential.username}</option>)}</select></label></>}<label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="core, production" /></label><label className="wide-field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Circuit ID, rack, support details…" rows={3} /></label></div>{error && <div className="modal-error">{error}</div>}<div className="form-security"><ShieldCheck size={15} /><span>Assigned vault logins connect automatically. Without one, NetSSH prompts for SSH details inside the terminal workspace.</span></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{initialHost ? <Pencil size={15} /> : <Plus size={15} />} {initialHost ? "Save changes" : "Add device"}</button></div></form></section></div>;
}

function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={onCancel}><section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()}><span><Trash2 size={19} /></span><h3>{title}</h3><p>{message}</p><div><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="confirm-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function Snippets({ notify, onRun }: { notify: (message: string) => void; onRun: (snippet: CommandSnippet) => void }) {
  const [items, setItems] = useState<CommandSnippet[]>(() => {
    try {
      const saved = localStorage.getItem("netssh.snippets");
      if (!saved) return snippets;
      const stored = JSON.parse(saved) as CommandSnippet[];
      if (localStorage.getItem("netssh.snippets.version") === "2") return stored;
      const commands = new Set(stored.map((snippet) => snippet.command.trim().toLowerCase()));
      return [...stored, ...snippets.filter((snippet) => !commands.has(snippet.command.toLowerCase()))];
    }
    catch { return snippets; }
  });
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [editing, setEditing] = useState<CommandSnippet | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<CommandSnippet | null>(null);
  useEffect(() => { localStorage.setItem("netssh.snippets", JSON.stringify(items)); localStorage.setItem("netssh.snippets.version", "2"); }, [items]);
  const vendors = [...new Set(items.map((snippet) => snippet.vendor))].sort();
  const filtered = items.filter((snippet) => {
    const matchesQuery = `${snippet.name} ${snippet.command} ${snippet.vendor} ${snippet.category} ${snippet.description ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (vendor === "all" || snippet.vendor === vendor);
  });
  const save = (snippet: CommandSnippet) => {
    setItems((current) => current.some((item) => item.id === snippet.id) ? current.map((item) => item.id === snippet.id ? snippet : item) : [snippet, ...current]);
    setEditing(undefined); notify(`${snippet.name} saved`);
  };
  return <div className="page"><div className="page-intro"><div><h2>Command snippets</h2><p>Reusable, vendor-aware commands stored locally on this device.</p></div><button className="primary-button" onClick={() => setEditing(null)}><Plus size={17} /> New snippet</button></div><div className="snippet-toolbar"><div className="input-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands, vendors, or categories…" /></div><div className="select-wrap"><select value={vendor} onChange={(event) => setVendor(event.target.value)}><option value="all">All vendors</option>{vendors.map((value) => <option value={value} key={value}>{value}</option>)}</select><ChevronDown size={14} /></div></div><div className="snippet-summary"><span>{filtered.length} of {items.length} snippets</span><button onClick={() => { setItems(snippets); notify("Full Cisco command library restored"); }}>Restore Cisco library</button></div>{filtered.length ? <div className="snippet-grid">{filtered.map((snippet) => { const template = /<[^>]+>/.test(snippet.command); return <section className="panel snippet-card" key={snippet.id}><div><span className="snippet-icon"><Code2 size={18} /></span><div className="snippet-tags"><span className="vendor-tag">{snippet.vendor}</span><span className="category-tag">{snippet.category}</span>{template && <span className="template-tag">Template</span>}</div></div><h3>{snippet.name}</h3><p>{snippet.description ?? "Reusable command snippet"}</p><code>{snippet.command}</code><div><button aria-label={`Edit ${snippet.name}`} onClick={() => setEditing(snippet)}><Pencil size={14} /> Edit</button><button aria-label={`Delete ${snippet.name}`} onClick={() => setPendingDelete(snippet)}><Trash2 size={14} /></button><span /><button onClick={() => { navigator.clipboard?.writeText(snippet.command); notify("Snippet copied"); }}><Copy size={14} /> Copy</button><button className="run-snippet" disabled={template} title={template ? "Replace the angle-bracket placeholders before running this command" : `Run ${snippet.name}`} onClick={() => onRun(snippet)}><Zap size={14} /> {template ? "Template" : "Run"}</button></div></section>; })}</div> : <div className="panel snippet-empty"><Search size={22} /><strong>No snippets found</strong><span>Try another search or create a new snippet.</span></div>}{editing !== undefined && <SnippetModal snippet={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={save} />}{pendingDelete && <ConfirmModal title="Delete snippet?" message={`Remove “${pendingDelete.name}” from your local snippet library?`} confirmLabel="Delete snippet" onCancel={() => setPendingDelete(null)} onConfirm={() => { setItems((current) => current.filter((item) => item.id !== pendingDelete.id)); setPendingDelete(null); notify("Snippet deleted"); }} />}</div>;
}

function SnippetModal({ snippet, onClose, onSave }: { snippet?: CommandSnippet; onClose: () => void; onSave: (snippet: CommandSnippet) => void }) {
  const [name, setName] = useState(snippet?.name ?? "");
  const [vendor, setVendor] = useState(snippet?.vendor ?? "Cisco IOS/IOS-XE");
  const [category, setCategory] = useState(snippet?.category ?? "Troubleshooting");
  const [description, setDescription] = useState(snippet?.description ?? "");
  const [command, setCommand] = useState(snippet?.command ?? "");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !command.trim() || !vendor.trim() || !category.trim()) { setError("Name, vendor, category, and command are required"); return; }
    onSave({ id: snippet?.id ?? crypto.randomUUID(), name: name.trim(), vendor: vendor.trim(), category: category.trim(), description: description.trim() || undefined, command: command.trim() });
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="snippet-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><Code2 size={18} /></span><div><h3>{snippet ? "Edit command snippet" : "New command snippet"}</h3><p>Saved locally and available from the toolbox.</p></div></div><button onClick={onClose}><X size={17} /></button></div><form onSubmit={submit} className="snippet-form"><div className="form-grid"><label><span>Name *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Check interface health" /></label><label><span>Vendor *</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Cisco IOS-XE" /></label><label><span>Category *</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Interfaces" /></label><label><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this command checks" /></label><label className="wide-field"><span>Command *</span><textarea className="snippet-command-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="show ip interface brief" rows={5} spellCheck={false} /></label></div>{error && <div className="modal-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button"><Check size={15} /> Save snippet</button></div></form></section></div>;
}

const assistantWelcome: AiMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hi, I’m your network engineering copilot. I can help interpret command output, build troubleshooting plans, explain protocols, and review configuration changes. I’ll suggest read-only checks first and flag commands that could affect service.",
  createdAt: Date.now(),
};

function AiAssistant({ notify }: { notify: (message: string) => void }) {
  const [provider, setProvider] = useState<AiProvider>("demo");
  const [messages, setMessages] = useState<AiMessage[]>([assistantWelcome]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webProvider, setWebProvider] = useState<"openai" | "gemini" | null>(null);
  const [connected, setConnected] = useState<Record<"openai" | "gemini", boolean>>({ openai: false, gemini: false });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([providerIsConnected("openai"), providerIsConnected("gemini")]).then(([openai, gemini]) => setConnected({ openai, gemini }));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const submit = async (event?: FormEvent, suggestion?: string) => {
    event?.preventDefault();
    const content = (suggestion ?? draft).trim();
    if (!content || sending) return;
    if (provider !== "demo" && !connected[provider]) {
      setSettingsOpen(true);
      return;
    }
    const userMessage: AiMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    try {
      const content = await sendAiMessage(provider, nextMessages);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content, createdAt: Date.now() }]);
    } catch (caught) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `I couldn't contact ${aiProviders[provider].name}: ${(caught as Error).message}`, createdAt: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  const switchProvider = (next: AiProvider) => {
    setWebProvider(null);
    setProvider(next);
    if (next !== "demo" && !connected[next]) setSettingsOpen(true);
  };

  const selectProvider = (value: string) => {
    if (value === "openai-web" || value === "gemini-web") {
      openWebProvider(value === "openai-web" ? "openai" : "gemini");
      return;
    }
    switchProvider(value as AiProvider);
  };

  const openWebProvider = (next: "openai" | "gemini") => {
    if (!isNativeApp()) {
      notify("Embedded provider web chat is available in the NetSSH desktop app.");
      return;
    }
    setSettingsOpen(false);
    setWebProvider(next);
  };

  return <div className="assistant-page">
    <section className="assistant-main">
      <div className="assistant-header">
        <div className="assistant-title"><span><BrainCircuit size={20} /></span><div><h2>Network copilot</h2><p>Advice grounded in safe operational practice</p></div></div>
        <div className="assistant-provider-controls"><div className="provider-select">
          <span className="provider-dot" style={{ background: aiProviders[webProvider ?? provider].accent }} />
          <select value={webProvider ? `${webProvider}-web` : provider} onChange={(event) => selectProvider(event.target.value)} aria-label="AI provider">
            <option value="demo">NetSSH Demo · Offline</option>
            <option value="openai">OpenAI API · Integrated context</option>
            <option value="gemini">Gemini API · Integrated context</option>
            <option value="openai-web">ChatGPT Web</option>
            <option value="gemini-web">Gemini Web</option>
          </select>
          <ChevronDown size={14} />
        </div>{webProvider && <button type="button" className="web-provider-close" onClick={() => setWebProvider(null)} aria-label="Close embedded web chat" title="Close web chat"><X size={15} /><span>Close</span></button>}</div>
      </div>
      {webProvider ? <EmbeddedProviderView provider={webProvider} notify={notify} onExternal={() => setWebProvider(null)} /> : <><div className="assistant-notice"><ShieldCheck size={14} /><span>AI suggestions can be wrong. Review commands and configuration changes before applying them.</span></div>
      <div className="chat-scroll">
        <div className="message-list">
          {messages.map((message) => <ChatMessage key={message.id} message={message} provider={provider} />)}
          {sending && <div className="chat-message assistant-message"><span className="message-avatar"><Bot size={15} /></span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          <div ref={scrollRef} />
        </div>
      </div>
      {messages.length === 1 && <div className="prompt-suggestions">
        {["Help me troubleshoot a BGP neighbour", "Review an interface with packet loss", "Plan a safe switch configuration change"].map((suggestion) => <button key={suggestion} onClick={() => submit(undefined, suggestion)}><Sparkles size={14} />{suggestion}<ChevronRight size={14} /></button>)}
      </div>}
      <form className="chat-composer" onSubmit={submit}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask about a fault, protocol, command output, or change plan…" rows={2} />
        <div><span><LockKeyhole size={12} /> Secrets stay in your OS credential vault</span><button type="submit" disabled={!draft.trim() || sending}><Send size={16} /></button></div>
      </form></>}
    </section>
    <aside className="assistant-context">
      <section><div className="context-heading"><span><Layers3 size={16} /></span><div><strong>Session context</strong><small>Optional context sent with chat</small></div></div><button className="context-empty"><TerminalSquare size={18} /><span><strong>No session attached</strong><small>Attach terminal output for analysis</small></span><Plus size={14} /></button></section>
      <section><div className="context-heading"><span><ShieldCheck size={16} /></span><div><strong>Privacy controls</strong><small>Review before sending</small></div></div><label className="privacy-row"><span>Redact IP addresses</span><input type="checkbox" /></label><label className="privacy-row"><span>Remove possible secrets</span><input type="checkbox" defaultChecked /></label></section>
      <section className="provider-card"><div className="context-heading"><span><Bot size={16} /></span><div><strong>{aiProviders[provider].name}</strong><small>{aiProviders[provider].model}</small></div></div><button onClick={() => { setWebProvider(null); setSettingsOpen(true); }}><Settings size={14} /> API provider settings</button><div className="web-chat-divider"><span>or use your existing login</span></div><button onClick={() => openWebProvider("openai")}><Globe2 size={14} /> Open ChatGPT Web</button><button onClick={() => openWebProvider("gemini")}><Globe2 size={14} /> Open Gemini Web</button></section>
    </aside>
    {settingsOpen && <ProviderSettings connected={connected} setConnected={setConnected} onOpenWeb={openWebProvider} onClose={() => setSettingsOpen(false)} notify={notify} />}
  </div>;
}

function EmbeddedProviderView({ provider, notify, compact = false, onExternal }: { provider: "openai" | "gemini"; notify: (message: string) => void; compact?: boolean; onExternal?: () => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const notifyRef = useRef(notify);
  const onExternalRef = useRef(onExternal);
  notifyRef.current = notify;
  onExternalRef.current = onExternal;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let opened = false;
    let opening = false;
    let stopped = false;
    const bounds = () => {
      const rect = surface.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    const sync = async () => {
      if (stopped || opening || surface.clientWidth < 1 || surface.clientHeight < 1) return;
      try {
        if (!opened) {
          opening = true;
          const mode = await openProviderWebApp(provider, bounds());
          if (mode === "external") {
            notifyRef.current(`${provider === "openai" ? "ChatGPT" : "Gemini"} opened in your browser. Embedded provider websites are disabled on Windows to keep terminals responsive.`);
            onExternalRef.current?.();
            return;
          }
          opened = true;
        } else {
          await resizeProviderWebApp(bounds());
        }
      } catch (caught) {
        if (!stopped) notifyRef.current(`Unable to embed ${provider === "openai" ? "ChatGPT" : "Gemini"}: ${String(caught)}`);
      } finally {
        opening = false;
      }
    };
    const observer = new ResizeObserver(() => { void sync(); });
    observer.observe(surface);
    window.addEventListener("resize", sync);
    void sync();
    return () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      void closeProviderWebApp();
    };
  }, [provider]);

  return <section className={`embedded-provider ${compact ? "compact" : ""}`}>{compact && <div className="embedded-provider-guard"><ShieldCheck size={13} /><span>Isolated provider web session</span></div>}<div className="embedded-provider-surface" ref={surfaceRef}><RefreshCw className="spin" size={20} /><span>Loading secure provider view…</span></div></section>;
}

function ChatMessage({ message, provider }: { message: AiMessage; provider: AiProvider }) {
  const parts = message.content.split(/(`[^`]+`)/g);
  return <div className={`chat-message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}>
    <span className="message-avatar">{message.role === "assistant" ? <Bot size={15} /> : "NE"}</span>
    <div><div className="message-meta"><strong>{message.role === "assistant" ? aiProviders[provider].name : "You"}</strong><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><div className="message-bubble">{parts.map((part, index) => part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>)}</div></div>
  </div>;
}

function ProviderSettings({ connected, setConnected, onOpenWeb, onClose, notify }: { connected: Record<"openai" | "gemini", boolean>; setConnected: (value: Record<"openai" | "gemini", boolean>) => void; onOpenWeb: (provider: "openai" | "gemini") => void; onClose: () => void; notify: (message: string) => void }) {
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await saveProviderKey(provider, apiKey.trim());
      setConnected({ ...connected, [provider]: true });
      setApiKey(""); setError(""); notify(`${aiProviders[provider].name} connected`); onClose();
    } catch (caught) { setError((caught as Error).message); }
  };
  const remove = async () => {
    await removeProviderKey(provider);
    setConnected({ ...connected, [provider]: false });
    notify(`${aiProviders[provider].name} disconnected`);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="provider-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><LockKeyhole size={18} /></span><div><h3>Connect an AI provider</h3><p>Use an in-app signed-in web session or connect an API key.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="provider-options"><button className={provider === "openai" ? "active" : ""} onClick={() => setProvider("openai")}><span className="openai-mark">O</span><div><strong>OpenAI</strong><small>GPT-5.6 Terra</small></div>{connected.openai && <Check size={15} />}</button><button className={provider === "gemini" ? "active" : ""} onClick={() => setProvider("gemini")}><span className="gemini-mark">G</span><div><strong>Google Gemini</strong><small>Gemini 3.6 Flash</small></div>{connected.gemini && <Check size={15} />}</button></div><form onSubmit={save} className="provider-form"><button type="button" className="web-mode-button" onClick={() => onOpenWeb(provider)}><Globe2 size={16} /><span><strong>Open {provider === "openai" ? "ChatGPT" : "Gemini"} inside the AI page</strong><small>Embedded web view using your existing account or subscription</small></span><ChevronRight size={15} /></button><p className="embedded-web-note">Web chat stays inside NetSSH but remains separate from terminal context. A provider may still move identity verification to your browser for security.</p><div className="web-chat-divider"><span>or connect for integrated context</span></div><label>{aiProviders[provider].name} API key</label><div className="secret-input"><KeyRound size={15} /><input type={visible ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider === "openai" ? "sk-…" : "AIza…"} /><button type="button" onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>{error && <span className="form-error">{error}</span>}<p>API access is separate from a consumer ChatGPT or Gemini subscription. It enables NetSSH to provide redacted session context and may be billed by your provider.</p><a href={provider === "openai" ? "https://platform.openai.com/api-keys" : "https://aistudio.google.com/app/apikey"} target="_blank" rel="noreferrer">Get an API key <ExternalLink size={12} /></a><div className="provider-actions">{connected[provider] && <button type="button" className="danger-button" onClick={remove}><Trash2 size={14} /> Disconnect</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!apiKey.trim()}>Save securely</button></div></form></section></div>;
}

function CommandPalette({ hosts, onClose, onConnect, onNavigate }: { hosts: Host[]; onClose: () => void; onConnect: (host: Host) => void; onNavigate: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => hosts.filter((host) => `${host.name} ${host.address}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4), [query]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}><div className="palette-search"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices, tools, and commands…" /><kbd>ESC</kbd></div><div className="palette-body"><span className="nav-label">Devices</span>{results.map((host) => <button key={host.id} onClick={() => { onConnect(host); onClose(); }}><span className="device-icon"><Router size={17} /></span><div><strong>{host.name}</strong><small>{host.address} · {host.site}</small></div><span className={`device-state ${host.status}`} /></button>)}<span className="nav-label">Actions</span><button onClick={() => { onNavigate("toolbox"); onClose(); }}><span className="device-icon"><Calculator size={17} /></span><div><strong>Open subnet calculator</strong><small>Network toolbox</small></div><Command size={14} /></button><button onClick={() => { onNavigate("assistant"); onClose(); }}><span className="device-icon"><Bot size={17} /></span><div><strong>Ask the network copilot</strong><small>AI assistant</small></div><Command size={14} /></button></div><div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span></div></div></div>;
}

export default App;
