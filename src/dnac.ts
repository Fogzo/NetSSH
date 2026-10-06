import { invoke, isTauri } from "@tauri-apps/api/core";

export type DnacSettings = {
  serverUrl: string;
  username: string;
  rememberConnection: boolean;
  allowInvalidCertificates: boolean;
};

export type DnacConnectionState = "not-configured" | "connecting" | "connected" | "error";

export type DnacConnectionResult = {
  connected: boolean;
  server: string;
  certificateVerification: boolean;
};

export type DnacClient = {
  hostname?: string;
  userId?: string;
  ipAddress?: string;
  ipv6Addresses: string[];
  macAddress: string;
  connectionStatus?: string;
  connectionType?: string;
  healthScore?: number;
  healthReason?: string;
  location?: string;
  site?: string;
  building?: string;
  floor?: string;
  connectedDevice?: string;
  connectedDeviceIp?: string;
  interfaceName?: string;
  vlanId?: string;
  ssid?: string;
  frequency?: string;
  channel?: string;
  operatingSystem?: string;
  deviceType?: string;
  vendor?: string;
  lastUpdated?: number;
};

export type DnacHealthCategory = {
  category: string;
  totalCount?: number | null;
  healthScore?: number | null;
  goodCount?: number | null;
  fairCount?: number | null;
  poorCount?: number | null;
  noHealthCount?: number | null;
  unmonitoredCount?: number | null;
};

export type DnacSiteHealth = {
  siteName: string;
  siteHierarchy?: string | null;
  networkHealthAverage?: number | null;
  deviceCount?: number | null;
};

export type DnacClientHealthScore = {
  category: string;
  clientCount?: number | null;
};

export type DnacClientHealth = {
  category: string;
  clientCount?: number | null;
  healthScore?: number | null;
  scores: DnacClientHealthScore[];
};

export type DnacHealthDevice = {
  id?: string | null;
  name: string;
  deviceType?: string | null;
  deviceFamily?: string | null;
  deviceRole?: string | null;
  model?: string | null;
  managementIp?: string | null;
  siteHierarchy?: string | null;
  reachability?: string | null;
  healthScore?: number | null;
  issueCount?: number | null;
  clientCount?: number | null;
  softwareVersion?: string | null;
  serialNumber?: string | null;
  uptime?: string | null;
};

export type DnacDeviceDetail = {
  name?: string | null;
  deviceType?: string | null;
  deviceFamily?: string | null;
  model?: string | null;
  managementIp?: string | null;
  siteHierarchy?: string | null;
  reachability?: string | null;
  healthScore?: number | null;
  clientCount?: number | null;
  softwareVersion?: string | null;
  serialNumber?: string | null;
  uptime?: string | null;
};

export type DnacNetworkHealth = {
  retrievedAt: number;
  overallScore?: number | null;
  totalDevices?: number | null;
  monitoredDevices?: number | null;
  healthyDevices?: number | null;
  unhealthyDevices?: number | null;
  fairDevices?: number | null;
  poorDevices?: number | null;
  unmonitoredDevices?: number | null;
  categories: DnacHealthCategory[];
  sites: DnacSiteHealth[];
  clientHealth: DnacClientHealth[];
  devices: DnacHealthDevice[];
  deviceCount?: number | null;
  devicesTruncated: boolean;
  siteError?: string | null;
  clientError?: string | null;
  deviceError?: string | null;
  inventoryError?: string | null;
};

export const defaultDnacSettings: DnacSettings = {
  serverUrl: "",
  username: "",
  rememberConnection: true,
  allowInvalidCertificates: false,
};

export function loadDnacSettings(): DnacSettings {
  try {
    return { ...defaultDnacSettings, ...JSON.parse(localStorage.getItem("netssh.dnac") ?? "{}") };
  } catch {
    return defaultDnacSettings;
  }
}

export function persistDnacSettings(settings: DnacSettings) {
  localStorage.setItem("netssh.dnac", JSON.stringify(settings));
}

function nativeOnly() {
  if (!isTauri()) throw new Error("Cisco Catalyst Center integration is available in the native NetSSH app.");
}

function request(settings: DnacSettings, password?: string) {
  return {
    serverUrl: settings.serverUrl.trim().replace(/\/+$/, ""),
    username: settings.username.trim(),
    password: password || null,
    allowInvalidCertificates: settings.allowInvalidCertificates,
  };
}

export async function hasDnacPassword(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("has_dnac_password");
}

export async function saveDnacConnection(settings: DnacSettings, password?: string): Promise<void> {
  if (!settings.serverUrl.trim() && !settings.username.trim()) {
    if (isTauri()) await invoke("clear_dnac_connection");
    persistDnacSettings(settings);
    return;
  }
  nativeOnly();
  if (settings.rememberConnection) {
    if (password) await invoke("save_dnac_password", { password });
    else if (!(await hasDnacPassword())) throw new Error("Enter the DNAC password before saving this connection.");
  } else {
    await invoke("delete_dnac_password");
  }
  persistDnacSettings(settings);
}

export async function testDnacConnection(settings: DnacSettings, password?: string): Promise<DnacConnectionResult> {
  nativeOnly();
  return invoke<DnacConnectionResult>("test_dnac_connection", { request: request(settings, password) });
}

export async function searchDnacClient(settings: DnacSettings, macAddress: string): Promise<DnacClient> {
  nativeOnly();
  return invoke<DnacClient>("search_dnac_client", { request: request(settings), macAddress });
}

export async function getDnacNetworkHealth(settings: DnacSettings): Promise<DnacNetworkHealth> {
  nativeOnly();
  return invoke<DnacNetworkHealth>("get_dnac_network_health", { request: request(settings) });
}

export async function getDnacDeviceDetail(settings: DnacSettings, deviceId: string): Promise<DnacDeviceDetail> {
  nativeOnly();
  return invoke<DnacDeviceDetail>("get_dnac_device_detail", { request: request(settings), deviceId });
}

export function connectionStateLabel(state: DnacConnectionState) {
  if (state === "connected") return "DNAC connected";
  if (state === "connecting") return "Connecting to DNAC";
  if (state === "error") return "DNAC needs attention";
  return "DNAC not configured";
}
