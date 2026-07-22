import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AiMessage, AiProvider } from "./types";

export const aiProviders = {
  openai: { name: "OpenAI", model: "GPT-5.6 Terra", accent: "#72e6b1" },
  gemini: { name: "Google Gemini", model: "Gemini 3.6 Flash", accent: "#79a7ff" },
  demo: { name: "NetSSH Demo", model: "Offline preview", accent: "#b69cff" },
} satisfies Record<AiProvider, { name: string; model: string; accent: string }>;

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function providerIsConnected(provider: Exclude<AiProvider, "demo">): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("has_ai_key", { provider });
}

export async function saveProviderKey(provider: Exclude<AiProvider, "demo">, apiKey: string): Promise<void> {
  if (!isTauri()) throw new Error("Provider keys can only be saved in the native desktop app.");
  await invoke("save_ai_key", { provider, apiKey });
}

export async function removeProviderKey(provider: Exclude<AiProvider, "demo">): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_ai_key", { provider });
}

export async function sendAiMessage(provider: AiProvider, messages: AiMessage[]): Promise<string> {
  const latest = messages.at(-1)?.content ?? "";
  if (provider === "demo" || !isTauri()) return demoResponse(latest);

  return invoke<string>("ask_ai", {
    request: {
      provider,
      messages: messages.map(({ role, content }) => ({ role, content })),
    },
  });
}

export async function openProviderWebApp(provider: "openai" | "gemini"): Promise<void> {
  const url = provider === "openai" ? "https://chatgpt.com/" : "https://gemini.google.com/app";
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function demoResponse(prompt: string): Promise<string> {
  const normalized = prompt.toLowerCase();
  let response: string;
  if (normalized.includes("bgp")) {
    response = "Start by checking session state, uptime, and received prefixes with `show bgp summary`. If the peer is down, verify layer-3 reachability and TCP/179, then compare local/remote AS numbers and authentication on both ends. I would not reset the neighbour until we understand why it dropped.";
  } else if (normalized.includes("interface") || normalized.includes("packet loss")) {
    response = "Check the interface counters before clearing anything: `show interfaces counters errors` and the detailed interface view. Look for CRC/input errors, drops, duplex mismatch, or rising discards. Compare both ends of the link and capture a second sample after 60 seconds to confirm the counters are increasing.";
  } else if (normalized.includes("subnet") || normalized.includes("cidr")) {
    response = "Open the Subnet Calculator from the toolbox and enter the address in CIDR notation. For a change plan, also confirm the gateway, reserved addresses, routing advertisement, and whether the subnet overlaps any VRF or VPN routes.";
  } else {
    response = "I can help investigate this safely. Tell me the vendor/platform, the symptom, when it started, and any relevant command output. Remove passwords, keys, SNMP communities, and public IP details before sharing. I’ll suggest read-only checks first and clearly flag any command that changes state.";
  }
  return new Promise((resolve) => window.setTimeout(() => resolve(response), 650));
}
