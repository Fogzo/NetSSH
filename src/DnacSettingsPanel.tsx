import { useEffect, useState } from "react";
import { Activity, Check, Eye, EyeOff, LockKeyhole, Server, ShieldAlert, ShieldCheck } from "lucide-react";
import { hasDnacPassword, testDnacConnection, type DnacConnectionState, type DnacSettings } from "./dnac";

type DnacSettingsPanelProps = {
  settings: DnacSettings;
  password: string;
  connectionState: DnacConnectionState;
  onChange: (settings: DnacSettings) => void;
  onPasswordChange: (password: string) => void;
  onConnectionStateChange: (state: DnacConnectionState) => void;
};

export function DnacSettingsPanel({ settings, password, connectionState, onChange, onPasswordChange, onConnectionStateChange }: DnacSettingsPanelProps) {
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { hasDnacPassword().then(setPasswordSaved).catch(() => setPasswordSaved(false)); }, []);

  const test = async () => {
    setMessage(""); setError(""); onConnectionStateChange("connecting");
    try {
      const result = await testDnacConnection(settings, password || undefined);
      setMessage(`Connected successfully to ${result.server}${result.certificateVerification ? " with certificate verification enabled" : " using the self-signed certificate override"}.`);
      onConnectionStateChange("connected");
    } catch (caught) {
      setError(String(caught));
      onConnectionStateChange("error");
    }
  };

  return <div className="dnac-settings-page">
    <div className={`dnac-settings-status ${connectionState}`}><span><i />{connectionState === "connected" ? "Connected" : connectionState === "connecting" ? "Testing connection…" : connectionState === "error" ? "Connection needs attention" : settings.serverUrl ? "Configured — not tested" : "Not configured"}</span><small>Cisco Catalyst Center · Intent API</small></div>
    <div className="dnac-settings-form">
      <label className="wide-field"><span>DNAC server URL</span><div className="dnac-settings-input"><Server size={14} /><input value={settings.serverUrl} onChange={(event) => onChange({ ...settings, serverUrl: event.target.value })} placeholder="https://dnac.company.local" autoComplete="url" /></div></label>
      <label><span>Username</span><div className="dnac-settings-input"><LockKeyhole size={14} /><input value={settings.username} onChange={(event) => onChange({ ...settings, username: event.target.value })} placeholder="network-user" autoComplete="username" /></div></label>
      <label><span>Password {passwordSaved && !password && <em>Saved securely</em>}</span><div className="dnac-settings-input"><LockKeyhole size={14} /><input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder={passwordSaved ? "Leave blank to use saved password" : "Enter DNAC password"} autoComplete="current-password" /><button type="button" onClick={() => setPasswordVisible(!passwordVisible)} aria-label={passwordVisible ? "Hide password" : "Show password"}>{passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
    </div>
    <div className="dnac-settings-options">
      <label><span><strong>Remember connection</strong><small>Store the password in Windows Credential Manager or the native OS vault</small></span><input type="checkbox" checked={settings.rememberConnection} onChange={(event) => onChange({ ...settings, rememberConnection: event.target.checked })} /></label>
      <label className={settings.allowInvalidCertificates ? "certificate-warning" : ""}><span><strong>Allow a private or self-signed certificate</strong><small>Use only when your IT team confirms the Catalyst Center certificate is trusted</small></span><input type="checkbox" checked={settings.allowInvalidCertificates} onChange={(event) => onChange({ ...settings, allowInvalidCertificates: event.target.checked })} /></label>
    </div>
    {settings.allowInvalidCertificates && <div className="dnac-certificate-warning"><ShieldAlert size={16} /><span>Certificate verification is disabled for this DNAC connection. HTTPS is still required, but NetSSH cannot verify the server identity.</span></div>}
    {message && <div className="dnac-test-message success"><Check size={15} /><span>{message}</span></div>}
    {error && <div className="dnac-test-message error"><ShieldAlert size={15} /><span>{error}</span></div>}
    <div className="dnac-test-actions"><span><ShieldCheck size={14} /> Tokens stay in memory and are refreshed automatically.</span><button className="secondary-button" type="button" onClick={() => void test()} disabled={connectionState === "connecting" || !settings.serverUrl.trim() || !settings.username.trim() || (!password && !passwordSaved)}>{connectionState === "connecting" ? <><Activity className="spin" size={14} /> Testing…</> : "Test connection"}</button></div>
  </div>;
}
