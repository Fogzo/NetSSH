import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileText, KeyRound, LockKeyhole, MapPin, Network, Plus, Server, ShieldCheck, Sparkles, TerminalSquare, UserRound, X } from "lucide-react";
import { isNativeApp } from "./credentials";
import type { CredentialProfile, Host } from "./types";

export type WelcomeTourProfile = {
  name: string;
  role: string;
  onboardingComplete: boolean;
};

export type WelcomeTourPreferences = {
  sites: string[];
  platforms: string[];
};

export type WelcomeTourResult = {
  profile: WelcomeTourProfile;
  sites: string[];
  platforms: string[];
  credential?: {
    profile: CredentialProfile;
    password: string;
    enablePassword?: string;
  };
  importDemoData: boolean;
};

type WelcomeTourProps = {
  profile: WelcomeTourProfile;
  preferences: WelcomeTourPreferences;
  demoDevices: Host[];
  onClose: () => void;
  onComplete: (result: WelcomeTourResult) => Promise<void>;
};

const suggestedPlatforms = [
  "Cisco IOS",
  "Cisco IOS-XE",
  "Cisco NX-OS",
  "Arista EOS",
  "Juniper JunOS",
  "Palo Alto",
  "Fortinet FortiOS",
  "Linux",
  "Other",
];

const steps = ["Welcome", "Profile", "Vault", "Sites", "Platforms", "Demo data"];

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NE";
  return `${parts[0][0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

export function WelcomeTour({ profile, preferences, demoDevices, onClose, onComplete }: WelcomeTourProps) {
  const nativeVault = isNativeApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role || "Network Engineer");
  const [createVaultLogin, setCreateVaultLogin] = useState(false);
  const [vaultLabel, setVaultLabel] = useState("Network Admin");
  const [vaultUsername, setVaultUsername] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [enablePassword, setEnablePassword] = useState("");
  const [sites, setSites] = useState(() => uniqueValues(preferences.sites));
  const [siteInput, setSiteInput] = useState("");
  const [platforms, setPlatforms] = useState(() => uniqueValues([...suggestedPlatforms, ...preferences.platforms]));
  const [platformInput, setPlatformInput] = useState("");
  const [importDemoData, setImportDemoData] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const addSite = () => {
    const value = siteInput.trim();
    if (!value) return;
    setSites((current) => uniqueValues([...current, value]));
    setSiteInput("");
  };

  const addPlatform = () => {
    const value = platformInput.trim();
    if (!value) return;
    setPlatforms((current) => uniqueValues([...current, value]));
    setPlatformInput("");
  };

  const togglePlatform = (platform: string) => {
    setPlatforms((current) => current.some((value) => value.toLowerCase() === platform.toLowerCase())
      ? current.filter((value) => value.toLowerCase() !== platform.toLowerCase())
      : [...current, platform]);
  };

  const next = () => {
    setError("");
    if (step === 2 && createVaultLogin && nativeVault) {
      if (!vaultLabel.trim() || !vaultUsername.trim() || !vaultPassword) {
        setError("Enter a profile label, username, and password, or leave the vault step switched off.");
        return;
      }
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const complete = async (skipSetup = false) => {
    setError("");
    setSaving(true);
    const cleanSites = uniqueValues(sites);
    const cleanPlatforms = uniqueValues(platforms);
    const result: WelcomeTourResult = {
      profile: { name: name.trim(), role: role.trim() || "Network Engineer", onboardingComplete: true },
      sites: cleanSites.length ? cleanSites : ["Unassigned"],
      platforms: cleanPlatforms.length ? cleanPlatforms : ["Other"],
      importDemoData: skipSetup ? false : importDemoData,
      ...(!skipSetup && createVaultLogin && nativeVault ? {
        credential: {
          profile: { id: `credential-${crypto.randomUUID()}`, label: vaultLabel.trim(), username: vaultUsername.trim() },
          password: vaultPassword,
          enablePassword: enablePassword || undefined,
        },
      } : {}),
    };
    try {
      await onComplete(result);
    } catch (caught) {
      setError(String(caught));
      setSaving(false);
    }
  };

  const renderStep = () => {
    if (step === 0) return <>
      <div className="onboarding-brand"><span><Network size={25} /></span><strong>NetSSH</strong></div>
      <div className="onboarding-intro"><span className="eyebrow"><Sparkles size={13} /> Welcome aboard</span><h2>Set up your network workspace</h2><p>A few optional details make NetSSH feel like your own tool. You can skip any part now and change it later from Settings, Credentials, or Inventory.</p></div>
      <div className="onboarding-features"><div><span><TerminalSquare size={18} /></span><strong>Connect</strong><small>SSH, Telnet, and Serial sessions with tabs and split panes.</small></div><div><span><KeyRound size={18} /></span><strong>Keep logins safe</strong><small>Save reusable credentials in the operating-system vault when you want to.</small></div><div><span><Server size={18} /></span><strong>Organise devices</strong><small>Set sites, platform choices, and optional safe demo devices.</small></div></div>
    </>;

    if (step === 1) return <>
      <div className="onboarding-profile-head"><span className="profile-preview">{profileInitials(name)}</span><div><span className="eyebrow"><UserRound size={13} /> Local profile</span><h2>Make NetSSH yours</h2><p>Your name and role are only used to personalise this local workspace. The name is optional.</p></div></div>
      <div className="onboarding-fields"><label><span>Your name <em>optional</em></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Morgan" autoComplete="name" /></label><label><span>Role or team</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Network Engineer" /></label></div>
      <div className="profile-privacy"><ShieldCheck size={15} /><span>This profile is stored locally and is never included in AI prompts or exported session files.</span></div>
    </>;

    if (step === 2) return <>
      <div className="onboarding-section-heading"><span className="onboarding-section-icon"><LockKeyhole size={20} /></span><div><span className="eyebrow">Optional security setup</span><h2>Create a saved login</h2><p>Use one reusable username and password for several devices. NetSSH stores the secrets in the Windows or macOS credential vault, not in its settings.</p></div></div>
      {!nativeVault ? <div className="onboarding-unavailable"><ShieldCheck size={18} /><div><strong>Desktop vault setup is available in the native app</strong><span>You can skip this step in the browser preview and create the profile later from Credentials.</span></div></div> : <>
        <label className={`onboarding-option ${createVaultLogin ? "selected" : ""}`}><input type="checkbox" checked={createVaultLogin} onChange={(event) => { setCreateVaultLogin(event.target.checked); setError(""); }} /><span><strong>Create a reusable login now</strong><small>You can still connect with one-time credentials whenever you prefer.</small></span></label>
        {createVaultLogin && <div className="onboarding-fields onboarding-vault-fields"><label><span>Profile label</span><input autoFocus value={vaultLabel} onChange={(event) => setVaultLabel(event.target.value)} placeholder="Network Admin" /></label><label><span>Username</span><input value={vaultUsername} onChange={(event) => setVaultUsername(event.target.value)} autoComplete="username" placeholder="netadmin" /></label><label><span>Login password</span><input type="password" value={vaultPassword} onChange={(event) => setVaultPassword(event.target.value)} autoComplete="new-password" placeholder="Device login password" /></label><label><span>Enable password <em>optional</em></span><input type="password" value={enablePassword} onChange={(event) => setEnablePassword(event.target.value)} autoComplete="new-password" placeholder="Privileged EXEC secret" /></label></div>}
      </>}
      <div className="profile-privacy"><ShieldCheck size={15} /><span>Passwords are never written to localStorage or included in exports. They stay in the native operating-system vault.</span></div>
    </>;

    if (step === 3) return <>
      <div className="onboarding-section-heading"><span className="onboarding-section-icon"><MapPin size={20} /></span><div><span className="eyebrow">Inventory organisation</span><h2>Where are your devices?</h2><p>Sites become quick choices when you add or discover devices. You can edit this list later in Settings.</p></div></div>
      <div className="onboarding-chip-list">{sites.map((site) => <span key={site}>{site}<button type="button" aria-label={`Remove ${site}`} onClick={() => setSites((current) => current.filter((value) => value !== site))}><X size={12} /></button></span>)}{!sites.length && <small className="onboarding-empty-list">No sites yet — NetSSH will use “Unassigned” until you add one.</small>}</div>
      <div className="onboarding-add-row"><input value={siteInput} onChange={(event) => setSiteInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSite(); } }} placeholder="London HQ, Manchester branch…" /><button type="button" className="secondary-button" onClick={addSite}><Plus size={14} /> Add site</button></div>
    </>;

    if (step === 4) return <>
      <div className="onboarding-section-heading"><span className="onboarding-section-icon"><Server size={20} /></span><div><span className="eyebrow">Inventory organisation</span><h2>Choose device platforms</h2><p>These choices appear as a dropdown when you add a device. Select the vendors you work with most, then add any custom platform.</p></div></div>
      <div className="onboarding-platform-grid">{suggestedPlatforms.map((platform) => { const selected = platforms.some((value) => value.toLowerCase() === platform.toLowerCase()); return <button type="button" key={platform} className={selected ? "selected" : ""} onClick={() => togglePlatform(platform)}><span>{platform}</span>{selected && <Check size={14} />}</button>; })}</div>
      <div className="onboarding-add-row"><input value={platformInput} onChange={(event) => setPlatformInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPlatform(); } }} placeholder="Add a custom platform" /><button type="button" className="secondary-button" onClick={addPlatform}><Plus size={14} /> Add platform</button></div>
      <div className="profile-privacy"><FileText size={15} /><span>{platforms.length} platform{platforms.length === 1 ? "" : "s"} will be available in the device editor.</span></div>
    </>;

    return <>
      <div className="onboarding-section-heading"><span className="onboarding-section-icon"><Sparkles size={20} /></span><div><span className="eyebrow">Safe practice workspace</span><h2>Try the demo devices?</h2><p>Import two local Cisco simulator profiles so you can explore tabs, terminal output, snippets, topology, and notes without touching a real network.</p></div></div>
      <label className={`onboarding-option ${importDemoData ? "selected" : ""}`}><input type="checkbox" checked={importDemoData} onChange={(event) => setImportDemoData(event.target.checked)} /><span><strong>Import demo data</strong><small>Demo sessions are clearly marked and never open a network connection.</small></span></label>
      <div className="onboarding-demo-list">{demoDevices.map((device) => <div key={device.id}><span className="device-icon"><Server size={16} /></span><span><strong>{device.name}</strong><small>{device.platform} · {device.site}</small></span><em>Local simulator</em></div>)}</div>
      <div className="onboarding-unavailable onboarding-demo-safety"><ShieldCheck size={18} /><div><strong>No passwords or external data are imported</strong><span>You can remove these devices from Inventory at any time.</span></div></div>
    </>;
  };

  return <div className="modal-backdrop onboarding-backdrop" onMouseDown={onClose}><section className="onboarding-modal onboarding-tour-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="NetSSH welcome tour">
    <button type="button" className="onboarding-close" onClick={onClose} aria-label="Close welcome tour"><X size={17} /></button>
    <div className="onboarding-stepper" aria-label="Welcome tour progress">{steps.map((label, index) => <span key={label} className={index === step ? "active" : index < step ? "complete" : ""}><i>{index < step ? <Check size={10} /> : index + 1}</i>{label}</span>)}</div>
    <div className="onboarding-tour-content">{renderStep()}</div>
    {error && <div className="onboarding-error"><X size={14} />{error}</div>}
    <div className="onboarding-footer"><button type="button" className="onboarding-back" onClick={() => step === 0 ? void complete(true) : setStep((current) => Math.max(current - 1, 0))} disabled={saving}>{step === 0 ? "Skip setup" : <><ChevronLeft size={14} /> Back</>}</button><span>Step {step + 1} of {steps.length}</span>{step < steps.length - 1 ? <button type="button" className="primary-button" onClick={next}>Continue <ChevronRight size={15} /></button> : <button type="button" className="primary-button" onClick={() => void complete()} disabled={saving}>{saving ? "Saving…" : "Finish setup"} {!saving && <Check size={15} />}</button>}</div>
  </section></div>;
}
