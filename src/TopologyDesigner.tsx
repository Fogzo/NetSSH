import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes, Building2, Cable, Cloud, Database, Download, FileText, Laptop, Link2, Maximize2, Monitor, MousePointer2,
  Network, Phone, Plus, Printer, RadioTower, Router, Search, Server, Shield, Trash2, WandSparkles, Wifi,
  Waypoints, ZoomIn, ZoomOut, Save,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SetStateAction } from "react";
import type { Host } from "./types";

type NodeKind =
  | "inventory" | "switch" | "multilayer-switch" | "nexus" | "router" | "firewall" | "load-balancer"
  | "wireless-controller" | "access-point" | "server" | "virtual-host" | "desktop" | "laptop"
  | "phone" | "printer" | "internet" | "cloud" | "branch" | "datacentre";

type LinkType = "ethernet" | "fiber" | "etherchannel" | "wireless" | "vpn" | "console";

type TopologyNode = {
  id: string;
  hostId?: string;
  label: string;
  subtitle: string;
  kind: NodeKind;
  x: number;
  y: number;
};

type TopologyLink = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: LinkType;
  sourcePort: string;
  targetPort: string;
};

type TopologyMap = {
  version: 2;
  name: string;
  nodes: TopologyNode[];
  links: TopologyLink[];
};

type SavedTopologyDesign = {
  id: string;
  name: string;
  updatedAt: number;
  map: TopologyMap;
};

type TopologyWorkspace = {
  version: 1;
  activeDesignId: string;
  designs: SavedTopologyDesign[];
};

type SelectedItem = { type: "node" | "link"; id: string } | null;
type CanvasMode = "select" | "connect";
type LibraryItem = { kind: NodeKind; label: string; subtitle: string; badge: string; category: "Network" | "Endpoints" | "Locations"; icon: LucideIcon };

const STORAGE_KEY = "netssh.topology.v1";
const DESIGNS_STORAGE_KEY = "netssh.topology.designs.v1";
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;
const emptyMap: TopologyMap = { version: 2, name: "Network topology", nodes: [], links: [] };

const libraryItems: LibraryItem[] = [
  { kind: "switch", label: "L2 Switch", subtitle: "Access switch", badge: "SW", category: "Network", icon: Network },
  { kind: "multilayer-switch", label: "L3 Switch", subtitle: "Core / distribution", badge: "L3", category: "Network", icon: Waypoints },
  { kind: "nexus", label: "Nexus Switch", subtitle: "Data-centre fabric", badge: "NX", category: "Network", icon: Boxes },
  { kind: "router", label: "Router", subtitle: "WAN router", badge: "RTR", category: "Network", icon: Router },
  { kind: "firewall", label: "Firewall", subtitle: "Security appliance", badge: "FW", category: "Network", icon: Shield },
  { kind: "load-balancer", label: "Load Balancer", subtitle: "Application delivery", badge: "LB", category: "Network", icon: Waypoints },
  { kind: "wireless-controller", label: "Wireless Ctrl", subtitle: "WLAN controller", badge: "WLC", category: "Network", icon: RadioTower },
  { kind: "access-point", label: "Access Point", subtitle: "Wireless AP", badge: "AP", category: "Network", icon: Wifi },
  { kind: "server", label: "Server", subtitle: "Physical server", badge: "SRV", category: "Endpoints", icon: Server },
  { kind: "virtual-host", label: "Virtual Host", subtitle: "Hypervisor / cluster", badge: "VM", category: "Endpoints", icon: Database },
  { kind: "desktop", label: "Desktop PC", subtitle: "User workstation", badge: "PC", category: "Endpoints", icon: Monitor },
  { kind: "laptop", label: "Laptop", subtitle: "Mobile endpoint", badge: "LAP", category: "Endpoints", icon: Laptop },
  { kind: "phone", label: "IP Phone", subtitle: "Voice endpoint", badge: "TEL", category: "Endpoints", icon: Phone },
  { kind: "printer", label: "Printer", subtitle: "Network printer", badge: "PRN", category: "Endpoints", icon: Printer },
  { kind: "internet", label: "Internet", subtitle: "Public network", badge: "WAN", category: "Locations", icon: Cloud },
  { kind: "cloud", label: "Cloud", subtitle: "Cloud provider", badge: "CLD", category: "Locations", icon: Cloud },
  { kind: "branch", label: "Branch Site", subtitle: "Remote location", badge: "SITE", category: "Locations", icon: Building2 },
  { kind: "datacentre", label: "Data Centre", subtitle: "Facility / zone", badge: "DC", category: "Locations", icon: Building2 },
];

const linkLabels: Record<LinkType, string> = {
  ethernet: "Ethernet",
  fiber: "Fibre",
  etherchannel: "Port-channel",
  wireless: "Wireless",
  vpn: "VPN tunnel",
  console: "Console",
};

function loadMap(): TopologyMap {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<TopologyMap> & { version?: number } | null;
    if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.links)) return emptyMap;
    return {
      version: 2,
      name: stored.name || emptyMap.name,
      nodes: stored.nodes.map((rawNode) => {
        const node = rawNode as unknown as Omit<TopologyNode, "kind"> & { kind: NodeKind | "device" };
        return { ...node, kind: node.kind === "device" ? "inventory" : node.kind };
      }),
      links: stored.links.map((link) => ({ ...link, type: link.type || "ethernet", sourcePort: link.sourcePort || "", targetPort: link.targetPort || "" })) as TopologyLink[],
    };
  } catch {
    return emptyMap;
  }
}

function createEmptyMap(name = "Untitled topology"): TopologyMap {
  return { version: 2, name, nodes: [], links: [] };
}

function loadWorkspace(): TopologyWorkspace {
  try {
    const stored = JSON.parse(localStorage.getItem(DESIGNS_STORAGE_KEY) ?? "null") as TopologyWorkspace | null;
    if (stored?.version === 1 && stored.designs.length > 0 && stored.designs.some((design) => design.id === stored.activeDesignId)) return stored;
  } catch {}
  const migratedMap = loadMap();
  const id = crypto.randomUUID();
  return { version: 1, activeDesignId: id, designs: [{ id, name: migratedMap.name, updatedAt: Date.now(), map: migratedMap }] };
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value: string) {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "netssh-topology";
}

function pdfText(value: string) {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/([\\()])/g, "\\$1");
}

function createTopologyPdf(map: TopologyMap, hosts: Map<string, Host>) {
  const pageWidth = 842;
  const pageHeight = 595;
  const left = 36;
  const bottom = 54;
  const diagramWidth = 770;
  const diagramHeight = 460;
  const scaleX = diagramWidth / CANVAS_WIDTH;
  const scaleY = diagramHeight / CANVAS_HEIGHT;
  const point = (x: number, y: number) => ({ x: left + x * scaleX, y: bottom + (CANVAS_HEIGHT - y) * scaleY });
  const commands: string[] = ["1 1 1 rg 0 0 842 595 re f", "0.12 0.18 0.22 rg", `BT /F2 18 Tf 36 557 Td (${pdfText(map.name)}) Tj ET`, "0.38 0.45 0.49 rg", `BT /F1 8 Tf 36 541 Td (NetSSH topology - ${map.nodes.length} nodes - ${map.links.length} links) Tj ET`, "0.93 0.95 0.96 rg 36 54 770 460 re f"];
  const linkColours: Record<LinkType, string> = { ethernet: "0.30 0.43 0.38", fiber: "0.24 0.55 0.76", etherchannel: "0.31 0.65 0.50", wireless: "0.55 0.38 0.74", vpn: "0.76 0.52 0.22", console: "0.46 0.51 0.55" };
  map.links.forEach((link) => {
    const source = map.nodes.find((node) => node.id === link.source);
    const target = map.nodes.find((node) => node.id === link.target);
    if (!source || !target) return;
    const from = point(source.x, source.y);
    const to = point(target.x, target.y);
    const dash = link.type === "wireless" ? "[7 5] 0 d" : link.type === "vpn" ? "[10 4] 0 d" : link.type === "console" ? "[2 4] 0 d" : "[] 0 d";
    commands.push(`${linkColours[link.type]} RG 1.5 w ${dash} ${from.x.toFixed(2)} ${from.y.toFixed(2)} m ${to.x.toFixed(2)} ${to.y.toFixed(2)} l S`);
    if (link.type === "etherchannel") commands.push(`${(from.x + 3).toFixed(2)} ${(from.y + 3).toFixed(2)} m ${(to.x + 3).toFixed(2)} ${(to.y + 3).toFixed(2)} l S`);
    const label = [link.sourcePort, link.label, link.targetPort].filter(Boolean).join(" - ");
    const middleX = (from.x + to.x) / 2;
    const middleY = (from.y + to.y) / 2;
    commands.push("0.17 0.24 0.27 rg", `BT /F1 7 Tf ${(middleX - Math.min(label.length * 1.8, 48)).toFixed(2)} ${(middleY + 5).toFixed(2)} Td (${pdfText(shortText(label, 34))}) Tj ET`);
  });
  map.nodes.forEach((node) => {
    const host = node.hostId ? hosts.get(node.hostId) : undefined;
    const centre = point(node.x, node.y);
    const width = 92;
    const height = 48;
    const x = centre.x - width / 2;
    const y = centre.y - height / 2;
    commands.push("1 1 1 rg", `${x.toFixed(2)} ${y.toFixed(2)} ${width} ${height} re f`, "0.65 0.72 0.75 RG 0.8 w", `${x.toFixed(2)} ${y.toFixed(2)} ${width} ${height} re S`, "0.18 0.39 0.31 rg", `${(x + 7).toFixed(2)} ${(y + 27).toFixed(2)} 20 14 re f`, "1 1 1 rg", `BT /F2 6 Tf ${(x + 10).toFixed(2)} ${(y + 32).toFixed(2)} Td (${pdfText(nodeBadge(node, host))}) Tj ET`, "0.14 0.20 0.23 rg", `BT /F2 8 Tf ${(x + 32).toFixed(2)} ${(y + 32).toFixed(2)} Td (${pdfText(shortText(node.label, 18))}) Tj ET`, "0.38 0.45 0.49 rg", `BT /F1 6 Tf ${(x + 32).toFixed(2)} ${(y + 21).toFixed(2)} Td (${pdfText(shortText(node.subtitle, 23))}) Tj ET`, `BT /F1 6 Tf ${(x + 7).toFixed(2)} ${(y + 8).toFixed(2)} Td (${pdfText(shortText(nodeMeta(node, host), 31))}) Tj ET`);
  });
  commands.push("0.45 0.50 0.54 rg", `BT /F1 7 Tf 36 28 Td (Exported ${pdfText(new Date().toLocaleString())} - NetSSH) Tj ET`);
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function inventoryKind(host?: Host): NodeKind {
  const identity = `${host?.name ?? ""} ${host?.platform ?? ""}`.toLowerCase();
  if (identity.includes("nexus") || identity.includes("nx-os")) return "nexus";
  if (identity.includes("firewall") || identity.includes("forti") || identity.includes("palo")) return "firewall";
  if (identity.includes("router") || identity.includes("rtr")) return "router";
  if (identity.includes("wireless") || identity.includes(" wlc")) return "wireless-controller";
  if (identity.includes("access point") || identity.includes(" ap")) return "access-point";
  if (identity.includes("server") || identity.includes("linux")) return "server";
  return "switch";
}

function displayKind(node: TopologyNode, host?: Host) {
  return node.kind === "inventory" ? inventoryKind(host) : node.kind;
}

function nodeBadge(node: TopologyNode, host?: Host) {
  const kind = displayKind(node, host);
  return libraryItems.find((item) => item.kind === kind)?.badge ?? "NET";
}

function nodeMeta(node: TopologyNode, host?: Host) {
  if (host) return `${host.site} · ${(host.protocol ?? "ssh").toUpperCase()}`;
  return libraryItems.find((item) => item.kind === node.kind)?.subtitle ?? "Diagram object";
}

function shortText(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function TopologyDesigner({ hosts, onConnect, notify }: { hosts: Host[]; onConnect: (host: Host) => void; notify: (message: string) => void }) {
  const [workspace, setWorkspace] = useState<TopologyWorkspace>(loadWorkspace);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<LinkType>("ethernet");
  const [linkLabel, setLinkLabel] = useState(linkLabels.ethernet);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [clearArmed, setClearArmed] = useState(false);
  const [deleteDesignArmed, setDeleteDesignArmed] = useState(false);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const activeDesign = workspace.designs.find((design) => design.id === workspace.activeDesignId) ?? workspace.designs[0];
  const map = activeDesign?.map ?? emptyMap;
  const setMap = (update: SetStateAction<TopologyMap>) => {
    setWorkspace((current) => ({
      ...current,
      designs: current.designs.map((design) => {
        if (design.id !== current.activeDesignId) return design;
        const nextMap = typeof update === "function" ? update(design.map) : update;
        return { ...design, name: nextMap.name, updatedAt: Date.now(), map: nextMap };
      }),
    }));
  };
  const hostMap = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  const addedHosts = useMemo(() => new Set(map.nodes.flatMap((node) => node.hostId ? [node.hostId] : [])), [map.nodes]);
  const cleanQuery = query.trim().toLowerCase();
  const filteredHosts = hosts.filter((host) => `${host.name} ${host.address} ${host.site} ${host.platform}`.toLowerCase().includes(cleanQuery));
  const filteredLibrary = libraryItems.filter((item) => `${item.label} ${item.subtitle} ${item.category}`.toLowerCase().includes(cleanQuery));
  const selectedNode = selected?.type === "node" ? map.nodes.find((node) => node.id === selected.id) : undefined;
  const selectedLink = selected?.type === "link" ? map.links.find((link) => link.id === selected.id) : undefined;

  useEffect(() => {
    localStorage.setItem(DESIGNS_STORAGE_KEY, JSON.stringify(workspace));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }, [workspace, map]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (!selected || !["Delete", "Backspace"].includes(event.key) || ["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
      event.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  });

  const viewport = useMemo(() => {
    const width = CANVAS_WIDTH / zoom;
    const height = CANVAS_HEIGHT / zoom;
    return { x: (CANVAS_WIDTH - width) / 2, y: (CANVAS_HEIGHT - height) / 2, width, height };
  }, [zoom]);

  const canvasPoint = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: viewport.x + ((event.clientX - rect.left) / rect.width) * viewport.width,
      y: viewport.y + ((event.clientY - rect.top) / rect.height) * viewport.height,
    };
  };

  const nextPosition = () => {
    const index = map.nodes.length;
    return { x: 160 + (index % 4) * 245, y: 120 + Math.floor(index / 4) * 170 };
  };

  const addHost = (host: Host) => {
    if (addedHosts.has(host.id)) {
      const existing = map.nodes.find((node) => node.hostId === host.id);
      if (existing) setSelected({ type: "node", id: existing.id });
      return;
    }
    const node: TopologyNode = { id: crypto.randomUUID(), hostId: host.id, label: host.name, subtitle: host.address, kind: "inventory", ...nextPosition() };
    setMap((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelected({ type: "node", id: node.id });
  };

  const addLibraryItem = (item: LibraryItem) => {
    const node: TopologyNode = { id: crypto.randomUUID(), label: item.label, subtitle: item.subtitle, kind: item.kind, ...nextPosition() };
    setMap((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelected({ type: "node", id: node.id });
  };

  const selectNode = (node: TopologyNode) => {
    if (mode === "connect") {
      if (!linkStart) {
        setLinkStart(node.id);
        setSelected({ type: "node", id: node.id });
        return;
      }
      if (linkStart !== node.id) {
        const link: TopologyLink = { id: crypto.randomUUID(), source: linkStart, target: node.id, label: linkLabel.trim() || linkLabels[linkType], type: linkType, sourcePort: "", targetPort: "" };
        setMap((current) => ({ ...current, links: [...current.links, link] }));
        setSelected({ type: "link", id: link.id });
      }
      setLinkStart(null);
      return;
    }
    setSelected({ type: "node", id: node.id });
  };

  const removeSelected = () => {
    if (!selected) return;
    if (selected.type === "node") {
      setMap((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selected.id), links: current.links.filter((link) => link.source !== selected.id && link.target !== selected.id) }));
    } else {
      setMap((current) => ({ ...current, links: current.links.filter((link) => link.id !== selected.id) }));
    }
    setSelected(null);
    setLinkStart(null);
  };

  const updateSelectedNode = (changes: Partial<TopologyNode>) => {
    if (!selectedNode) return;
    setMap((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...changes } : node) }));
  };

  const updateSelectedLink = (changes: Partial<TopologyLink>) => {
    if (!selectedLink) return;
    setMap((current) => ({ ...current, links: current.links.map((link) => link.id === selectedLink.id ? { ...link, ...changes } : link) }));
  };

  const autoArrange = () => {
    setMap((current) => ({ ...current, nodes: current.nodes.map((node, index) => ({ ...node, x: 170 + (index % 4) * 280, y: 120 + Math.floor(index / 4) * 180 })) }));
    notify("Topology arranged");
  };

  const clearMap = () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setMap((current) => ({ ...current, nodes: [], links: [] }));
    setSelected(null);
    setLinkStart(null);
    setClearArmed(false);
    notify("Topology cleared");
  };

  const exportMap = () => {
    download(`${safeFilename(map.name)}.json`, JSON.stringify({ product: "NetSSH", exportedAt: new Date().toISOString(), topology: map }, null, 2), "application/json");
    notify("Topology JSON exported");
  };

  const exportPdf = () => {
    download(`${safeFilename(map.name)}.pdf`, createTopologyPdf(map, hostMap), "application/pdf");
    notify("Topology PDF exported");
  };

  const saveDesign = () => {
    localStorage.setItem(DESIGNS_STORAGE_KEY, JSON.stringify(workspace));
    notify(`${map.name} saved locally`);
  };

  const createDesign = () => {
    const id = crypto.randomUUID();
    const nextMap = createEmptyMap(`Topology ${workspace.designs.length + 1}`);
    setWorkspace((current) => ({ ...current, activeDesignId: id, designs: [...current.designs, { id, name: nextMap.name, updatedAt: Date.now(), map: nextMap }] }));
    setSelected(null);
    setLinkStart(null);
    setClearArmed(false);
    setDeleteDesignArmed(false);
    setMode("select");
    notify("New topology design created");
  };

  const switchDesign = (id: string) => {
    setWorkspace((current) => ({ ...current, activeDesignId: id }));
    setSelected(null);
    setLinkStart(null);
    setClearArmed(false);
    setDeleteDesignArmed(false);
    setMode("select");
  };

  const deleteDesign = () => {
    if (workspace.designs.length === 1) return;
    if (!deleteDesignArmed) {
      setDeleteDesignArmed(true);
      return;
    }
    setWorkspace((current) => {
      const designs = current.designs.filter((design) => design.id !== current.activeDesignId);
      return { ...current, activeDesignId: designs[0].id, designs };
    });
    setSelected(null);
    setLinkStart(null);
    setDeleteDesignArmed(false);
    notify("Saved topology design deleted");
  };

  const renderLink = (link: TopologyLink) => {
    const source = map.nodes.find((node) => node.id === link.source);
    const target = map.nodes.find((node) => node.id === link.target);
    if (!source || !target) return null;
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2;
    const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1;
    const offsetX = -((target.y - source.y) / distance) * 3;
    const offsetY = ((target.x - source.x) / distance) * 3;
    const label = [link.sourcePort, link.label, link.targetPort].filter(Boolean).join(" · ");
    const labelWidth = Math.max(58, label.length * 7.1);
    return <g key={link.id} className={`topology-link link-${link.type} ${selected?.type === "link" && selected.id === link.id ? "selected" : ""}`} onClick={(event) => { event.stopPropagation(); setSelected({ type: "link", id: link.id }); }}>
      <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hit" />
      {link.type === "etherchannel" ? <><line x1={source.x + offsetX} y1={source.y + offsetY} x2={target.x + offsetX} y2={target.y + offsetY} /><line x1={source.x - offsetX} y1={source.y - offsetY} x2={target.x - offsetX} y2={target.y - offsetY} /></> : <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />}
      <rect x={middleX - labelWidth / 2} y={middleY - 10} width={labelWidth} height="20" rx="7" />
      <text x={middleX} y={middleY + 3}>{shortText(label, 30)}</text>
    </g>;
  };

  return <div className="topology-page">
    <aside className="topology-library">
      <div className="topology-library-head"><span><Network size={18} /></span><div><h2>Topology</h2><p>Inventory and network stencils</p></div></div>
      <div className="topology-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices and stencils" /></div>
      <div className="topology-library-content">
        {(["Network", "Endpoints", "Locations"] as const).map((category) => {
          const items = filteredLibrary.filter((item) => item.category === category);
          if (!items.length) return null;
          return <section className="topology-stencil-section" key={category}><div className="topology-section-title"><strong>{category}</strong><span>{items.length}</span></div><div className="topology-stencil-grid">{items.map((item) => <button key={item.kind} className={`topology-stencil stencil-${item.kind}`} onClick={() => addLibraryItem(item)} title={`Add ${item.label}`}><span><item.icon size={16} /></span><strong>{item.label}</strong><Plus size={12} /></button>)}</div></section>;
        })}
        {filteredHosts.length > 0 && <section className="topology-stencil-section inventory-section"><div className="topology-section-title"><strong>Inventory devices</strong><span>{filteredHosts.length}</span></div><div className="topology-device-list">{filteredHosts.map((host) => <button key={host.id} className={addedHosts.has(host.id) ? "added" : ""} onClick={() => addHost(host)}><span className={`topology-status ${host.status}`} /><div><strong>{host.name}</strong><small>{host.address} · {host.site}</small></div>{addedHosts.has(host.id) ? <span>Added</span> : <Plus size={14} />}</button>)}</div></section>}
        {!filteredLibrary.length && !filteredHosts.length && <div className="topology-library-empty">No matching topology items</div>}
      </div>
      <section className="topology-inspector"><strong>Properties</strong>{selectedNode ? <><label>Node label<input value={selectedNode.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} /></label><label>Subtitle / address<input value={selectedNode.subtitle} onChange={(event) => updateSelectedNode({ subtitle: event.target.value })} /></label>{selectedNode.kind !== "inventory" && <label>Device type<select value={selectedNode.kind} onChange={(event) => updateSelectedNode({ kind: event.target.value as NodeKind })}>{libraryItems.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label>}{selectedNode.hostId && hostMap.has(selectedNode.hostId) && <button className="topology-connect" onClick={() => onConnect(hostMap.get(selectedNode.hostId!)!)}><Router size={14} /> Open terminal</button>}<button className="topology-delete" onClick={removeSelected}><Trash2 size={13} /> Remove node</button></> : selectedLink ? <><label>Connection type<select value={selectedLink.type} onChange={(event) => updateSelectedLink({ type: event.target.value as LinkType })}>{Object.entries(linkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Link label<input value={selectedLink.label} onChange={(event) => updateSelectedLink({ label: event.target.value })} /></label><div className="topology-port-fields"><label>Source port<input value={selectedLink.sourcePort} onChange={(event) => updateSelectedLink({ sourcePort: event.target.value })} placeholder="Gi1/0/48" /></label><label>Target port<input value={selectedLink.targetPort} onChange={(event) => updateSelectedLink({ targetPort: event.target.value })} placeholder="Eth1/1" /></label></div><button className="topology-delete" onClick={removeSelected}><Trash2 size={13} /> Remove link</button></> : <p>Add any stencil to start from scratch, or select an inventory device to link the diagram to a live terminal.</p>}</section>
    </aside>
    <main className="topology-workspace">
      <header className="topology-toolbar">
        <div className="topology-design-picker"><select aria-label="Saved topology design" value={workspace.activeDesignId} onChange={(event) => switchDesign(event.target.value)}>{workspace.designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}</select></div>
        <button onClick={createDesign} title="New topology design" aria-label="New topology design"><Plus size={15} /></button>
        <button className={`topology-design-delete ${deleteDesignArmed ? "confirming" : ""}`} onClick={deleteDesign} disabled={workspace.designs.length === 1} title={deleteDesignArmed ? "Click again to delete this saved design" : "Delete saved design"} aria-label={deleteDesignArmed ? "Confirm delete saved design" : "Delete saved design"}><X size={15} /></button>
        <input className="topology-name" value={map.name} onChange={(event) => setMap((current) => ({ ...current, name: event.target.value }))} aria-label="Topology name" />
        <button onClick={saveDesign} title="Save topology design" aria-label="Save topology design"><Save size={15} /></button>
        <div className="topology-modes"><button className={mode === "select" ? "active" : ""} onClick={() => { setMode("select"); setLinkStart(null); }}><MousePointer2 size={14} /> Select</button><button className={mode === "connect" ? "active" : ""} onClick={() => setMode("connect")}><Link2 size={14} /> Connect</button></div>
        {mode === "connect" && <><div className="topology-link-type"><Cable size={13} /><select aria-label="New connection type" value={linkType} onChange={(event) => { const type = event.target.value as LinkType; setLinkType(type); setLinkLabel(linkLabels[type]); }}>{Object.entries(linkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><input className="topology-link-label" value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Link label" /></>}
        <span className="topology-saved">{workspace.designs.length} saved</span>{clearArmed && <span className="topology-clear-confirm">Click trash again to clear</span>}
        <button onClick={autoArrange} title="Auto arrange"><WandSparkles size={15} /></button><button onClick={() => setZoom((value) => Math.max(.65, value - .15))} title="Zoom out"><ZoomOut size={15} /></button><button onClick={() => setZoom((value) => Math.min(1.6, value + .15))} title="Zoom in"><ZoomIn size={15} /></button><button onClick={() => setZoom(1)} title="Reset zoom"><Maximize2 size={15} /></button><button onClick={exportMap} title="Export JSON" aria-label="Export topology JSON"><Download size={15} /></button><button onClick={exportPdf} title="Export PDF" aria-label="Export topology PDF"><FileText size={15} /></button><button className={`topology-clear ${clearArmed ? "confirming" : ""}`} onClick={clearMap} disabled={map.nodes.length === 0 && map.links.length === 0} title={clearArmed ? "Click again to permanently clear topology" : "Clear topology"} aria-label={clearArmed ? "Confirm clear topology" : "Clear topology"}><Trash2 size={15} /></button>
      </header>
      <div className={`topology-canvas ${mode === "connect" ? "connecting" : ""}`}>
        {map.nodes.length === 0 && <div className="topology-empty"><div className="topology-empty-card"><span className="topology-empty-icon"><Network size={21} /></span><div><strong>Start a network design</strong><p>Add a device stencil or inventory item from the library.</p></div><div className="topology-empty-steps"><span>1 · Add devices</span><span>2 · Connect links</span><span>3 · Export or share</span></div></div></div>}
        <svg ref={svgRef} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; const point = canvasPoint(event); setMap((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === drag.id ? { ...node, x: Math.max(70, Math.min(CANVAS_WIDTH - 70, point.x - drag.offsetX)), y: Math.max(45, Math.min(CANVAS_HEIGHT - 45, point.y - drag.offsetY)) } : node) })); }} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }} onClick={() => setSelected(null)}>
          <defs><pattern id="topology-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs>
          <rect x="0" y="0" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="topology-grid" />
          {map.links.map(renderLink)}
          {map.nodes.map((node) => { const host = node.hostId ? hostMap.get(node.hostId) : undefined; const kind = displayKind(node, host); const active = selected?.type === "node" && selected.id === node.id; const linking = linkStart === node.id; return <g key={node.id} className={`topology-node kind-${kind} ${active ? "selected" : ""} ${linking ? "linking" : ""}`} transform={`translate(${node.x - 72} ${node.y - 42})`} onClick={(event) => { event.stopPropagation(); selectNode(node); }} onDoubleClick={() => { if (host) onConnect(host); }} onPointerDown={(event) => { if (mode !== "select") return; event.stopPropagation(); const point = canvasPoint(event); dragRef.current = { id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y }; event.currentTarget.setPointerCapture(event.pointerId); setSelected({ type: "node", id: node.id }); }}><rect width="144" height="84" rx="14" /><circle cx="26" cy="27" r="14" className={`node-state ${host?.status ?? kind}`} /><text x="26" y="31" className="node-badge">{nodeBadge(node, host)}</text><text x="48" y="27" className="node-label">{shortText(node.label, 17)}</text><text x="48" y="43" className="node-subtitle">{shortText(node.subtitle, 22)}</text><text x="14" y="69" className="node-meta">{shortText(nodeMeta(node, host), 29)}</text></g>; })}
        </svg>
        {mode === "connect" && <div className="topology-hint">{linkStart ? "Select the destination node" : `Select the first node for the ${linkLabels[linkType]} link`}</div>}
      </div>
    </main>
  </div>;
}
