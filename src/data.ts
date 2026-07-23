import type { CommandSnippet, Host } from "./types";

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

export const snippets: CommandSnippet[] = [
  { id: "cisco-ip-brief", name: "Interface summary", command: "show ip interface brief", vendor: "Cisco IOS/IOS-XE", category: "Interfaces", description: "Quickly review interface addressing and protocol state." },
  { id: "cisco-interface-errors", name: "Interface errors", command: "show interfaces counters errors", vendor: "Cisco IOS-XE", category: "Interfaces", description: "Check CRC, input, output, collision, and discard counters." },
  { id: "cisco-trunks", name: "Switchport trunks", command: "show interfaces trunk", vendor: "Cisco IOS/IOS-XE", category: "Switching", description: "Review trunk state, native VLANs, and permitted VLANs." },
  { id: "cisco-stp-root", name: "Spanning-tree root", command: "show spanning-tree root", vendor: "Cisco IOS/IOS-XE", category: "Switching", description: "Identify root bridges, root ports, and path cost by VLAN." },
  { id: "cisco-etherchannel", name: "EtherChannel summary", command: "show etherchannel summary", vendor: "Cisco IOS/IOS-XE", category: "Switching", description: "Check port-channel protocol, member state, and bundling." },
  { id: "cisco-mac-table", name: "MAC address table", command: "show mac address-table dynamic", vendor: "Cisco IOS/IOS-XE", category: "Switching", description: "Display dynamically learned MAC addresses and interfaces." },
  { id: "cisco-routes", name: "Routing table", command: "show ip route", vendor: "Cisco IOS/IOS-XE", category: "Routing", description: "Review installed IPv4 routes and routing sources." },
  { id: "cisco-bgp-summary", name: "BGP neighbour summary", command: "show ip bgp summary", vendor: "Cisco IOS/IOS-XE", category: "Routing", description: "Check BGP session state, uptime, message counts, and prefixes." },
  { id: "cisco-ospf-neighbours", name: "OSPF neighbours", command: "show ip ospf neighbor", vendor: "Cisco IOS/IOS-XE", category: "Routing", description: "Review OSPF adjacencies, states, priorities, and dead timers." },
  { id: "cisco-cdp-neighbours", name: "CDP neighbour detail", command: "show cdp neighbors detail", vendor: "Cisco IOS/IOS-XE", category: "Discovery", description: "Inspect directly connected Cisco neighbours and management addresses." },
  { id: "cisco-logging", name: "Recent system logs", command: "show logging | last 50", vendor: "Cisco IOS-XE", category: "System", description: "Display the most recent buffered log entries." },
  { id: "cisco-cpu", name: "CPU utilisation", command: "show processes cpu sorted | exclude 0.00%", vendor: "Cisco IOS/IOS-XE", category: "System", description: "Find processes currently consuming CPU resources." },
  { id: "cisco-memory", name: "Memory utilisation", command: "show processes memory sorted", vendor: "Cisco IOS/IOS-XE", category: "System", description: "Review process and overall memory consumption." },
  { id: "cisco-nxos-vpc", name: "vPC status", command: "show vpc brief", vendor: "Cisco NX-OS", category: "Switching", description: "Check vPC peer, consistency, keepalive, and member status." },
  { id: "cisco-nxos-bgp", name: "NX-OS BGP summary", command: "show bgp ipv4 unicast summary", vendor: "Cisco NX-OS", category: "Routing", description: "Review IPv4 unicast BGP sessions and received prefixes." },
];
