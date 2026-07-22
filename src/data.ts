import type { Host } from "./types";

export const hosts: Host[] = [
  { id: "edge-01", name: "EDGE-RTR-01", address: "10.24.0.1", platform: "Cisco IOS-XE", site: "London DC", status: "online", latency: 12, favorite: true },
  { id: "core-01", name: "CORE-SW-01", address: "10.24.1.2", platform: "Arista EOS", site: "London DC", status: "online", latency: 8, favorite: true },
  { id: "fw-01", name: "FW-CLUSTER-A", address: "10.24.2.10", platform: "Palo Alto", site: "London DC", status: "warning", latency: 21, favorite: true },
  { id: "branch-07", name: "BRANCH-07-RTR", address: "10.48.7.1", platform: "Juniper JunOS", site: "Manchester", status: "online", latency: 34 },
  { id: "dist-02", name: "DIST-SW-02", address: "10.24.1.4", platform: "Cisco NX-OS", site: "London DC", status: "offline", latency: null },
  { id: "lab-01", name: "LAB-EVE-01", address: "192.168.50.10", platform: "Linux", site: "Network Lab", status: "online", latency: 3 },
];

export const recentCommands = [
  "show ip interface brief",
  "show bgp summary",
  "show interfaces counters errors",
  "show spanning-tree root",
];

export const snippets = [
  { name: "Interface health", command: "show interfaces | include line|error|drop", vendor: "Cisco" },
  { name: "BGP neighbours", command: "show bgp summary", vendor: "Universal" },
  { name: "Commit diff", command: "show | compare", vendor: "Juniper" },
  { name: "Routing table", command: "show ip route", vendor: "Universal" },
];
