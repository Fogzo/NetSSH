import { FormEvent, useState } from "react";
import { Activity, Clock3, KeyRound, MapPin, MonitorSmartphone, Network, Router, Search, Server, Settings, ShieldCheck, UserRound, Wifi } from "lucide-react";
import { connectionStateLabel, searchDnacClient, type DnacClient, type DnacConnectionState, type DnacSettings } from "./dnac";

type ClientSearchProps = {
  settings: DnacSettings;
  connectionState: DnacConnectionState;
  onConnectionStateChange: (state: DnacConnectionState) => void;
  onOpenSettings: () => void;
};

function DisplayField({ label, value }: { label: string; value?: string | number }) {
  return <div className="dnac-field"><span>{label}</span><strong>{value ?? "Not reported"}</strong></div>;
}

function formatUpdated(timestamp?: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? undefined : date.toLocaleString();
}

export function ClientSearch({ settings, connectionState, onConnectionStateChange, onOpenSettings }: ClientSearchProps) {
  const [macAddress, setMacAddress] = useState("");
  const [client, setClient] = useState<DnacClient | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const configured = Boolean(settings.serverUrl && settings.username);
  const statusLabel = connectionState === "not-configured" && configured ? "DNAC configured" : connectionStateLabel(connectionState);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!configured) { setError("Configure Cisco Catalyst Center in Settings before searching."); return; }
    setSearching(true); setError(""); setClient(null); onConnectionStateChange("connecting");
    try {
      const result = await searchDnacClient(settings, macAddress);
      setClient(result);
      onConnectionStateChange("connected");
    } catch (caught) {
      setError(String(caught));
      onConnectionStateChange("error");
    } finally {
      setSearching(false);
    }
  };

  const wireless = client?.connectionType?.toLowerCase().includes("wireless");
  const healthTone = client?.healthScore == null ? "unknown" : client.healthScore >= 8 ? "good" : client.healthScore >= 5 ? "warning" : "bad";

  return <div className="page client-search-page">
    <div className="page-intro client-search-heading"><div><span className="eyebrow"><Search size={13} /> Catalyst Center assurance</span><h2>Client search</h2><p>Find a wired or wireless network client by MAC address.</p></div><button className={`dnac-status ${connectionState}`} onClick={onOpenSettings}><i />{statusLabel}<Settings size={13} /></button></div>
    <section className="panel client-search-panel">
      <div className="client-search-hero"><span><MonitorSmartphone size={24} /></span><div><h3>Find a network client</h3><p>Catalyst Center returns the latest identity, health, connection, and network-location data it has collected.</p></div></div>
      <form className="client-search-form" onSubmit={search}><label><span>Client MAC address</span><div><Search size={17} /><input autoFocus value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" autoComplete="off" spellCheck={false} /></div></label><button className="primary-button" disabled={searching || !macAddress.trim()}>{searching ? <><Activity className="spin" size={15} /> Searching…</> : <><Search size={15} /> Search DNAC</>}</button></form>
      {!configured && <div className="dnac-setup-callout"><KeyRound size={18} /><div><strong>Connect Catalyst Center first</strong><p>Add the server and your DNAC credentials. Passwords are kept in the operating-system vault.</p></div><button className="secondary-button" onClick={onOpenSettings}>Open DNAC settings</button></div>}
      {error && <div className="diagnostic-error dnac-search-error">{error}</div>}
      {!client && configured && !error && !searching && <div className="client-search-empty"><Network size={30} /><strong>Ready for a MAC-address search</strong><span>Cisco Spaces is not used in this release.</span></div>}
      {client && <div className="client-result">
        <div className="client-result-title"><span className="client-device-icon">{wireless ? <Wifi size={22} /> : <MonitorSmartphone size={22} />}</span><div><span>{client.deviceType ?? "Network client"}</span><h3>{client.hostname ?? client.userId ?? client.macAddress}</h3><p>{client.macAddress}{client.ipAddress ? ` · ${client.ipAddress}` : ""}</p></div><span className={`client-health ${healthTone}`}><i />{client.healthScore == null ? "Health unavailable" : `Health ${client.healthScore}/10`}</span></div>
        <div className="client-result-grid">
          <section><div className="client-card-heading"><MonitorSmartphone size={17} /><div><strong>Client identity</strong><small>Details reported by Catalyst Center</small></div></div><div className="dnac-fields"><DisplayField label="Hostname" value={client.hostname} /><DisplayField label="IPv4 address" value={client.ipAddress} /><DisplayField label="MAC address" value={client.macAddress} /><DisplayField label="Username" value={client.userId} /><DisplayField label="Operating system" value={client.operatingSystem} /><DisplayField label="Vendor" value={client.vendor} /></div></section>
          <section><div className="client-card-heading"><Activity size={17} /><div><strong>Connection</strong><small>Current assurance state</small></div></div><div className="dnac-fields"><DisplayField label="Status" value={client.connectionStatus} /><DisplayField label="Connection type" value={client.connectionType} /><DisplayField label="Health reason" value={client.healthReason} /><DisplayField label="VLAN" value={client.vlanId} />{wireless && <><DisplayField label="SSID" value={client.ssid} /><DisplayField label="Radio" value={[client.frequency, client.channel && `Channel ${client.channel}`].filter(Boolean).join(" · ") || undefined} /></>}</div></section>
          <section className="client-location-card"><div className="client-card-heading"><MapPin size={17} /><div><strong>Network location</strong><small>{client.location ?? "Location hierarchy was not reported"}</small></div></div><div className="dnac-location"><div><MapPin size={16} /><span><small>Site</small><strong>{client.site ?? "Not reported"}</strong></span></div><div><Server size={16} /><span><small>Building</small><strong>{client.building ?? "Not reported"}</strong></span></div><div><Network size={16} /><span><small>Floor</small><strong>{client.floor ?? "Not reported"}</strong></span></div></div></section>
          <section className="client-access-card"><div className="client-card-heading">{wireless ? <Wifi size={17} /> : <Router size={17} />}<div><strong>{wireless ? "Wireless attachment" : "Wired attachment"}</strong><small>{wireless ? "Connected access point" : "Connected switch and interface"}</small></div></div><div className="dnac-fields"><DisplayField label={wireless ? "Access point" : "Switch"} value={client.connectedDevice} /><DisplayField label="Management IP" value={client.connectedDeviceIp} />{!wireless && <DisplayField label="Interface" value={client.interfaceName} />}</div></section>
        </div>
        <div className="client-result-footer"><ShieldCheck size={14} /><span>Read-only data from Cisco Catalyst Center</span>{client.userId && <><UserRound size={14} /><span>{client.userId}</span></>}{formatUpdated(client.lastUpdated) && <><Clock3 size={14} /><span>Updated {formatUpdated(client.lastUpdated)}</span></>}</div>
      </div>}
    </section>
  </div>;
}
