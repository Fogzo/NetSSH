import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, Check, CircleAlert, LockKeyhole, Network, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { hasCredentialPassword, saveCredentialPassword } from "./credentials";
import { discoverSshDevice, type DiscoveredSshDevice } from "./ssh";
import type { CredentialProfile, Host } from "./types";

type ScanRow = {
  target: string;
  state: "pending" | "scanning" | "success" | "error";
  device?: DiscoveredSshDevice;
  error?: string;
  selected: boolean;
  existing?: boolean;
};

type DeviceDiscoveryProps = {
  credentialProfiles: CredentialProfile[];
  configuredSites: string[];
  existingHosts: Host[];
  onClose: () => void;
  onImport: (hosts: Host[]) => { added: number; duplicates: number; updated?: number };
};

function parseIpv4(value: string): number | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

export function expandAddressRange(input: string): string[] {
  const value = input.trim();
  if (!value) throw new Error("Enter an IPv4 range or CIDR block");
  if (value.includes("/")) {
    const [address, prefixText, ...extra] = value.split("/");
    if (extra.length || !/^(?:\d|[12]\d|3[0-2])$/.test(prefixText ?? "")) throw new Error("Use a valid IPv4 CIDR, for example 10.24.10.0/24");
    const ip = parseIpv4(address);
    if (ip === null) throw new Error("Use a valid IPv4 CIDR, for example 10.24.10.0/24");
    const prefix = Number(prefixText);
    const hostBits = 32 - prefix;
    const size = 2 ** hostBits;
    if (size > 256) throw new Error("For safety, a discovery scan is limited to 256 addresses");
    const mask = prefix === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
    const network = (ip & mask) >>> 0;
    return Array.from({ length: size }, (_, index) => formatIpv4((network + index) >>> 0));
  }
  if (value.includes("-")) {
    const [startText, endText, ...extra] = value.split("-").map((part) => part.trim());
    if (extra.length || !startText || !endText) throw new Error("Use a range such as 10.24.10.10-30 or 10.24.10.10-10.24.10.30");
    const start = parseIpv4(startText);
    const end = /^\d{1,3}$/.test(endText) ? parseIpv4(`${startText.split(".").slice(0, 3).join(".")}.${endText}`) : parseIpv4(endText);
    if (start === null || end === null || end < start) throw new Error("The range must contain valid IPv4 addresses in ascending order");
    if (end - start + 1 > 256) throw new Error("For safety, a discovery scan is limited to 256 addresses");
    return Array.from({ length: end - start + 1 }, (_, index) => formatIpv4((start + index) >>> 0));
  }
  if (parseIpv4(value) === null) throw new Error("Use a valid IPv4 address, range, or CIDR block");
  return [value];
}

function cleanError(error: unknown) {
  return String(error).replace(/^Error:\s*/, "");
}

export function DeviceDiscoveryModal({ credentialProfiles, configuredSites, existingHosts, onClose, onImport }: DeviceDiscoveryProps) {
  const [range, setRange] = useState("");
  const [port, setPort] = useState("22");
  const [credentialId, setCredentialId] = useState(credentialProfiles[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<"checking" | "stored" | "missing" | "unavailable">("checking");
  const [site, setSite] = useState(configuredSites[0] ?? "");
  const [tags, setTags] = useState("discovered");
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const selectedCredential = credentialProfiles.find((credential) => credential.id === credentialId);
  const existingKeys = useMemo(() => new Set(existingHosts.filter((host) => (host.protocol ?? "ssh") === "ssh").map((host) => `${host.address.toLowerCase()}:${host.port ?? 22}`)), [existingHosts]);
  const completed = rows.filter((row) => row.state === "success" || row.state === "error").length;
  const successful = rows.filter((row) => row.state === "success" && row.device);
  const selectedCount = successful.filter((row) => row.selected).length;
  const targetHint = useMemo(() => {
    if (!range.trim()) return "Examples: 10.24.10.0/24 · 10.24.10.10-30 · 10.24.10.10-10.24.10.30";
    try { return `${expandAddressRange(range).length} address${expandAddressRange(range).length === 1 ? "" : "es"} queued`; }
    catch { return "Up to 256 IPv4 addresses per scan"; }
  }, [range]);

  useEffect(() => {
    setPassword("");
    setPasswordRequired(false);
    if (!credentialId) {
      setVaultStatus("missing");
      return;
    }
    setVaultStatus("checking");
    void hasCredentialPassword(credentialId)
      .then((stored) => setVaultStatus(stored ? "stored" : "missing"))
      .catch(() => setVaultStatus("unavailable"));
  }, [credentialId]);

  const updateRow = (target: string, update: Partial<ScanRow>) => {
    setRows((current) => current.map((row) => row.target === target ? { ...row, ...update } : row));
  };

  const scan = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSummary("");
    if (!selectedCredential) { setError("Select a saved login profile from Credentials first."); return; }
    if (!site.trim()) { setError("Enter the site where discovered devices should be added."); return; }
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) { setError("Port must be between 1 and 65535."); return; }
    let targets: string[];
    try { targets = expandAddressRange(range); }
    catch (caught) { setError(cleanError(caught)); return; }
    if (password && savePassword) {
      try {
        await saveCredentialPassword(selectedCredential.id, password);
        setVaultStatus("stored");
      } catch (caught) {
        setError(cleanError(caught));
        return;
      }
    }
    const scanPassword = password || undefined;
    const initialRows = targets.map((target) => ({ target, state: "pending" as const, selected: !existingKeys.has(`${target.toLowerCase()}:${numericPort}`), existing: existingKeys.has(`${target.toLowerCase()}:${numericPort}`) }));
    setRows(initialRows);
    setScanning(true);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= targets.length) return;
        const target = targets[index];
        updateRow(target, { state: "scanning" });
        try {
          const device = await discoverSshDevice(target, numericPort, selectedCredential.id, selectedCredential.username, scanPassword);
          updateRow(target, { state: "success", device });
        } catch (caught) {
          const message = cleanError(caught);
          if (/no stored password/i.test(message)) {
            setPasswordRequired(true);
            setVaultStatus("missing");
            setError(`The selected login password could not be read. Enter it below and scan again, or save it in Credentials.`);
          }
          updateRow(target, { state: "error", error: message, selected: false });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, targets.length) }, () => worker()));
    setScanning(false);
    setSummary("Scan complete. Review the identified devices, then add the selected results to inventory.");
  };

  const importDevices = () => {
    const numericPort = Number(port);
    const deviceTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const hosts = successful.filter((row) => row.selected && row.device).map((row) => {
      const device = row.device!;
      const hostname = device.hostname ?? device.address;
      return {
        id: `discovered-${device.address.replaceAll(".", "-")}-${numericPort}`,
        name: hostname,
        address: device.address,
        platform: device.platform ?? "Other",
        site: site.trim(),
        deviceRole: "other" as const,
        status: "online" as const,
        latency: device.elapsedMs,
        favorite: false,
        port: numericPort,
        username: selectedCredential?.username,
        credentialId: selectedCredential?.id,
        tags: [...new Set(deviceTags)],
        notes: `Identified by read-only SSH discovery on ${new Date().toLocaleDateString()}. Host key: ${device.fingerprint ?? "not returned"}`,
        protocol: "ssh" as const,
      } satisfies Host;
    });
    if (!hosts.length) { setError("Select at least one successfully identified device."); return; }
    const result = onImport(hosts);
    setSummary(`${result.added} device${result.added === 1 ? "" : "s"} added${result.updated ? ` · ${result.updated} existing device${result.updated === 1 ? "" : "s"} updated` : ""}${result.duplicates ? ` · ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""}.`);
  };

  return <div className="modal-backdrop device-discovery-backdrop" onMouseDown={onClose}>
    <section className="device-discovery-modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="provider-modal-head"><div><span><Network size={18} /></span><div><h3>Discover devices by range</h3><p>Identify network devices over SSH and add them to inventory.</p></div></div><button onClick={onClose} aria-label="Close discovery"><X size={17} /></button></div>
      <div className="device-discovery-body">
        <form className="device-discovery-form" onSubmit={scan}>
          <label className="wide-field"><span>IPv4 range or CIDR *</span><input autoFocus value={range} onChange={(event) => setRange(event.target.value)} placeholder="10.24.10.0/24" /><small>{targetHint}</small></label>
          <label><span>SSH port</span><input inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} /></label>
          <label><span>Saved login *</span><select value={credentialId} onChange={(event) => setCredentialId(event.target.value)} disabled={!credentialProfiles.length}><option value="">{credentialProfiles.length ? "Select a saved login" : "Create a profile in Credentials"}</option>{credentialProfiles.map((credential) => <option value={credential.id} key={credential.id}>{credential.label} · {credential.username}</option>)}</select><small>{vaultStatus === "checking" ? "Checking the operating-system vault…" : vaultStatus === "stored" ? "Login password found in the operating-system vault." : vaultStatus === "unavailable" ? "The operating-system vault could not be checked." : "No login password is stored for this profile yet."}</small></label>
          {selectedCredential && passwordRequired && <div className="discovery-password wide-field"><label><span>Login password for {selectedCredential.label}</span><div className="secret-input"><LockKeyhole size={14} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter password to scan" /></div></label><label className="discovery-save-password"><input type="checkbox" checked={savePassword} onChange={(event) => setSavePassword(event.target.checked)} /><span>Save to the operating-system vault</span></label></div>}
          <label><span>Inventory site *</span><input list="discovery-sites" value={site} onChange={(event) => setSite(event.target.value)} placeholder="London HQ" /><datalist id="discovery-sites">{configuredSites.map((value) => <option value={value} key={value} />)}</datalist></label>
          <label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="discovered, access" /></label>
          {error && <div className="modal-error wide-field">{error}</div>}
          <div className="discovery-safety wide-field"><ShieldCheck size={15} /><span>{passwordRequired ? "The selected login was tried first; enter a password below if the vault lookup failed." : "The selected login profile will be used from the operating-system vault first."} Discovery uses read-only commands only. Host keys are observed during discovery and will still be checked again when you connect.</span></div>
          <div className="modal-actions wide-field"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={scanning || !credentialProfiles.length}>{scanning ? <><RefreshCw size={15} className="spin" /> Scanning…</> : <><Activity size={15} /> Scan range</>}</button></div>
        </form>
        {rows.length > 0 && <section className="discovery-results"><div className="discovery-results-head"><div><strong>Discovery results</strong><span>{completed} of {rows.length} checked · {successful.length} identified</span></div>{scanning && <RefreshCw size={15} className="spin" />}</div><div className="discovery-result-list">{rows.map((row) => <div className={`discovery-result-row ${row.state}`} key={row.target}><span className="discovery-result-icon">{row.state === "success" ? <Check size={14} /> : row.state === "error" ? <CircleAlert size={14} /> : <RefreshCw size={14} className={row.state === "scanning" ? "spin" : ""} />}</span><div><strong>{row.device?.hostname ?? row.target}</strong><small>{row.target}{row.device?.platform ? ` · ${row.device.platform}` : row.error ? ` · ${row.error}` : row.existing ? " · Already in inventory" : " · Checking SSH and read-only identity commands…"}</small></div>{row.state === "success" && <label className="discovery-select"><input type="checkbox" checked={row.selected} onChange={() => updateRow(row.target, { selected: !row.selected })} /> {row.existing ? "Review" : "Add"}</label>}</div>)}</div><div className="discovery-results-foot"><span>{selectedCount} selected for inventory</span><button className="primary-button" disabled={scanning || !selectedCount} onClick={importDevices}><Plus size={15} /> Add selected devices</button></div></section>}
        {summary && <div className="discovery-summary">{summary}</div>}
      </div>
    </section>
  </div>;
}
