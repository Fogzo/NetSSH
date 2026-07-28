import type { CommandSnippet, Host } from "./types";
import { ciscoCommandCatalogue } from "./ciscoCommands";

export const hosts: Host[] = [
  { id: "edge-01", name: "EDGE-RTR-01", address: "10.24.0.1", platform: "Cisco IOS-XE", site: "London DC", status: "online", latency: 12, favorite: true },
  { id: "core-01", name: "CORE-SW-01", address: "10.24.1.2", platform: "Arista EOS", site: "London DC", status: "online", latency: 8, favorite: true },
  { id: "fw-01", name: "FW-CLUSTER-A", address: "10.24.2.10", platform: "Palo Alto", site: "London DC", status: "warning", latency: 21, favorite: true },
  { id: "branch-07", name: "BRANCH-07-RTR", address: "10.48.7.1", platform: "Juniper JunOS", site: "Manchester", status: "online", latency: 34 },
  { id: "dist-02", name: "DIST-SW-02", address: "10.24.1.4", platform: "Cisco NX-OS", site: "London DC", status: "offline", latency: null },
  { id: "lab-01", name: "LAB-EVE-01", address: "192.168.50.10", platform: "Linux", site: "Network Lab", status: "online", latency: 3 },
];

export const ciscoDemoHosts: Host[] = [
  { id: "demo-cisco-iosxe", name: "DEMO-C9300-01", address: "sandbox-iosxe.local", platform: "Cisco IOS-XE", site: "Test Lab", status: "online", latency: 1, favorite: true, protocol: "ssh", username: "demo", tags: ["demo", "cisco", "switch"], demoProfile: "cisco-iosxe" },
  { id: "demo-cisco-nxos", name: "DEMO-N9K-01", address: "sandbox-nxos.local", platform: "Cisco NX-OS", site: "Test Lab", status: "online", latency: 1, protocol: "ssh", username: "demo", tags: ["demo", "cisco", "datacenter"], demoProfile: "cisco-nxos" },
];

export const recentCommands = [
  "show ip interface brief",
  "show bgp summary",
  "show interfaces counters errors",
  "show spanning-tree root",
];

function snippetCategory(command: string) {
  if (/interface|switchport|power inline|transceiver|errdisable|storm-control/.test(command)) return "Interfaces";
  if (/vlan|spanning-tree|etherchannel|port-channel|channel-group|mac address|lacp|pagp|vpc/.test(command)) return "Layer 2";
  if (/route|router |ospf|bgp|eigrp|standby|vrrp|vrf/.test(command)) return "Routing";
  if (/cdp|lldp|arp|ipv6 neighbors/.test(command)) return "Discovery";
  if (/access-list|access-group|authentication|dot1x|port-security|aaa|tacacs|radius|ssh|crypto|username|enable secret/.test(command)) return "Security";
  if (/logging|processes|memory|environment|platform|inventory|version|clock|ntp|snmp|license|switch stack|redundancy/.test(command)) return "System";
  if (/dhcp|nat|ip sla|track/.test(command)) return "Services";
  if (/copy |write memory|reload|clear |test aaa|ping |traceroute|terminal length/.test(command)) return "Operations";
  return command.startsWith("show ") ? "Monitoring" : "Configuration";
}

function snippetId(command: string, index: number) {
  const slug = command.toLowerCase().replace(/<[^>]+>/g, "value").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return `cisco-catalogue-${index}-${slug}`;
}

export const snippets: CommandSnippet[] = ciscoCommandCatalogue.map((suggestion, index) => ({
  id: snippetId(suggestion.command, index),
  name: suggestion.command,
  command: suggestion.command,
  vendor: "Cisco IOS/IOS-XE/NX-OS",
  category: snippetCategory(suggestion.command),
  description: suggestion.description,
}));
