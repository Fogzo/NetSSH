import { invoke } from "@tauri-apps/api/core";

export interface WifiNetwork {
  ssid: string;
  bssid?: string | null;
  signalPercent?: number | null;
  estimatedRssiDbm?: number | null;
  channel?: string | null;
  radioType?: string | null;
  security?: string | null;
}

export interface WifiDiagnostic {
  platform: string;
  connected: boolean;
  interfaceName?: string | null;
  ssid?: string | null;
  bssid?: string | null;
  signalPercent?: number | null;
  rssiDbm?: number | null;
  noiseDbm?: number | null;
  snrDb?: number | null;
  channel?: string | null;
  band?: string | null;
  radioType?: string | null;
  txRateMbps?: number | null;
  rxRateMbps?: number | null;
  security?: string | null;
  nearbyNetworks: WifiNetwork[];
  recommendations: string[];
  rawOutput: string;
  elapsedMs: number;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function runWifiDiagnostic(): Promise<WifiDiagnostic> {
  if (isTauri()) return invoke<WifiDiagnostic>("run_wifi_diagnostic");
  return new Promise((resolve) => window.setTimeout(() => resolve({
    platform: "browser preview",
    connected: true,
    interfaceName: "Wi-Fi",
    ssid: "NetSSH-Lab",
    bssid: "02:00:00:00:00:01",
    signalPercent: 78,
    rssiDbm: -61,
    noiseDbm: -92,
    snrDb: 31,
    channel: "44",
    band: "5 GHz",
    radioType: "802.11ax",
    txRateMbps: 866,
    rxRateMbps: 780,
    security: "WPA3-Personal",
    nearbyNetworks: [
      { ssid: "NetSSH-Lab", bssid: "02:00:00:00:00:01", signalPercent: 78, estimatedRssiDbm: -61, channel: "44", radioType: "802.11ax", security: "WPA3-Personal" },
      { ssid: "Guest-WiFi", bssid: "02:00:00:00:00:02", signalPercent: 55, estimatedRssiDbm: -73, channel: "44", radioType: "802.11ac", security: "WPA2-Personal" },
    ],
    recommendations: ["Signal is suitable for normal data and voice use.", "Another nearby AP is using channel 44; check channel utilisation if performance is inconsistent.", "Browser preview uses demonstration data. Run the desktop app for local Wi-Fi measurements."],
    rawOutput: "Browser preview: demonstration Wi-Fi diagnostics.\nRun the native Windows or macOS application to inspect the local wireless adapter.",
    elapsedMs: 120,
  }), 500));
}

export function signalHealth(rssi?: number | null, percent?: number | null) {
  if (rssi != null) {
    if (rssi >= -50) return { label: "Excellent", tone: "excellent", score: 100 };
    if (rssi >= -60) return { label: "Very good", tone: "good", score: 85 };
    if (rssi >= -67) return { label: "Good", tone: "good", score: 70 };
    if (rssi >= -70) return { label: "Fair", tone: "fair", score: 55 };
    if (rssi >= -80) return { label: "Weak", tone: "weak", score: 35 };
    return { label: "Poor", tone: "poor", score: 15 };
  }
  const score = percent ?? 0;
  if (score >= 90) return { label: "Excellent", tone: "excellent", score };
  if (score >= 75) return { label: "Very good", tone: "good", score };
  if (score >= 60) return { label: "Good", tone: "good", score };
  if (score >= 45) return { label: "Fair", tone: "fair", score };
  if (score >= 25) return { label: "Weak", tone: "weak", score };
  return { label: "Poor", tone: "poor", score };
}
