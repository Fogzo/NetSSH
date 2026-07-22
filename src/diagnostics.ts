import { invoke } from "@tauri-apps/api/core";

export type DiagnosticKind = "ping" | "trace" | "dns" | "port";

export interface DiagnosticResult {
  tool: DiagnosticKind;
  target: string;
  success: boolean;
  output: string;
  elapsedMs: number;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function runDiagnostic(kind: DiagnosticKind, target: string, port?: number): Promise<DiagnosticResult> {
  if (!isTauri()) return demoDiagnostic(kind, target, port);
  const command = { ping: "run_ping", trace: "run_trace", dns: "run_dns_lookup", port: "run_port_check" }[kind];
  return invoke<DiagnosticResult>(command, kind === "port" ? { target, port } : { target });
}

function demoDiagnostic(kind: DiagnosticKind, target: string, port?: number): Promise<DiagnosticResult> {
  const started = performance.now();
  const output = {
    ping: `PING ${target} (${target}): 56 data bytes\n64 bytes from ${target}: icmp_seq=0 ttl=61 time=12.4 ms\n64 bytes from ${target}: icmp_seq=1 ttl=61 time=11.8 ms\n64 bytes from ${target}: icmp_seq=2 ttl=61 time=12.1 ms\n\n--- ${target} ping statistics ---\n3 packets transmitted, 3 packets received, 0.0% packet loss`,
    trace: `traceroute to ${target}, 12 hops max\n 1  10.24.0.1       1.142 ms\n 2  172.20.10.1     4.831 ms\n 3  203.0.113.9     8.205 ms\n 4  ${target}       12.114 ms`,
    dns: `${target}\nA      203.0.113.42\nAAAA   2001:db8::42\n\nBrowser preview uses demonstration DNS data. Native mode queries the operating-system resolver.`,
    port: `Connection to ${target}:${port ?? 22} succeeded\nTCP handshake completed in 18 ms\nService: ${port === 443 ? "HTTPS" : port === 22 ? "SSH" : "TCP"}`,
  }[kind];
  return new Promise((resolve) => window.setTimeout(() => resolve({ tool: kind, target, success: true, output, elapsedMs: Math.round(performance.now() - started + 18) }), 450));
}
