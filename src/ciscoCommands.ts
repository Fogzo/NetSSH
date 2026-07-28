export type CiscoCommandKind = "show" | "configure" | "action";

export type CiscoCommandSuggestion = {
  command: string;
  description: string;
  kind: CiscoCommandKind;
};

const show = (command: string, description: string): CiscoCommandSuggestion => ({ command, description, kind: "show" });
const configure = (command: string, description: string): CiscoCommandSuggestion => ({ command, description, kind: "configure" });
const action = (command: string, description: string): CiscoCommandSuggestion => ({ command, description, kind: "action" });

export const ciscoCommandCatalogue: CiscoCommandSuggestion[] = [
  show("show version", "Display software version, hardware model, uptime, and boot image."),
  show("show running-config", "Display the configuration currently active in memory."),
  show("show startup-config", "Display the configuration that will load after a restart."),
  show("show inventory", "List installed chassis, modules, serial numbers, and product IDs."),
  show("show license summary", "Summarise installed licences and their current state."),
  show("show clock", "Display the device date, time, and configured timezone."),
  show("show users", "List users currently connected to the device."),
  show("show history", "Display commands held in the current CLI history buffer."),
  show("show interfaces", "Display detailed counters and state for every interface."),
  show("show interfaces status", "Summarise switchport state, VLAN, duplex, speed, and media."),
  show("show interfaces description", "List interface state alongside configured descriptions."),
  show("show interfaces counters errors", "Display physical and frame error counters by interface."),
  show("show interfaces counters", "Display traffic counters for switch interfaces."),
  show("show interfaces trunk", "List trunk ports, native VLANs, and allowed VLANs."),
  show("show interfaces switchport", "Display Layer 2 mode and VLAN settings for switchports."),
  show("show interfaces transceiver detail", "Display optical transceiver identity and signal levels."),
  show("show interfaces <interface>", "Display detailed status and counters for one interface."),
  show("show interfaces <interface> status", "Display status information for one interface."),
  show("show interfaces <interface> counters errors", "Display errors recorded on one interface."),
  show("show ip interface brief", "Summarise IPv4 addresses and line-protocol state."),
  show("show ipv6 interface brief", "Summarise IPv6 addresses and interface state."),
  show("show ip interface <interface>", "Display IPv4 processing details for one interface."),
  show("show vlan brief", "List VLAN IDs, names, state, and assigned access ports."),
  show("show vlan id <vlan-id>", "Display details and port membership for one VLAN."),
  show("show mac address-table", "Display learned Layer 2 MAC addresses and interfaces."),
  show("show mac address-table dynamic", "Display dynamically learned MAC addresses."),
  show("show mac address-table interface <interface>", "Display MAC addresses learned on one interface."),
  show("show spanning-tree", "Display spanning-tree state, roots, roles, and port costs."),
  show("show spanning-tree vlan <vlan-id>", "Display spanning-tree information for one VLAN."),
  show("show spanning-tree inconsistentports", "List ports blocked because of spanning-tree inconsistencies."),
  show("show etherchannel summary", "Summarise port channels and their member interface state."),
  show("show etherchannel port-channel", "Display detailed EtherChannel and port-channel information."),
  show("show pagp neighbor", "Display PAgP neighbours and negotiation state."),
  show("show lacp neighbor", "Display LACP peers and member-port information."),
  show("show cdp neighbors", "List directly connected Cisco Discovery Protocol neighbours."),
  show("show cdp neighbors detail", "Display detailed CDP neighbour identity, address, and port data."),
  show("show lldp neighbors", "List directly connected LLDP neighbours."),
  show("show lldp neighbors detail", "Display detailed LLDP neighbour identity and capabilities."),
  show("show arp", "Display the IPv4 ARP neighbour table."),
  show("show ip arp", "Display IPv4 address-to-MAC mappings."),
  show("show ipv6 neighbors", "Display the IPv6 neighbour-discovery cache."),
  show("show ip route", "Display the IPv4 routing table."),
  show("show ip route <address>", "Find the routing-table entry used for an IPv4 destination."),
  show("show ipv6 route", "Display the IPv6 routing table."),
  show("show ip protocols", "Display active routing protocols and their parameters."),
  show("show ip ospf neighbor", "Display OSPF neighbour adjacencies and state."),
  show("show ip ospf interface brief", "Summarise interfaces participating in OSPF."),
  show("show ip bgp summary", "Summarise BGP peers, state, uptime, and received prefixes."),
  show("show ip bgp", "Display the IPv4 BGP routing table."),
  show("show ip eigrp neighbors", "Display EIGRP neighbours and adjacency statistics."),
  show("show ip eigrp topology", "Display the EIGRP topology table."),
  show("show standby brief", "Summarise HSRP groups, roles, and virtual addresses."),
  show("show vrrp brief", "Summarise VRRP groups, roles, and virtual addresses."),
  show("show access-lists", "Display configured access lists and match counters."),
  show("show ip access-lists", "Display IPv4 access lists and per-entry match counters."),
  show("show route-map", "Display route maps, sequence entries, and match counters."),
  show("show ip nat translations", "Display active IPv4 NAT translations."),
  show("show ip dhcp binding", "Display DHCP leases allocated by the device."),
  show("show ip dhcp pool", "Display DHCP pool utilisation and configuration."),
  show("show ip sla summary", "Summarise configured IP SLA operations and state."),
  show("show track", "Display object-tracking state and changes."),
  show("show logging", "Display buffered system log messages and logging settings."),
  show("show logging last <lines>", "Display the most recent log messages on supported platforms."),
  show("show processes cpu sorted", "Display processes ordered by CPU consumption."),
  show("show processes memory sorted", "Display processes ordered by memory consumption."),
  show("show memory statistics", "Display system memory pools and utilisation."),
  show("show platform resources", "Display platform CPU, memory, and hardware resource health."),
  show("show environment all", "Display fans, power supplies, temperature, and environmental state."),
  show("show power inline", "Display Power over Ethernet allocation and consumption."),
  show("show switch", "Display switch-stack members, roles, priority, and state."),
  show("show switch stack-ports summary", "Summarise switch-stack link state."),
  show("show redundancy", "Display supervisor or control-plane redundancy state."),
  show("show boot", "Display boot variables and configuration-register information."),
  show("show flash:", "List files in local flash storage."),
  show("show file systems", "List mounted file systems and available space."),
  show("show archive", "Display configuration archive and rollback information."),
  show("show ntp associations", "Display NTP peers and synchronisation state."),
  show("show ntp status", "Display the current NTP synchronisation status."),
  show("show snmp", "Display SNMP engine counters and configuration state."),
  show("show aaa servers", "Display AAA server reachability and transaction statistics."),
  show("show tacacs", "Display TACACS+ server and transaction statistics."),
  show("show radius statistics", "Display RADIUS request and response statistics."),
  show("show authentication sessions", "Display authenticated access sessions."),
  show("show authentication sessions interface <interface> details", "Display authentication details for one access port."),
  show("show dot1x all", "Display 802.1X state and statistics."),
  show("show port-security", "Summarise switchport security state and violations."),
  show("show port-security interface <interface>", "Display port-security state and learned secure MAC addresses."),
  show("show errdisable recovery", "Display err-disable causes, detection, and recovery timers."),
  show("show storm-control", "Display configured storm-control thresholds and state."),
  show("show policy-map interface", "Display QoS policy counters applied to interfaces."),
  show("show class-map", "Display configured QoS class maps."),
  show("show crypto pki certificates", "Display installed PKI certificates and trustpoints."),
  show("show ssh", "Display active SSH sessions and server state."),
  show("show line", "Display console and VTY line state."),
  show("show terminal", "Display settings for the current terminal session."),
  show("show tech-support", "Collect extensive diagnostic output; this can be slow and large."),
  show("show module", "Display installed modules and operational state on modular platforms."),
  show("show vpc brief", "Summarise vPC domain and peer-link state on Nexus platforms."),
  show("show port-channel summary", "Summarise port channels and member state on Nexus platforms."),
  show("show interface brief", "Summarise interfaces on Nexus platforms."),
  show("show feature", "Display enabled and disabled NX-OS features."),
  show("show consistency-checker", "Display available Nexus consistency checks."),
  action("ping <address>", "Test IP reachability to a destination."),
  action("traceroute <address>", "Trace the Layer 3 path to a destination."),
  action("terminal length 0", "Disable terminal paging for the current session."),
  action("terminal length 24", "Restore a conventional 24-line terminal page length."),
  action("copy running-config startup-config", "Save the active configuration for the next reload."),
  action("write memory", "Save the running configuration using the legacy shorthand."),
  action("reload", "Restart the device after confirmation; causes an outage."),
  action("clear counters <interface>", "Reset traffic and error counters on an interface."),
  action("clear logging", "Clear buffered log messages."),
  action("clear mac address-table dynamic", "Flush dynamically learned MAC addresses."),
  action("clear ip arp", "Flush the IPv4 ARP cache."),
  action("test aaa group <group> <username> <password> legacy", "Test authentication against a configured AAA server group."),
  configure("configure terminal", "Enter global configuration mode."),
  configure("end", "Return directly to privileged EXEC mode."),
  configure("exit", "Leave the current configuration mode or session level."),
  configure("hostname <name>", "Set the device hostname."),
  configure("interface <interface>", "Enter configuration mode for one interface."),
  configure("interface range <range>", "Configure multiple interfaces together."),
  configure("description <text>", "Set a descriptive label on an interface or object."),
  action("shutdown", "Administratively disable the selected interface or service."),
  action("no shutdown", "Administratively enable the selected interface or service."),
  configure("switchport", "Set an interface to operate as a Layer 2 switchport."),
  configure("no switchport", "Set a supported interface to operate as a routed port."),
  configure("switchport mode access", "Configure a switchport as a static access port."),
  configure("switchport access vlan <vlan-id>", "Assign the access VLAN for a switchport."),
  configure("switchport voice vlan <vlan-id>", "Assign the auxiliary voice VLAN for a switchport."),
  configure("switchport mode trunk", "Configure a switchport as a static trunk."),
  configure("switchport trunk native vlan <vlan-id>", "Set the native VLAN on an 802.1Q trunk."),
  configure("switchport trunk allowed vlan <list>", "Replace the VLAN list permitted on a trunk."),
  configure("switchport trunk allowed vlan add <list>", "Add VLANs to the permitted trunk list."),
  configure("channel-group <number> mode active", "Join an interface to an LACP port channel."),
  configure("spanning-tree portfast", "Enable PortFast on an edge access port."),
  configure("spanning-tree bpduguard enable", "Err-disable an edge port if BPDUs are received."),
  configure("ip address <address> <mask>", "Assign an IPv4 address and subnet mask."),
  configure("ip address dhcp", "Obtain an IPv4 address using DHCP."),
  configure("ipv6 address <prefix>", "Assign an IPv6 address or prefix to an interface."),
  configure("ip helper-address <address>", "Relay UDP broadcasts such as DHCP to a server."),
  configure("ip route <prefix> <mask> <next-hop>", "Create a static IPv4 route."),
  configure("ipv6 route <prefix> <next-hop>", "Create a static IPv6 route."),
  configure("vlan <vlan-id>", "Create a VLAN or enter VLAN configuration mode."),
  configure("name <vlan-name>", "Set the name of the selected VLAN."),
  configure("router ospf <process-id>", "Create or enter an OSPF routing process."),
  configure("network <address> <wildcard> area <area>", "Enable OSPF for matching interfaces."),
  configure("router bgp <asn>", "Create or enter a BGP routing process."),
  configure("neighbor <address> remote-as <asn>", "Configure a BGP neighbour autonomous system."),
  configure("ip access-list standard <name>", "Create or edit a named standard IPv4 ACL."),
  configure("ip access-list extended <name>", "Create or edit a named extended IPv4 ACL."),
  configure("permit <protocol> <source> <destination>", "Add a permit entry to an access list."),
  configure("deny <protocol> <source> <destination>", "Add a deny entry to an access list."),
  configure("ip access-group <acl> in", "Apply an IPv4 ACL inbound on an interface."),
  configure("ip access-group <acl> out", "Apply an IPv4 ACL outbound on an interface."),
  configure("logging host <address>", "Send system messages to a remote syslog server."),
  configure("logging buffered <size>", "Configure the local buffered logging size."),
  configure("ntp server <address>", "Configure an NTP time source."),
  configure("snmp-server community <community> ro", "Configure a read-only SNMP community; prefer SNMPv3."),
  configure("username <name> privilege 15 secret <secret>", "Create a local privileged user with a hashed secret."),
  configure("enable secret <secret>", "Configure the privileged EXEC secret."),
  configure("ip domain-name <domain>", "Set the device DNS domain name."),
  configure("crypto key generate rsa modulus 2048", "Generate a 2048-bit RSA key pair for services such as SSH."),
  configure("ip ssh version 2", "Require SSH protocol version 2."),
  configure("line console 0", "Enter console-line configuration mode."),
  configure("line vty 0 15", "Enter virtual terminal line configuration mode."),
  configure("login local", "Authenticate line access using the local user database."),
  configure("transport input ssh", "Permit only SSH on selected VTY lines."),
  configure("exec-timeout <minutes> <seconds>", "Set the idle timeout for selected terminal lines."),
  configure("service password-encryption", "Obfuscate eligible clear-text passwords in configuration output."),
  configure("archive", "Enter configuration archive settings."),
  configure("feature <feature>", "Enable an NX-OS feature such as OSPF, LACP, or vPC."),
  configure("vpc domain <domain-id>", "Create or enter an NX-OS vPC domain."),
  configure("vrf context <name>", "Create or enter an NX-OS VRF context."),
];

function commandTokens(value: string) {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function tokenMatches(abbreviation: string, commandToken: string) {
  return commandToken.startsWith("<") || commandToken.startsWith(abbreviation);
}

export function findCiscoCommandSuggestions(value: string, limit = 8) {
  const query = value.trim().toLowerCase();
  const queryTokens = commandTokens(query);
  if (query.length < 2 || !queryTokens.length) return [];

  return ciscoCommandCatalogue
    .map((suggestion) => {
      const candidate = suggestion.command.toLowerCase();
      const candidateTokens = commandTokens(candidate);
      if (candidate === query || queryTokens.length > candidateTokens.length) return null;
      const abbreviationMatch = queryTokens.every((token, index) => tokenMatches(token, candidateTokens[index]));
      if (!abbreviationMatch) return null;
      const exactPrefix = candidate.startsWith(query);
      const distance = candidateTokens.reduce((total, token, index) => total + Math.max(0, token.length - (queryTokens[index]?.length ?? 0)), 0);
      return { suggestion, score: (exactPrefix ? 0 : 100) + distance };
    })
    .filter((result): result is { suggestion: CiscoCommandSuggestion; score: number } => Boolean(result))
    .sort((left, right) => left.score - right.score || left.suggestion.command.localeCompare(right.suggestion.command))
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}
