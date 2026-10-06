import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock3, KeyRound, MapPin, Network, RefreshCw, Router, Search, Server, Settings, ShieldCheck, Users, Wifi, X } from "lucide-react";
import { connectionStateLabel, getDnacDeviceDetail, getDnacNetworkHealth, type DnacClientHealth, type DnacDeviceDetail, type DnacHealthDevice, type DnacNetworkHealth, type DnacConnectionState, type DnacSettings } from "./dnac";
import type { Host } from "./types";

type NetworkHealthProps = {
  settings: DnacSettings;
  connectionState: DnacConnectionState;
  onConnectionStateChange: (state: DnacConnectionState) => void;
  onOpenSettings: () => void;
  switchHosts: Host[];
  onOpenSwitchAudit: (host: Host) => void;
};

type DeviceKind = "switch" | "router" | "access-point" | "other";
type DeviceSeverity = "critical" | "warning" | "healthy" | "unknown";
type DeviceFilter = "all" | DeviceKind | "issues";

type SiteNode = {
  path: string;
  name: string;
  depth: number;
  health?: number | null;
  children: SiteNode[];
};

function count(value?: number | null) {
  return value == null ? "N/A" : value.toLocaleString();
}

function score(value?: number | null, denominator = 100) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value)}${denominator === 100 ? "%" : `/${denominator}`}`;
}

function percentTone(value?: number | null) {
  if (value == null) return "unknown";
  return value >= 90 ? "good" : value >= 70 ? "warning" : "bad";
}

function kindOf(device: DnacHealthDevice): DeviceKind {
  const identity = [device.deviceRole, device.deviceFamily, device.deviceType, device.model].filter(Boolean).join(" ").toLowerCase();
  if (/access point|unified ap|wireless ap|accesspoint/.test(identity)) return "access-point";
  if (identity.includes("router")) return "router";
  if (identity.includes("switch") || identity.includes("switches and hubs")) return "switch";
  return "other";
}

function kindLabel(kind: DeviceKind) {
  return kind === "access-point" ? "Access point" : kind === "switch" ? "Switch" : kind === "router" ? "Router" : "Other";
}

function reachability(device: DnacHealthDevice) {
  const value = device.reachability?.trim().toLowerCase() ?? "";
  if (value.includes("unreachable") || value.includes("not reachable") || value === "down") return "unreachable";
  if (value.includes("only_ping_reachable") || value.includes("only ping reachable")) return "partial";
  if (value.includes("reachable") || value === "up" || value === "online") return "reachable";
  return "unknown";
}

function severity(device: DnacHealthDevice): DeviceSeverity {
  if (reachability(device) === "unreachable") return "critical";
  if (reachability(device) === "partial") return "warning";
  if (device.healthScore != null && device.healthScore < 4) return "critical";
  if ((device.issueCount ?? 0) > 0 || (device.healthScore != null && device.healthScore < 8)) return "warning";
  if (reachability(device) === "reachable" && device.healthScore != null) return "healthy";
  return "unknown";
}

function problem(device: DnacHealthDevice) {
  if (reachability(device) === "unreachable") return "Unreachable";
  if (reachability(device) === "partial") return "Only ping responds";
  if ((device.issueCount ?? 0) > 0) return `${device.issueCount} issue${device.issueCount === 1 ? "" : "s"} reported by DNAC`;
  if (device.healthScore != null && device.healthScore < 8) return "DNAC health score below good range";
  return "Requires review";
}

function siteParts(path: string | null | undefined, fallback: string) {
  const parts = (path || fallback).split("/").map((part) => part.trim()).filter((part) => part && !part.toLowerCase().startsWith("global"));
  return parts.length ? parts : [fallback];
}

function normalizedSite(path?: string | null) {
  return siteParts(path, "").join("/").toLocaleLowerCase();
}

function isInSite(devicePath: string | null | undefined, sitePath: string) {
  const device = normalizedSite(devicePath);
  const site = normalizedSite(sitePath);
  return Boolean(site && (device === site || device.startsWith(`${site}/`)));
}

function buildSiteTree(data: DnacNetworkHealth): SiteNode[] {
  const roots: SiteNode[] = [];
  const healthByPath = new Map<string, number | null | undefined>();
  for (const site of data.sites) {
    const path = site.siteHierarchy || site.siteName;
    healthByPath.set(normalizedSite(path), site.networkHealthAverage);
  }
  const paths = [
    ...data.sites.map((site) => ({ path: site.siteHierarchy || site.siteName, fallback: site.siteName })),
    ...data.devices.filter((device) => device.siteHierarchy).map((device) => ({ path: device.siteHierarchy!, fallback: device.siteHierarchy!.split("/").at(-1) || "Site" })),
  ];
  for (const item of paths) {
    const parts = siteParts(item.path, item.fallback);
    let current = roots;
    let fullPath = "";
    parts.forEach((part, depth) => {
      fullPath = fullPath ? `${fullPath}/${part}` : part;
      let node = current.find((candidate) => candidate.path === fullPath);
      if (!node) {
        node = { path: fullPath, name: part, depth, health: healthByPath.get(normalizedSite(fullPath)), children: [] };
        current.push(node);
      } else if (healthByPath.has(normalizedSite(fullPath))) {
        node.health = healthByPath.get(normalizedSite(fullPath));
      }
      current = node.children;
    });
  }
  const sort = (nodes: SiteNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function filterSiteTree(nodes: SiteNode[], query: string): SiteNode[] {
  if (!query) return nodes;
  const needle = query.toLocaleLowerCase();
  return nodes.flatMap((node) => {
    const children = filterSiteTree(node.children, query);
    return node.name.toLocaleLowerCase().includes(needle) || node.path.toLocaleLowerCase().includes(needle) || children.length
      ? [{ ...node, children }]
      : [];
  });
}

function flattenSiteTree(nodes: SiteNode[], expanded: Set<string>, forceExpand: boolean): SiteNode[] {
  return nodes.flatMap((node) => [node, ...(node.children.length && (forceExpand || expanded.has(node.path)) ? flattenSiteTree(node.children, expanded, forceExpand) : [])]);
}

function weightedClientScore(rows: DnacClientHealth[]) {
  const scored = rows.filter((row) => row.healthScore != null && (row.clientCount ?? 0) > 0);
  const clients = scored.reduce((total, row) => total + (row.clientCount ?? 0), 0);
  if (!clients) return null;
  return scored.reduce((total, row) => total + (row.healthScore ?? 0) * (row.clientCount ?? 0), 0) / clients;
}

function MetricCard({ label, value, detail, tone = "unknown", icon: Icon, onClick }: { label: string; value: string; detail: string; tone?: string; icon: typeof Activity; onClick?: () => void }) {
  const content = <><span className="health-metric-icon"><Icon size={17} /></span><span className="health-metric-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>{onClick && <ChevronRight className="health-metric-arrow" size={14} />}</>;
  return onClick
    ? <button type="button" className={`health-metric ${tone} clickable`} onClick={onClick}>{content}</button>
    : <article className={`health-metric ${tone}`}>{content}</article>;
}

function SeverityBadge({ value }: { value: DeviceSeverity }) {
  const label = value === "critical" ? "Critical" : value === "warning" ? "Warning" : value === "healthy" ? "Healthy" : "Unknown";
  return <span className={`health-severity ${value}`}><i />{label}</span>;
}

function categoryDevices(data: DnacNetworkHealth, kind: DeviceKind) {
  return data.devices.filter((device) => kindOf(device) === kind);
}

function countHealth(data: DnacNetworkHealth, devices: DnacHealthDevice[]) {
  if (data.deviceError) return "N/A";
  const good = devices.filter((device) => severity(device) === "healthy").length;
  return data.devicesTruncated ? `≥${good}` : count(good);
}

function NetworkHealthDashboard({ data, settings, switchHosts, onOpenSwitchAudit }: { data: DnacNetworkHealth; settings: DnacSettings; switchHosts: Host[]; onOpenSwitchAudit: (host: Host) => void }) {
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("issues");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(() => new Set());
  const [selectedDevice, setSelectedDevice] = useState<DnacHealthDevice | null>(null);
  const [deviceDetail, setDeviceDetail] = useState<DnacDeviceDetail | null>(null);
  const [deviceDetailError, setDeviceDetailError] = useState("");
  const [deviceDetailLoading, setDeviceDetailLoading] = useState(false);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const attention = data.devices.filter((device) => ["critical", "warning"].includes(severity(device)));
  const switches = categoryDevices(data, "switch");
  const routers = categoryDevices(data, "router");
  const accessPoints = categoryDevices(data, "access-point");
  const clientScore = weightedClientScore(data.clientHealth);
  const clientCount = data.clientHealth.reduce((total, row) => total + (row.clientCount ?? 0), 0);
  const reachableCount = data.devices.filter((device) => reachability(device) === "reachable").length;
  const siteTree = useMemo(() => buildSiteTree(data), [data]);
  const filteredSiteTree = useMemo(() => filterSiteTree(siteTree, siteSearch.trim()), [siteTree, siteSearch]);
  const visibleSites = useMemo(() => flattenSiteTree(filteredSiteTree, expandedSites, Boolean(siteSearch.trim())), [filteredSiteTree, expandedSites, siteSearch]);
  const filteredDevices = useMemo(() => {
    const needle = deviceSearch.trim().toLocaleLowerCase();
    return data.devices.filter((device) => {
      const kind = kindOf(device);
      if (deviceFilter !== "all" && deviceFilter !== "issues" && kind !== deviceFilter) return false;
      if (deviceFilter === "issues" && !["critical", "warning"].includes(severity(device))) return false;
      if (selectedSite && !isInSite(device.siteHierarchy, selectedSite)) return false;
      if (!needle) return true;
      return [device.name, device.managementIp, device.siteHierarchy, device.serialNumber, device.model]
        .some((part) => part?.toLocaleLowerCase().includes(needle));
    }).sort((a, b) => {
      const order: Record<DeviceSeverity, number> = { critical: 0, warning: 1, unknown: 2, healthy: 3 };
      return order[severity(a)] - order[severity(b)] || (b.issueCount ?? 0) - (a.issueCount ?? 0) || (a.healthScore ?? 11) - (b.healthScore ?? 11) || a.name.localeCompare(b.name);
    });
  }, [data.devices, deviceFilter, deviceSearch, selectedSite]);
  const overallTone = percentTone(data.overallScore);
  const clientTone = percentTone(clientScore);
  const networkCount = data.deviceError && !data.devices.length ? "N/A" : count(data.deviceCount ?? data.totalDevices ?? data.devices.length);
  const issueCount = data.deviceError && !attention.length ? "N/A" : `${data.devicesTruncated ? "≥" : ""}${attention.length}`;
  const emptyDeviceTitle = data.deviceError && deviceFilter === "issues"
    ? "Issue status unavailable"
    : data.devicesTruncated
      ? "No matching devices in the loaded records"
      : deviceFilter === "issues" ? "No issues reported" : "No matching devices";
  const emptyDeviceMessage = data.deviceError && deviceFilter === "issues"
    ? "Catalyst Center did not return device health. Select All to review the available inventory records."
    : data.devicesTruncated
      ? "This result is limited to the devices returned by Catalyst Center."
      : deviceSearch ? "Try a different device, IP, site, or serial number." : "Catalyst Center reports no devices in this view.";
  const siteMatches = (path: string) => data.devices.filter((device) => isInSite(device.siteHierarchy, path));

  useEffect(() => {
    setExpandedSites(new Set(siteTree.filter((node) => node.depth === 0).map((node) => node.path)));
  }, [siteTree]);

  useEffect(() => {
    if (!selectedDevice?.id) return;
    let cancelled = false;
    setDeviceDetail(null);
    setDeviceDetailError("");
    setDeviceDetailLoading(true);
    getDnacDeviceDetail(settings, selectedDevice.id)
      .then((detail) => { if (!cancelled) setDeviceDetail(detail); })
      .catch((error) => { if (!cancelled) setDeviceDetailError(String(error)); })
      .finally(() => { if (!cancelled) setDeviceDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDevice?.id, settings]);

  const setFilter = (filter: DeviceFilter) => {
    setDeviceFilter(filter);
    setShowAllDevices(filter !== "issues");
    document.getElementById("network-attention")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const siteDeviceCount = (node: SiteNode) => siteMatches(node.path).length;
  const siteIssueCount = (node: SiteNode) => siteMatches(node.path).filter((device) => ["critical", "warning"].includes(severity(device))).length;
  const deviceRows = showAllDevices ? filteredDevices : filteredDevices.slice(0, 12);
  const switchHostFor = (device: DnacHealthDevice) => switchHosts.find((host) =>
    kindOf(device) === "switch" && device.managementIp && host.address.trim().toLocaleLowerCase() === device.managementIp.toLocaleLowerCase() && (host.protocol ?? "ssh") === "ssh" && !host.demoProfile,
  );

  return <>
    <div className="network-health-metrics">
      <MetricCard label="Overall health" value={score(data.overallScore)} detail={overallTone === "good" ? "Healthy" : overallTone === "warning" ? "Needs review" : overallTone === "bad" ? "Critical" : "No score reported"} tone={overallTone} icon={Activity} />
      <MetricCard label="Network devices" value={networkCount} detail={data.deviceError ? "Health data unavailable" : `${data.devicesTruncated ? "≥" : ""}${reachableCount} reachable`} tone={data.deviceError ? "unknown" : "neutral"} icon={Server} onClick={() => setFilter("all")} />
      <MetricCard label="Client health" value={score(clientScore)} detail={clientCount ? `${clientCount.toLocaleString()} clients · wired and wireless` : "No client score reported"} tone={clientTone} icon={Users} />
      <MetricCard label="Switches" value={`${data.devicesTruncated ? "≥" : ""}${switches.length}`} detail={data.deviceError ? "Health N/A" : `${countHealth(data, switches)} healthy`} tone="neutral" icon={Network} onClick={() => setFilter("switch")} />
      <MetricCard label="Access points" value={`${data.devicesTruncated ? "≥" : ""}${accessPoints.length}`} detail={data.deviceError ? "Health N/A" : `${countHealth(data, accessPoints)} healthy`} tone="neutral" icon={Wifi} onClick={() => setFilter("access-point")} />
      <MetricCard label="Issues" value={issueCount} detail={data.deviceError ? "Device health unavailable" : attention.length ? "Devices need review" : data.devicesTruncated ? "Partial device inventory" : "No attention items"} tone={attention.some((device) => severity(device) === "critical") ? "bad" : attention.length ? "warning" : data.deviceError ? "unknown" : "good"} icon={AlertTriangle} onClick={() => setFilter("issues")} />
    </div>

    {data.deviceError && <div className="network-section-warning"><AlertTriangle size={14} />Device health could not be loaded: {data.deviceError}. Inventory records remain available where returned, but health and issue status cannot be confirmed.</div>}
    {data.inventoryError && !data.deviceError && <div className="network-section-note"><ShieldCheck size={14} />Device details are available, but Catalyst Center inventory enrichment failed. Model, serial number, or uptime may be N/A.</div>}
    {data.devicesTruncated && <div className="network-section-warning"><AlertTriangle size={14} />Catalyst Center returned {data.devices.length.toLocaleString()} of {count(data.deviceCount)} devices in the available query window. Counts marked ≥ are minimums.</div>}

    <section className="network-attention-panel panel" id="network-attention">
      <div className="network-section-heading attention-heading"><span className="network-section-icon alert"><AlertTriangle size={17} /></span><div><span className="eyebrow">Triage</span><h3>Attention required</h3><p>{data.deviceError ? "Device status could not be retrieved." : attention.length ? `${issueCount} devices are degraded, unreachable, or reporting issues.` : data.devicesTruncated ? "No issues in the loaded devices; the full inventory could not be confirmed." : "No devices currently require attention."}</p></div><span className={`attention-count ${attention.length ? "active" : ""}`}>{issueCount}</span></div>
      <div className="network-device-controls">
        <div className="network-device-filters" role="group" aria-label="Filter network devices">
          {(["all", "switch", "router", "access-point", "issues"] as DeviceFilter[]).map((filter) => <button key={filter} className={deviceFilter === filter ? "active" : ""} onClick={() => { setDeviceFilter(filter); setShowAllDevices(filter !== "issues"); }}>{filter === "all" ? "All" : filter === "switch" ? "Switches" : filter === "router" ? "Routers" : filter === "access-point" ? "Access points" : "Issues only"}</button>)}
        </div>
        <label className="network-device-search"><Search size={14} /><input value={deviceSearch} onChange={(event) => { setDeviceSearch(event.target.value); setShowAllDevices(true); }} placeholder="Search device, IP, site or serial…" />{deviceSearch && <button type="button" aria-label="Clear device search" onClick={() => setDeviceSearch("")}><X size={13} /></button>}</label>
      </div>
      {selectedSite && <div className="network-site-filter-chip">Filtered to {selectedSite}<button onClick={() => setSelectedSite(null)}><X size={12} /> Clear site</button></div>}
      {data.deviceError && !data.devices.length ? <div className="network-table-empty"><AlertTriangle size={20} /><strong>Device list unavailable</strong><span>Check the DNAC account permissions for Device Health and Device Inventory, then refresh.</span></div>
        : filteredDevices.length === 0 ? <div className={`network-table-empty ${data.deviceError || data.devicesTruncated ? "" : "clear"}`}>{data.deviceError || data.devicesTruncated ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}<strong>{emptyDeviceTitle}</strong><span>{emptyDeviceMessage}</span></div>
        : <div className="network-device-table-wrap"><table className="network-device-table"><thead><tr><th>Severity</th><th>Device</th><th>Site</th><th>Device type</th><th>Management IP</th><th>Health</th><th>Problem</th></tr></thead><tbody>{deviceRows.map((device) => <tr key={device.id ?? `${device.name}-${device.managementIp}`} className={`device-row ${severity(device)}`} onClick={() => setSelectedDevice(device)} onDoubleClick={() => setSelectedDevice(device)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedDevice(device); }}><td><SeverityBadge value={severity(device)} /></td><td><strong>{device.name}</strong><small>{device.model ?? device.deviceFamily ?? "Device model unavailable"}</small></td><td>{device.siteHierarchy?.replace(/^Global\//i, "") ?? "N/A"}</td><td>{kindLabel(kindOf(device))}</td><td><code>{device.managementIp ?? "N/A"}</code></td><td>{score(device.healthScore, 10)}</td><td>{["critical", "warning"].includes(severity(device)) ? problem(device) : severity(device) === "unknown" ? "Health unknown" : "—"}</td></tr>)}</tbody></table></div>}
      {!data.deviceError && filteredDevices.length > 12 && <button className="network-show-all" onClick={() => setShowAllDevices((show) => !show)}>{showAllDevices ? "Show fewer devices" : `Show all ${filteredDevices.length.toLocaleString()} devices`}</button>}
      <div className="network-table-foot"><ShieldCheck size={13} />Selecting a device opens its Catalyst Center detail. No device configuration is changed.</div>
    </section>

    <div className="network-health-lower-grid">
      <section className="panel network-site-panel">
        <div className="network-section-heading"><span className="network-section-icon"><MapPin size={17} /></span><div><span className="eyebrow">Location breakdown</span><h3>Site health</h3><p>Expand the hierarchy; select a site name to filter devices.</p></div><span className="network-small-count">{count(data.sites.length)} health records</span></div>
        <label className="network-site-search"><Search size={14} /><input value={siteSearch} onChange={(event) => setSiteSearch(event.target.value)} placeholder="Search sites, buildings or floors…" />{siteSearch && <button aria-label="Clear site search" onClick={() => setSiteSearch("")}><X size={13} /></button>}</label>
        {data.siteError && <div className="network-section-warning"><AlertTriangle size={14} />Site health is unavailable: {data.siteError}</div>}
        {selectedSite && <div className="network-site-filter-chip">Devices filtered to {selectedSite}<button onClick={() => setSelectedSite(null)}><X size={12} /> Clear</button></div>}
        {visibleSites.length === 0 ? <div className="network-site-empty">{siteSearch ? "No matching site names." : data.siteError ? "Site hierarchy is unavailable." : "No site hierarchy was reported."}</div> : <div className="network-site-tree">{visibleSites.map((node) => {
          const nodeDevices = siteDeviceCount(node);
          const nodeIssues = siteIssueCount(node);
          const selected = selectedSite === node.path;
          return <div className={`network-site-tree-row ${selected ? "selected" : ""}`} key={node.path} style={{ "--site-depth": node.depth } as CSSProperties}>
            <button className="site-expand" aria-label={`${expandedSites.has(node.path) ? "Collapse" : "Expand"} ${node.name}`} onClick={() => setExpandedSites((expanded) => { const next = new Set(expanded); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next; })} disabled={!node.children.length}>{node.children.length ? expandedSites.has(node.path) || siteSearch ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span />}</button>
            <button className="site-name-button" onClick={() => { setSelectedSite((current) => current === node.path ? null : node.path); setDeviceFilter("all"); setShowAllDevices(true); }}>{node.name}</button>
            <span className={`network-site-health ${percentTone(node.health)}`}>{score(node.health)}</span>
            <span className="network-site-device-count">{data.deviceError ? "N/A" : data.devicesTruncated ? `≥${nodeDevices}` : count(nodeDevices)}</span>
            <span className={`network-site-issue-count ${nodeIssues ? "warning" : ""}`}>{data.deviceError ? "N/A" : data.devicesTruncated ? `≥${nodeIssues}` : count(nodeIssues)}</span>
          </div>;
        })}</div>}
        <div className="network-site-tree-legend"><span>Health</span><span>Devices</span><span>Issues</span></div>
      </section>

      <section className="panel network-client-panel">
        <div className="network-section-heading"><span className="network-section-icon"><Users size={17} /></span><div><span className="eyebrow">Assurance</span><h3>Client health</h3><p>Wired and wireless client health reported by DNAC.</p></div></div>
        {data.clientError && <div className="network-section-warning"><AlertTriangle size={14} />Client health is unavailable: {data.clientError}</div>}
        {!data.clientError && data.clientHealth.length === 0 && <div className="network-site-empty">No client health data was reported.</div>}
        <div className="network-client-groups">{data.clientHealth.map((row) => <ClientHealthGroup key={row.category} row={row} />)}</div>
        {data.categories.length > 0 && <div className="network-category-breakdown"><strong>Infrastructure health by category</strong>{data.categories.map((category) => <div key={category.category}><span>{category.category}</span><i><b style={{ width: `${Math.max(0, Math.min(100, category.healthScore ?? 0))}%` }} /></i><em>{score(category.healthScore)}</em></div>)}</div>}
      </section>
    </div>
    <div className="network-health-updated"><Clock3 size={13} />Catalyst Center data retrieved {new Date(data.retrievedAt).toLocaleString()}<span>Health interpretation follows Catalyst Center scores; unavailable fields are not inferred.</span></div>
    {selectedDevice && <DeviceDetailDialog device={selectedDevice} switchHost={switchHostFor(selectedDevice)} detail={deviceDetail} loading={deviceDetailLoading} error={deviceDetailError} onClose={() => setSelectedDevice(null)} onOpenSwitchAudit={onOpenSwitchAudit} />}
  </>;
}

function ClientHealthGroup({ row }: { row: DnacClientHealth }) {
  const isWireless = row.category.toLowerCase().includes("wireless");
  return <article className="network-client-group"><div><span className="network-client-type">{isWireless ? <Wifi size={15} /> : <Network size={15} />}</span><span><strong>{row.category}</strong><small>{count(row.clientCount)} clients</small></span><b className={percentTone(row.healthScore)}>{score(row.healthScore)}</b></div>{row.scores.length > 0 && <section>{row.scores.map((item) => <span key={item.category}>{item.category}<b>{count(item.clientCount)}</b></span>)}</section>}</article>;
}

function DeviceDetailDialog({ device, switchHost, detail, loading, error, onClose, onOpenSwitchAudit }: { device: DnacHealthDevice; switchHost?: Host; detail: DnacDeviceDetail | null; loading: boolean; error: string; onClose: () => void; onOpenSwitchAudit: (host: Host) => void }) {
  const values = { ...device, ...(detail ?? {}) };
  const deviceKind = kindOf(device);
  const fields: [string, string | null | undefined][] = [
    ["Hostname", values.name], ["Device family/type", [values.deviceFamily, values.deviceType].filter(Boolean).join(" · ")],
    ["Model", values.model], ["Management IP", values.managementIp], ["Site", values.siteHierarchy],
    ["Software", values.softwareVersion], ["Serial number", values.serialNumber], ["Reachability", values.reachability],
    ["Health score", values.healthScore == null ? undefined : `${values.healthScore}/10`], ["Reported issues", device.issueCount == null ? undefined : String(device.issueCount)],
    ["Uptime", values.uptime],
  ];
  if (deviceKind === "access-point") fields.push(["Associated clients", values.clientCount == null ? undefined : String(values.clientCount)]);
  return <div className="modal-backdrop network-device-backdrop" onMouseDown={onClose}><section className="network-device-detail" role="dialog" aria-modal="true" aria-labelledby="network-device-title" onMouseDown={(event) => event.stopPropagation()}>
    <header><span className="network-detail-device-icon">{deviceKind === "access-point" ? <Wifi size={20} /> : deviceKind === "router" ? <Router size={20} /> : <Network size={20} />}</span><div><span className="eyebrow">Catalyst Center device</span><h3 id="network-device-title">{device.name}</h3><small>{device.model ?? device.deviceFamily ?? kindLabel(deviceKind)}</small></div><button aria-label="Close device details" onClick={onClose}><X size={17} /></button></header>
    <div className="network-detail-status"><SeverityBadge value={severity(device)} /><span className={`network-detail-score ${severity(device)}`}>{score(device.healthScore, 10)}</span><span>{reachability(device) === "unknown" ? "Reachability N/A" : reachability(device) === "reachable" ? "Reachable" : reachability(device) === "partial" ? "Ping reachable only" : "Unreachable"}</span></div>
    {loading && <div className="network-detail-loading"><Activity size={14} className="spin" />Loading available device details…</div>}
    {error && <div className="network-detail-note"><AlertTriangle size={13} />Additional detail could not be loaded. Showing values from the health summary.</div>}
    <div className="network-detail-fields">{fields.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "N/A"}</strong></div>)}</div>
    <div className="network-detail-interfaces"><Network size={14} /><span>Interface summary</span><strong>N/A</strong><small>This device-detail response does not include interface up/down counts.</small></div>
    {deviceKind === "switch" && <div className="network-detail-actions">{switchHost ? <><button className="primary-button" onClick={() => onOpenSwitchAudit(switchHost)}><ExternalSwitchIcon /> Open in Switch audit</button><small>Opens the existing read-only audit. SSH will not start until you run it there.</small></> : <small>Add this switch to Inventory and assign a credential profile before using the SSH-based Switch audit.</small>}</div>}
    <footer><ShieldCheck size={13} />Read-only DNAC details. This view does not change device configuration.</footer>
  </section></div>;
}

function ExternalSwitchIcon() {
  return <Router size={14} />;
}

export function NetworkHealth({ settings, connectionState, onConnectionStateChange, onOpenSettings, switchHosts, onOpenSwitchAudit }: NetworkHealthProps) {
  const [data, setData] = useState<DnacNetworkHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configured = Boolean(settings.serverUrl.trim() && settings.username.trim());
  const statusLabel = connectionState === "not-configured" && configured ? "DNAC configured" : connectionStateLabel(connectionState);
  const refresh = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    setError("");
    onConnectionStateChange("connecting");
    try {
      const result = await getDnacNetworkHealth(settings);
      setData(result);
      onConnectionStateChange("connected");
    } catch (caught) {
      setError(String(caught));
      onConnectionStateChange("error");
    } finally {
      setLoading(false);
    }
  }, [configured, onConnectionStateChange, settings]);

  useEffect(() => {
    if (configured) void refresh();
  }, [configured, refresh]);

  return <div className="page network-health-page">
    <div className="page-intro network-health-heading"><div><span className="eyebrow"><Activity size={13} /> Catalyst Center assurance</span><h2>Network health</h2><p>See what needs attention, where it is, and which device to investigate.</p></div><div className="network-health-actions"><button className={`dnac-status ${connectionState}`} onClick={onOpenSettings}><i />{statusLabel}<Settings size={13} /></button><button className="secondary-button network-refresh" onClick={() => void refresh()} disabled={!configured || loading}><RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "Refreshing…" : "Refresh"}</button></div></div>
    {!configured && <section className="panel network-health-setup"><KeyRound size={20} /><div><strong>Connect Catalyst Center to see network health</strong><p>Network Health uses the same DNAC connection and operating-system vault as Client Search.</p></div><button className="secondary-button" onClick={onOpenSettings}>Open DNAC settings</button></section>}
    {error && <div className="diagnostic-error network-health-error">{error}{data && <small> Showing the previous snapshot from {new Date(data.retrievedAt).toLocaleString()}.</small>}</div>}
    {loading && !data && <section className="panel network-health-loading"><Activity size={24} className="spin" /><strong>Checking network health…</strong><span>Reading Catalyst Center device, site, and client assurance summaries.</span></section>}
    {data && <NetworkHealthDashboard data={data} settings={settings} switchHosts={switchHosts} onOpenSwitchAudit={onOpenSwitchAudit} />}
    {!data && configured && !loading && !error && <section className="panel network-health-loading"><Activity size={24} /><strong>Ready to check the network</strong><span>Refresh to retrieve the latest read-only assurance data.</span></section>}
  </div>;
}
