import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, Bot, BrainCircuit, Calculator, Check, ChevronDown, ChevronRight, CircleDot,
  Clock3, Code2, Command, Copy, Database, Gauge, Globe2, Grid2X2, HardDrive,
  KeyRound, Layers3, Menu, MoreHorizontal, Network, PanelLeftClose, Pencil, Plus,
  ExternalLink, Eye, EyeOff, LockKeyhole, Radio, Router, Search, Send, Server, Settings, ShieldCheck, Sparkles, Star,
  TerminalSquare, Trash2, Wrench, X, Zap,
} from "lucide-react";
import { aiProviders, openProviderWebApp, providerIsConnected, removeProviderKey, saveProviderKey, sendAiMessage } from "./ai";
import { hosts as initialHosts, recentCommands, snippets } from "./data";
import { calculateSubnet, type SubnetResult } from "./network";
import { runDiagnostic, type DiagnosticKind, type DiagnosticResult } from "./diagnostics";
import { preflightConnection } from "./ssh";
import { deleteDevicePassword, hasDevicePassword, isNativeApp, saveDevicePassword } from "./credentials";
import type { AiMessage, AiProvider, ConnectionHistory, ConnectionProtocol, Host, Session, TerminalLine, View } from "./types";

const navItems: { id: View; label: string; icon: typeof TerminalSquare }[] = [
  { id: "workspace", label: "Workspace", icon: TerminalSquare },
  { id: "inventory", label: "Inventory", icon: Server },
  { id: "toolbox", label: "Toolbox", icon: Wrench },
  { id: "snippets", label: "Snippets", icon: Code2 },
  { id: "assistant", label: "AI assistant", icon: Bot },
];

const statusLabel = { online: "Reachable", warning: "Attention", offline: "Offline" };
type Appearance = "dark" | "light" | "system";
type AppPreferences = { appearance: Appearance; compactWorkspace: boolean; showConnectionWarnings: boolean; defaultProtocol: ConnectionProtocol; sites: string[]; platforms: string[] };
type AppNotification = { id: string; message: string; createdAt: number; read: boolean };
const defaultPlatforms = ["Cisco IOS-XE", "Cisco NX-OS", "Arista EOS", "Juniper JunOS", "Palo Alto", "Fortinet FortiOS", "Linux", "Other"];
const defaultSites = [...new Set(initialHosts.map((host) => host.site))].sort();
const defaultPreferences: AppPreferences = { appearance: "dark", compactWorkspace: false, showConnectionWarnings: true, defaultProtocol: "ssh", sites: defaultSites, platforms: defaultPlatforms };

function App() {
  const [view, setView] = useState<View>("workspace");
  const [deviceHosts, setDeviceHosts] = useState<Host[]>(() => {
    try {
      const saved = localStorage.getItem("netssh.devices");
      return saved ? JSON.parse(saved) as Host[] : initialHosts;
    } catch {
      return initialHosts;
    }
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState("");
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem("netssh.preferences") ?? "{}") }; }
    catch { return defaultPreferences; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [notifications, setNotifications] = useState<AppNotification[]>([
    { id: "phase-3", message: "Phase 3 workspace tools are ready: tabs, split panes, and AI side panel.", createdAt: Date.now(), read: false },
  ]);
  const [history, setHistory] = useState<ConnectionHistory[]>(() => {
    try {
      const saved = localStorage.getItem("netssh.history");
      return saved ? JSON.parse(saved) as ConnectionHistory[] : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("netssh.devices", JSON.stringify(deviceHosts));
  }, [deviceHosts]);

  useEffect(() => {
    localStorage.setItem("netssh.history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("netssh.preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const connect = async (host: Host, forceNew = false): Promise<string | null> => {
    const protocol = host.protocol ?? "ssh";
    const existing = sessions.find((session) => session.host.id === host.id);
    if (existing && !forceNew) {
      setActiveSession(existing.id);
      setView("workspace");
      return existing.id;
    } else {
      let preflight;
      try {
        preflight = await preflightConnection(protocol, host.address, protocol === "serial" ? undefined : host.port ?? (protocol === "telnet" ? 23 : 22), host.baudRate);
      } catch (caught) {
        const detail = String(caught);
        setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: false, detail }, ...current].slice(0, 250));
        notify(detail);
        return null;
      }
      setHistory((current) => [{ id: crypto.randomUUID(), deviceId: host.id, deviceName: host.name, protocol, address: host.address, startedAt: Date.now(), success: true, detail: preflight.banner ?? `${protocol.toUpperCase()} target reachable`, elapsedMs: preflight.elapsedMs }, ...current].slice(0, 250));
      const id = `session-${host.id}-${Date.now()}`;
      setSessions((current) => [...current, {
        id,
        host,
        connected: true,
        lines: [
          { kind: "info", text: `${protocol.toUpperCase()} preflight completed for ${host.address}${protocol === "serial" ? ` at ${host.baudRate ?? 9600} baud` : `:${host.port ?? (protocol === "telnet" ? 23 : 22)}`} in ${preflight.elapsedMs} ms` },
          { kind: "info", text: preflight.banner ?? `${protocol.toUpperCase()} service reachable` },
          ...(preferences.showConnectionWarnings ? [{ kind: "warning" as const, text: `Interactive ${protocol.toUpperCase()} transport and authentication are not enabled in this Phase 2 preview.` }] : []),
        ],
      }]);
      setActiveSession(id);
      setView("workspace");
      return id;
    }
  };

  const closeSession = (id: string) => {
    const remaining = sessions.filter((session) => session.id !== id);
    setSessions(remaining);
    if (activeSession === id) setActiveSession(remaining.at(-1)?.id ?? null);
  };

  const appendLines = (id: string, lines: TerminalLine[]) => {
    setSessions((current) => current.map((session) => session.id === id
      ? { ...session, lines: [...session.lines, ...lines] }
      : session));
  };

  const notify = (message: string) => {
    setToast(message);
    setNotifications((current) => [{ id: crypto.randomUUID(), message, createdAt: Date.now(), read: false }, ...current].slice(0, 30));
    window.setTimeout(() => setToast(""), 2200);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentSession = sessions.find((session) => session.id === activeSession);

  const lightMode = preferences.appearance === "light" || (preferences.appearance === "system" && !systemDark);

  return (
    <div className={`app-shell ${lightMode ? "theme-light" : "theme-dark"} ${preferences.compactWorkspace ? "compact-workspace" : ""}`}>
      <div className="window-drag"><span /><span /><span /></div>
      <Sidebar view={view} setView={setView} open={sidebarOpen} setOpen={setSidebarOpen} onSearch={() => setSearchOpen(true)} onOpenSettings={() => setSettingsOpen(true)} notify={notify} deviceCount={deviceHosts.length} />
      <main className={`main ${sidebarOpen ? "" : "main-expanded"}`}>
        <Topbar view={view} onSearch={() => setSearchOpen(true)} notifications={notifications} notificationsOpen={notificationsOpen} onToggleNotifications={() => { setNotificationsOpen((open) => !open); setSettingsOpen(false); setNotifications((current) => current.map((item) => ({ ...item, read: true }))); }} onClearNotifications={() => setNotifications([])} onOpenSettings={() => { setSettingsOpen(true); setNotificationsOpen(false); }} />
        <div className="content">
          {view === "workspace" && (
            <Workspace sessions={sessions} activeId={activeSession} session={currentSession} hosts={deviceHosts} onActivate={setActiveSession} onClose={closeSession} onConnect={connect} onNewSession={(host) => connect(host, true)} onCommand={appendLines} onAddDevice={() => setAddDeviceOpen(true)} onShowInventory={() => setView("inventory")} notify={notify} />
          )}
          {view === "inventory" && <Inventory hosts={deviceHosts} onConnect={connect} onAdd={() => setAddDeviceOpen(true)} onEdit={setEditingHost} onFavorite={(id) => setDeviceHosts((current) => current.map((host) => host.id === id ? { ...host, favorite: !host.favorite } : host))} onDelete={(id) => { setDeviceHosts((current) => current.filter((host) => host.id !== id)); deleteDevicePassword(id).catch(() => undefined); notify("Device removed"); }} />}
          {view === "toolbox" && <Toolbox notify={notify} />}
          {view === "snippets" && <Snippets notify={notify} />}
          {view === "assistant" && <AiAssistant notify={notify} />}
          {view === "favorites" && <Favorites hosts={deviceHosts} onConnect={connect} onFavorite={(id) => setDeviceHosts((current) => current.map((host) => host.id === id ? { ...host, favorite: !host.favorite } : host))} onShowInventory={() => setView("inventory")} />}
          {view === "history" && <History entries={history} hosts={deviceHosts} onConnect={connect} onClear={() => { setHistory([]); notify("Connection history cleared"); }} />}
          {view === "credentials" && <Credentials hosts={deviceHosts} notify={notify} />}
        </div>
      </main>
      {searchOpen && <CommandPalette hosts={deviceHosts} onClose={() => setSearchOpen(false)} onConnect={connect} onNavigate={setView} />}
      {(addDeviceOpen || editingHost) && <AddDeviceModal existingHosts={deviceHosts} initialHost={editingHost ?? undefined} defaultProtocol={preferences.defaultProtocol} configuredSites={preferences.sites} configuredPlatforms={preferences.platforms} onClose={() => { setAddDeviceOpen(false); setEditingHost(null); }} onSave={async (host, password) => {
        setDeviceHosts((current) => editingHost ? current.map((item) => item.id === host.id ? host : item) : [host, ...current]);
        if (password) {
          try { await saveDevicePassword(host.id, password); notify(`${host.name} saved with password`); }
          catch (caught) { notify((caught as Error).message); }
        } else notify(`${host.name} ${editingHost ? "updated" : "added"}`);
        setAddDeviceOpen(false); setEditingHost(null); setView("inventory");
      }} />}
      {settingsOpen && <SettingsModal preferences={preferences} onClose={() => setSettingsOpen(false)} onSave={(next) => { setPreferences(next); setSettingsOpen(false); notify("Settings saved"); }} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function Sidebar({ view, setView, open, setOpen, onSearch, onOpenSettings, notify, deviceCount }: { view: View; setView: (view: View) => void; open: boolean; setOpen: (open: boolean) => void; onSearch: () => void; onOpenSettings: () => void; notify: (message: string) => void; deviceCount: number }) {
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <aside className={`sidebar ${open ? "" : "sidebar-closed"}`}>
      <div className="brand"><div className="brand-mark"><Network size={20} /></div><span>NetSSH</span><button className="icon-button collapse" onClick={() => setOpen(!open)}>{open ? <PanelLeftClose size={17} /> : <Menu size={17} />}</button></div>
      <button className="search-button" onClick={onSearch}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <nav>
        <div className="nav-label">Control center</div>
        {navItems.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === "inventory" && <em>{deviceCount}</em>}</button>)}
      </nav>
      <div className="sidebar-section">
        <div className="nav-label">Quick access</div>
        <button className={`nav-item ${view === "favorites" ? "active" : ""}`} onClick={() => setView("favorites")}><Star size={18} /><span>Favourites</span></button>
        <button className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}><Clock3 size={18} /><span>History</span></button>
        <button className={`nav-item ${view === "credentials" ? "active" : ""}`} onClick={() => setView("credentials")}><KeyRound size={18} /><span>Credentials</span></button>
      </div>
      <div className="sidebar-footer">
        <div className="sync-card"><div className="sync-icon"><ShieldCheck size={17} /></div><div><strong>Local vault</strong><small>Encrypted & secure</small></div><span className="status-dot" /></div>
        <div className="profile-wrap">{profileOpen && <div className="profile-menu"><button onClick={() => { setProfileOpen(false); onOpenSettings(); }}><Settings size={14} /><span><strong>Preferences</strong><small>Workspace, sites, and platforms</small></span></button><button onClick={() => { setProfileOpen(false); setView("credentials"); }}><KeyRound size={14} /><span><strong>Credential vault</strong><small>Manage device passwords</small></span></button><button onClick={() => { setProfileOpen(false); notify("NetSSH 0.1.0 · Local workspace"); }}><Network size={14} /><span><strong>About NetSSH</strong><small>Version 0.1.0</small></span></button></div>}<button className="profile" aria-label="Open profile menu" onClick={() => setProfileOpen((value) => !value)}><span className="avatar">NE</span><span><strong>Network Engineer</strong><small>Local workspace</small></span><MoreHorizontal size={18} /></button></div>
      </div>
    </aside>
  );
}

function Topbar({ view, onSearch, notifications, notificationsOpen, onToggleNotifications, onClearNotifications, onOpenSettings }: { view: View; onSearch: () => void; notifications: AppNotification[]; notificationsOpen: boolean; onToggleNotifications: () => void; onClearNotifications: () => void; onOpenSettings: () => void }) {
  const titles: Record<View, string> = { workspace: "Workspace", inventory: "Device inventory", toolbox: "Network toolbox", snippets: "Command snippets", assistant: "AI assistant", favorites: "Favourite devices", history: "Connection history", credentials: "Credential vault" };
  const unread = notifications.filter((item) => !item.read).length;
  return <header className="topbar"><div><h1>{titles[view]}</h1><span className="breadcrumb">NetSSH <ChevronRight size={12} /> {titles[view]}</span></div><div className="top-actions"><button className="mini-search" onClick={onSearch}><Search size={15} /> Quick search</button><div className="top-popover-wrap"><button className={`icon-button ${notificationsOpen ? "active" : ""}`} aria-label="Notifications" onClick={onToggleNotifications}><Bell size={18} />{unread > 0 && <em className="notification-count">{unread}</em>}</button>{notificationsOpen && <NotificationCenter notifications={notifications} onClear={onClearNotifications} />}</div><button className="icon-button" aria-label="Settings" onClick={onOpenSettings}><Settings size={18} /></button></div></header>;
}

function NotificationCenter({ notifications, onClear }: { notifications: AppNotification[]; onClear: () => void }) {
  return <section className="notification-center"><div><strong>Notifications</strong>{notifications.length > 0 && <button onClick={onClear}>Clear all</button>}</div>{notifications.length ? <div className="notification-list">{notifications.map((item) => <article key={item.id}><span><Bell size={13} /></span><div><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div></article>)}</div> : <div className="notification-empty"><Check size={20} /><span>You’re all caught up</span></div>}</section>;
}

function SettingsModal({ preferences, onClose, onSave }: { preferences: AppPreferences; onClose: () => void; onSave: (preferences: AppPreferences) => void }) {
  const [draft, setDraft] = useState(preferences);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><Settings size={18} /></span><div><h3>NetSSH settings</h3><p>Workspace preferences are stored locally on this device.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="settings-body"><label className="settings-select"><span><strong>Appearance</strong><small>Choose a light, dark, or operating-system theme</small></span><select value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value as Appearance })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use system setting</option></select></label><label className="settings-select"><span><strong>Default connection protocol</strong><small>Used when creating a new device profile</small></span><select value={draft.defaultProtocol} onChange={(event) => setDraft({ ...draft, defaultProtocol: event.target.value as ConnectionProtocol })}><option value="ssh">SSH</option><option value="telnet">Telnet</option><option value="serial">Serial</option></select></label><label className="settings-toggle"><span><strong>Compact workspace</strong><small>Reduce tab, toolbar, and terminal spacing</small></span><input type="checkbox" checked={draft.compactWorkspace} onChange={(event) => setDraft({ ...draft, compactWorkspace: event.target.checked })} /></label><label className="settings-toggle"><span><strong>Connection safety notices</strong><small>Show authentication and trust limitations in new sessions</small></span><input type="checkbox" checked={draft.showConnectionWarnings} onChange={(event) => setDraft({ ...draft, showConnectionWarnings: event.target.checked })} /></label><ConfigList title="Inventory sites" description="Available when adding or editing a device" items={draft.sites} placeholder="Add a site" onChange={(sites) => setDraft({ ...draft, sites })} /><ConfigList title="Device platforms" description="Vendor and operating-system choices" items={draft.platforms} placeholder="Add a platform" onChange={(platforms) => setDraft({ ...draft, platforms })} /><div className="settings-security"><ShieldCheck size={16} /><span>Credentials remain in the operating system vault. NetSSH does not store passwords in preferences.</span></div></div><div className="modal-actions settings-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => onSave(draft)}>Save settings</button></div></section></div>;
}

function ConfigList({ title, description, items, placeholder, onChange }: { title: string; description: string; items: string[]; placeholder: string; onChange: (items: string[]) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const clean = value.trim();
    if (!clean || items.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    onChange([...items, clean]); setValue("");
  };
  return <section className="config-list"><div><strong>{title}</strong><small>{description}</small></div><div className="config-chips">{items.map((item) => <span key={item}>{item}<button aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((value) => value !== item))}><X size={11} /></button></span>)}</div><div className="config-add"><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder} /><button onClick={add}><Plus size={13} /> Add</button></div></section>;
}

function Workspace({ sessions, activeId, session, hosts, onActivate, onClose, onConnect, onNewSession, onCommand, onAddDevice, onShowInventory, notify }: { sessions: Session[]; activeId: string | null; session?: Session; hosts: Host[]; onActivate: (id: string) => void; onClose: (id: string) => void; onConnect: (host: Host) => void; onNewSession: (host: Host) => Promise<string | null>; onCommand: (id: string, lines: TerminalLine[]) => void; onAddDevice: () => void; onShowInventory: () => void; notify: (message: string) => void }) {
  const [layout, setLayout] = useState<"single" | "split" | "ai">("single");
  const [primaryId, setPrimaryId] = useState<string | null>(activeId);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<string | null>(activeId);
  const [pickerMode, setPickerMode] = useState<"tab" | "split" | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const primary = sessions.find((item) => item.id === primaryId) ?? session;
  const secondary = sessions.find((item) => item.id === secondaryId);
  useEffect(() => {
    if (layout !== "split" && activeId) setPrimaryId(activeId);
  }, [activeId, layout]);
  useEffect(() => {
    if (primaryId && !sessions.some((item) => item.id === primaryId)) setPrimaryId(activeId);
    if (secondaryId && (!sessions.some((item) => item.id === secondaryId) || secondaryId === primaryId)) {
      const replacement = sessions.find((item) => item.id !== primaryId);
      if (replacement) setSecondaryId(replacement.id);
      else {
      setSecondaryId(null);
      setLayout("single");
      }
    }
  }, [sessions, primaryId, secondaryId, activeId, layout]);
  useEffect(() => {
    if (layout !== "split" || (focusedPane !== primary?.id && focusedPane !== secondaryId)) setFocusedPane(primary?.id ?? null);
  }, [layout, primary?.id, secondaryId, focusedPane]);
  if (!session || !primary) return <WorkspaceHome hosts={hosts} onConnect={onConnect} onAddDevice={onAddDevice} onShowInventory={onShowInventory} />;
  const toggleSplit = () => {
    if (layout === "split") { setLayout("single"); return; }
    const available = sessions.find((item) => item.id !== primary.id);
    if (available) { setPrimaryId(primary.id); setSecondaryId(available.id); setLayout("split"); }
    else setPickerMode("split");
  };
  const selectDevice = async (host: Host) => {
    const mode = pickerMode;
    setPickerMode(null);
    const id = await onNewSession(host);
    if (id && mode === "split") { setPrimaryId(primary.id); setSecondaryId(id); setLayout("split"); onActivate(primary.id); }
  };
  const activateTab = (id: string) => {
    if (layout === "split" && id === secondaryId) {
      setSecondaryId(primary.id);
      setFocusedPane(id);
    }
    setPrimaryId(id);
    onActivate(id);
  };
  const selectPrimary = (id: string) => {
    if (id === secondaryId) setSecondaryId(primary.id);
    setPrimaryId(id);
    onActivate(id);
    setFocusedPane(id);
  };
  const selectSecondary = (id: string) => {
    if (!secondary) return;
    if (id === primary.id) { setPrimaryId(secondary.id); setSecondaryId(primary.id); onActivate(secondary.id); }
    else setSecondaryId(id);
    setFocusedPane(id);
  };
  return (
    <section className="terminal-layout">
      <div className="session-tabs">
        {sessions.map((item) => <button key={item.id} className={`session-tab ${item.id === activeId ? "active" : ""}`} onClick={() => activateTab(item.id)}><span className={`device-state ${item.host.status}`} /><span>{item.host.name}</span><X size={13} onClick={(event) => { event.stopPropagation(); onClose(item.id); }} /></button>)}
        <button className="new-tab" aria-label="Open new session tab" title="Open new session tab" onClick={() => setPickerMode("tab")}><Plus size={15} /></button>
      </div>
      <div className="terminal-toolbar"><div><CircleDot size={14} /><strong>{primary.host.name}</strong><span>{primary.host.address}</span></div><div><span className="latency"><Activity size={13} /> {primary.host.latency ?? "—"} ms</span><button className={layout === "split" ? "toolbar-active" : ""} aria-label="Toggle split sessions" title="Toggle split sessions" onClick={toggleSplit}><Grid2X2 size={15} /></button><button className={layout === "ai" ? "toolbar-active" : ""} aria-label="Toggle AI side panel" title="Toggle AI side panel" onClick={() => setLayout(layout === "ai" ? "single" : "ai")}><Bot size={15} /></button><div className="session-menu-wrap"><button className={sessionMenuOpen ? "toolbar-active" : ""} aria-label="Session options" onClick={() => setSessionMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button>{sessionMenuOpen && <div className="session-menu"><button onClick={async () => { setSessionMenuOpen(false); await onNewSession(primary.host); }}><Plus size={14} /><span><strong>Duplicate tab</strong><small>Open another independent session</small></span></button><button onClick={() => { setSessionMenuOpen(false); toggleSplit(); }}><Grid2X2 size={14} /><span><strong>{layout === "split" ? "Close split view" : "Split with session"}</strong><small>{layout === "split" ? "Return to one pane" : "Choose a second device pane"}</small></span></button><button onClick={() => { navigator.clipboard?.writeText(primary.host.address); setSessionMenuOpen(false); notify("Address copied"); }}><Copy size={14} /><span><strong>Copy address</strong><small>{primary.host.address}</small></span></button><button className="menu-danger" onClick={() => { setSessionMenuOpen(false); onClose(primary.id); }}><Trash2 size={14} /><span><strong>Close session</strong><small>Close this workspace tab</small></span></button></div>}</div></div></div>
      {layout === "single" && <Terminal session={primary} onCommand={(lines) => onCommand(primary.id, lines)} />}
      {layout === "split" && secondary && <div className="workspace-panes"><SessionPane session={primary} sessions={sessions} excludedId={secondary.id} active={focusedPane === primary.id} onSelect={selectPrimary} onActivate={() => setFocusedPane(primary.id)} onCommand={(lines) => onCommand(primary.id, lines)} /><SessionPane session={secondary} sessions={sessions} excludedId={primary.id} active={focusedPane === secondary.id} onSelect={selectSecondary} onActivate={() => setFocusedPane(secondary.id)} onCommand={(lines) => onCommand(secondary.id, lines)} /></div>}
      {layout === "ai" && <div className="workspace-panes ai-workspace"><SessionPane session={primary} sessions={sessions} active onSelect={(id) => { setPrimaryId(id); onActivate(id); }} onActivate={() => onActivate(primary.id)} onCommand={(lines) => onCommand(primary.id, lines)} /><AiSidePanel session={primary} notify={notify} /></div>}
      {pickerMode && <SessionPicker hosts={hosts} title={pickerMode === "split" ? "Open session beside this one" : "Open a new session tab"} onClose={() => setPickerMode(null)} onSelect={selectDevice} onAddDevice={() => { setPickerMode(null); onAddDevice(); }} />}
    </section>
  );
}

function SessionPane({ session, sessions, excludedId, active, onSelect, onActivate, onCommand }: { session: Session; sessions: Session[]; excludedId?: string; active: boolean; onSelect: (id: string) => void; onActivate: () => void; onCommand: (lines: TerminalLine[]) => void }) {
  return <section className={`session-pane ${active ? "active" : ""}`} onMouseDown={onActivate}><div className="pane-heading"><span className={`device-state ${session.host.status}`} /><div className="pane-session-select"><select aria-label="Session displayed in this pane" value={session.id} onChange={(event) => { event.stopPropagation(); onSelect(event.target.value); }}>{sessions.map((item) => <option value={item.id} disabled={item.id === excludedId} key={item.id}>{item.host.name} · {item.host.address}</option>)}</select><ChevronDown size={12} /></div><span>{(session.host.protocol ?? "ssh").toUpperCase()}</span></div><Terminal session={session} autoFocus={active} onCommand={onCommand} /></section>;
}

function SessionPicker({ hosts, title, onClose, onSelect, onAddDevice }: { hosts: Host[]; title: string; onClose: () => void; onSelect: (host: Host) => void; onAddDevice: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = hosts.filter((host) => `${host.name} ${host.address} ${host.site} ${host.platform}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="session-picker" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><TerminalSquare size={18} /></span><div><h3>{title}</h3><p>Each selection creates an independent workspace tab.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="picker-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices by name, address, site, or platform" /></div><div className="picker-devices">{filtered.map((host) => <button key={host.id} onClick={() => onSelect(host)}><span className="device-icon"><Router size={17} /></span><span><strong>{host.name}</strong><small>{host.address} · {host.site}</small></span><span className="protocol-pill">{(host.protocol ?? "ssh").toUpperCase()}</span><ChevronRight size={15} /></button>)}{filtered.length === 0 && <div className="picker-empty"><Search size={22} /><span>No matching devices</span></div>}</div><div className="picker-footer"><span>{hosts.length} inventory devices</span><button className="secondary-button" onClick={onAddDevice}><Plus size={14} /> Add device</button></div></section></div>;
}

function AiSidePanel({ session, notify }: { session: Session; notify: (message: string) => void }) {
  const [provider, setProvider] = useState<AiProvider>("demo");
  const [messages, setMessages] = useState<AiMessage[]>([{ ...assistantWelcome, id: `side-welcome-${session.id}`, content: `I’m ready to help with ${session.host.name}. Enable session context below if you want to include recent terminal output.` }]);
  const [draft, setDraft] = useState("");
  const [attachContext, setAttachContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState<Record<"openai" | "gemini", boolean>>({ openai: false, gemini: false });
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { Promise.all([providerIsConnected("openai"), providerIsConnected("gemini")]).then(([openai, gemini]) => setConnected({ openai, gemini })); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean || sending) return;
    if (provider !== "demo" && !connected[provider]) { notify(`Connect ${aiProviders[provider].name} in the AI assistant settings first`); return; }
    const context = attachContext ? `\n\nSession context from ${session.host.name} (${session.host.platform}):\n${session.lines.slice(-6).map((line) => line.text).join("\n")}` : "";
    const userMessage: AiMessage = { id: crypto.randomUUID(), role: "user", content: clean, createdAt: Date.now() };
    const requestMessage: AiMessage = { ...userMessage, content: `${clean}${context}` };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages); setDraft(""); setSending(true);
    try {
      const response = await sendAiMessage(provider, [...messages, requestMessage]);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response, createdAt: Date.now() }]);
    } catch (caught) { notify((caught as Error).message); }
    finally { setSending(false); }
  };
  return <aside className="workspace-ai"><div className="workspace-ai-head"><div><span><BrainCircuit size={16} /></span><div><strong>Network copilot</strong><small>Beside {session.host.name}</small></div></div><div className="provider-select"><span className="provider-dot" style={{ background: aiProviders[provider].accent }} /><select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)} aria-label="Side panel AI provider"><option value="demo">Demo</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select><ChevronDown size={13} /></div></div><div className="workspace-ai-notice"><ShieldCheck size={13} />Session output is excluded unless you enable context.</div><div className="side-chat-scroll">{messages.map((message) => <ChatMessage key={message.id} message={message} provider={provider} />)}{sending && <div className="chat-message assistant-message"><span className="message-avatar"><Bot size={15} /></span><div className="message-bubble typing"><i /><i /><i /></div></div>}<div ref={bottomRef} /></div><form className="side-composer" onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this session…" rows={3} /><label><input type="checkbox" checked={attachContext} onChange={(event) => setAttachContext(event.target.checked)} /><span><Layers3 size={12} /> Include recent session context</span></label><button className="primary-button" disabled={!draft.trim() || sending}><Send size={14} /> Send</button></form></aside>;
}

function WorkspaceHome({ hosts, onConnect, onAddDevice, onShowInventory }: { hosts: Host[]; onConnect: (host: Host) => void; onAddDevice: () => void; onShowInventory: () => void }) {
  return (
    <div className="page workspace-home">
      <section className="hero-card">
        <div className="hero-copy"><span className="eyebrow"><Sparkles size={14} /> Network operations, simplified</span><h2>Your network.<br /><span>One command away.</span></h2><p>Connect, troubleshoot, and move through your infrastructure without breaking your flow.</p><div className="hero-actions"><button className="primary-button" onClick={() => hosts[0] ? onConnect(hosts[0]) : onAddDevice()}><TerminalSquare size={17} /> New session</button><button className="secondary-button" onClick={onAddDevice}><Plus size={17} /> Add device</button></div></div>
        <div className="hero-visual"><div className="pulse p1" /><div className="pulse p2" /><div className="network-orb"><Network size={44} /></div><span className="node n1"><Router size={17} /></span><span className="node n2"><ShieldCheck size={17} /></span><span className="node n3"><Server size={17} /></span></div>
      </section>
      <div className="section-heading"><div><h3>Jump back in</h3><p>Your recently accessed devices</p></div><button onClick={onShowInventory}>View inventory <ChevronRight size={15} /></button></div>
      <div className="device-grid">{hosts.slice(0, 4).map((host) => <DeviceCard key={host.id} host={host} onConnect={onConnect} />)}</div>
      <div className="dashboard-grid">
        <section className="panel activity-panel"><div className="panel-title"><div><h3>Network pulse</h3><p>Live overview</p></div><span className="live-pill"><i /> Live</span></div><div className="metrics"><Metric icon={Gauge} value="99.7%" label="Availability" trend="+0.2%" /><Metric icon={Activity} value="18 ms" label="Avg latency" trend="-3 ms" /><Metric icon={Server} value="5 / 6" label="Reachable" trend="1 alert" warning /></div></section>
        <section className="panel command-panel"><div className="panel-title"><div><h3>Recent commands</h3><p>Run again in one click</p></div><button><MoreHorizontal size={17} /></button></div>{recentCommands.slice(0, 3).map((command) => <div className="command-row" key={command}><code>{command}</code><button><Copy size={14} /></button></div>)}</section>
      </div>
    </div>
  );
}

function DeviceCard({ host, onConnect, onFavorite }: { host: Host; onConnect: (host: Host) => void; onFavorite?: (id: string) => void }) {
  return <button className="device-card" onClick={() => onConnect(host)}><div className="device-top"><span className="device-icon"><Router size={20} /></span><Star size={15} role={onFavorite ? "button" : undefined} tabIndex={onFavorite ? 0 : undefined} aria-label={host.favorite ? `Remove ${host.name} from favourites` : `Add ${host.name} to favourites`} className={host.favorite ? "starred" : ""} onClick={(event) => { if (!onFavorite) return; event.stopPropagation(); onFavorite(host.id); }} onKeyDown={(event) => { if (onFavorite && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); onFavorite(host.id); } }} /></div><strong>{host.name}</strong><code>{host.address}</code><div className="device-meta"><span className={`device-state ${host.status}`} />{statusLabel[host.status]}<span>·</span>{host.latency ? `${host.latency} ms` : "No response"}</div><div className="device-footer"><span>{host.platform} · {(host.protocol ?? "ssh").toUpperCase()}</span><ChevronRight size={15} /></div></button>;
}

function Metric({ icon: Icon, value, label, trend, warning }: { icon: typeof Gauge; value: string; label: string; trend: string; warning?: boolean }) {
  return <div className="metric"><span className="metric-icon"><Icon size={18} /></span><div><strong>{value}</strong><span>{label}</span></div><em className={warning ? "warning" : ""}>{trend}</em></div>;
}

function Terminal({ session, onCommand, autoFocus = true }: { session: Session; onCommand: (lines: TerminalLine[]) => void; autoFocus?: boolean }) {
  const [command, setCommand] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.lines]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = command.trim();
    if (!clean) return;
    const responses: Record<string, string> = {
      "show ip interface brief": "Interface              IP-Address      OK? Method Status                Protocol\nGigabitEthernet0/0     10.24.0.1      YES NVRAM  up                    up\nGigabitEthernet0/1     172.20.10.2    YES NVRAM  up                    up\nLoopback0              10.255.0.1     YES NVRAM  up                    up",
      "show bgp summary": "BGP router identifier 10.255.0.1, local AS number 65001\nNeighbor        V    AS MsgRcvd MsgSent Up/Down  State/PfxRcd\n172.20.10.1     4 65000  184221  183992 12w3d           842",
      "show version": `${session.host.platform}\nNetSSH demonstration session · uptime 84 days, 11 hours`,
      "clear": "__CLEAR__",
    };
    const output = responses[clean.toLowerCase()] ?? `% Command accepted: ${clean}\nDemo mode: native SSH transport is connected through the Tauri backend in production.`;
    if (output === "__CLEAR__") onCommand([{ kind: "info", text: "Terminal cleared" }]);
    else onCommand([{ kind: "command", text: clean }, { kind: "output", text: output }]);
    setCommand("");
  };

  return <div className="terminal"><div className="terminal-output">{session.lines.map((line, index) => <div className={`terminal-line ${line.kind}`} key={`${index}-${line.text}`}><span className="line-prefix">{line.kind === "command" ? `${session.host.name}#` : line.kind === "info" ? "●" : ""}</span><pre>{line.text}</pre></div>)}<div ref={bottomRef} /></div><form className="terminal-input" onSubmit={submit}><span>{session.host.name}#</span><input autoFocus={autoFocus} value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} placeholder="Type a command…" /><kbd>Enter</kbd></form><div className="terminal-status"><span><i /> {(session.host.protocol ?? "ssh").toUpperCase()} · Preflight</span><span>UTF-8</span><span>{session.host.platform}</span></div></div>;
}

function Inventory({ hosts, onConnect, onAdd, onEdit, onFavorite, onDelete }: { hosts: Host[]; onConnect: (host: Host) => void; onAdd: () => void; onEdit: (host: Host) => void; onFavorite: (id: string) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("all");
  const [status, setStatus] = useState<"all" | Host["status"]>("all");
  const [pendingDelete, setPendingDelete] = useState<Host | null>(null);
  const sites = [...new Set(hosts.map((host) => host.site))].sort();
  const filtered = hosts.filter((host) => {
    const matchesQuery = `${host.name} ${host.address} ${host.platform} ${host.site} ${(host.tags ?? []).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (site === "all" || host.site === site) && (status === "all" || host.status === status);
  });
  const resetFilters = () => { setQuery(""); setSite("all"); setStatus("all"); };
  return <div className="page"><div className="page-intro"><div><h2>All devices</h2><p>Your complete network inventory in one place.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add device</button></div><div className="filter-bar"><div className="input-wrap"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, IP, vendor, site, or tag" /></div><div className="select-wrap"><select aria-label="Filter by site" value={site} onChange={(event) => setSite(event.target.value)}><option value="all">All sites</option>{sites.map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></div><div className="select-wrap"><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="online">Reachable</option><option value="warning">Attention</option><option value="offline">Offline</option></select><ChevronDown size={14} /></div></div><div className="inventory-summary"><span>{filtered.length} of {hosts.length} devices</span>{(query || site !== "all" || status !== "all") && <button onClick={resetFilters}><X size={12} /> Clear filters</button>}</div><section className="inventory-table"><div className="table-row table-head"><span>Device</span><span>Address</span><span>Platform</span><span>Site</span><span>Status</span><span /></div>{filtered.map((host) => <div className="table-row" key={host.id}><span className="table-device"><span className="device-icon"><Router size={18} /></span><span><strong>{host.name}</strong><small>{(host.protocol ?? "ssh").toUpperCase()} · {host.protocol === "serial" ? `${host.address} @ ${host.baudRate ?? 9600}` : `${host.username ? `${host.username}@` : ""}${host.address}:${host.port ?? (host.protocol === "telnet" ? 23 : 22)}`}</small></span></span><code>{host.address}</code><span>{host.platform}</span><span>{host.site}</span><span className={`status-pill ${host.status}`}><i />{statusLabel[host.status]}</span><span className="row-actions"><button className="delete-device favorite-device" aria-label={host.favorite ? `Remove ${host.name} from favourites` : `Add ${host.name} to favourites`} onClick={() => onFavorite(host.id)}><Star size={14} className={host.favorite ? "starred" : ""} /></button><button className="delete-device" aria-label={`Edit ${host.name}`} onClick={() => onEdit(host)}><Pencil size={14} /></button><button className="connect-button" disabled={host.status === "offline"} onClick={() => onConnect(host)}>Connect <ChevronRight size={14} /></button><button className="delete-device" aria-label={`Delete ${host.name}`} onClick={() => setPendingDelete(host)}><Trash2 size={14} /></button></span></div>)}{filtered.length === 0 && <div className="empty-inventory"><Search size={24} /><strong>No devices found</strong><span>Change the filters or add a new device.</span><button className="secondary-button" onClick={resetFilters}>Reset filters</button></div>}</section>{pendingDelete && <ConfirmModal title={`Remove ${pendingDelete.name}?`} message="This removes the device and its password from your local vault. Existing terminal sessions remain open." confirmLabel="Remove device" onCancel={() => setPendingDelete(null)} onConfirm={() => { onDelete(pendingDelete.id); setPendingDelete(null); }} />}</div>;
}

function Favorites({ hosts, onConnect, onFavorite, onShowInventory }: { hosts: Host[]; onConnect: (host: Host) => void; onFavorite: (id: string) => void; onShowInventory: () => void }) {
  const favorites = hosts.filter((host) => host.favorite);
  return <div className="page"><div className="page-intro"><div><h2>Favourite devices</h2><p>Fast access to the devices you use most.</p></div><button className="secondary-button" onClick={onShowInventory}>Manage inventory</button></div>{favorites.length ? <div className="device-grid">{favorites.map((host) => <DeviceCard key={host.id} host={host} onConnect={onConnect} onFavorite={onFavorite} />)}</div> : <section className="panel standalone-empty"><Star size={28} /><strong>No favourite devices yet</strong><span>Use the star action in Inventory to pin a device here.</span><button className="primary-button" onClick={onShowInventory}>Open inventory</button></section>}</div>;
}

function History({ entries, hosts, onConnect, onClear }: { entries: ConnectionHistory[]; hosts: Host[]; onConnect: (host: Host) => void; onClear: () => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  return <div className="page"><div className="page-intro"><div><h2>Connection history</h2><p>Local metadata from your latest connection preflights.</p></div>{entries.length > 0 && <button className="secondary-button" onClick={() => setConfirmClear(true)}><Trash2 size={15} /> Clear history</button>}</div>{entries.length ? <section className="inventory-table history-table"><div className="history-row history-head"><span>Device</span><span>Protocol</span><span>Started</span><span>Result</span><span /></div>{entries.map((entry) => { const host = hosts.find((item) => item.id === entry.deviceId); return <div className="history-row" key={entry.id}><span><strong>{entry.deviceName}</strong><small>{entry.address}</small></span><span className="protocol-pill">{entry.protocol.toUpperCase()}</span><span>{new Date(entry.startedAt).toLocaleString()}</span><span className={entry.success ? "history-success" : "history-failure"}><i />{entry.success ? `Succeeded${entry.elapsedMs !== undefined ? ` · ${entry.elapsedMs} ms` : ""}` : "Failed"}<small title={entry.detail}>{entry.detail}</small></span><span>{host && <button className="connect-button" onClick={() => onConnect(host)}>Reconnect <ChevronRight size={14} /></button>}</span></div>})}</section> : <section className="panel standalone-empty"><Clock3 size={28} /><strong>No connection history yet</strong><span>Successful and failed connection attempts will appear here.</span></section>}{confirmClear && <ConfirmModal title="Clear connection history?" message="This permanently removes locally stored connection metadata. Your devices and credentials are not affected." confirmLabel="Clear history" onCancel={() => setConfirmClear(false)} onConfirm={() => { onClear(); setConfirmClear(false); }} />}</div>;
}

function Credentials({ hosts, notify }: { hosts: Host[]; notify: (message: string) => void }) {
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Host | null>(null);
  const refresh = async () => {
    const results = await Promise.all(hosts.map(async (host) => [host.id, await hasDevicePassword(host.id)] as const));
    setStored(Object.fromEntries(results));
  };
  useEffect(() => { refresh(); }, [hosts]);
  const remove = async (host: Host) => {
    try { await deleteDevicePassword(host.id); await refresh(); notify(`${host.name} password removed`); }
    catch (caught) { notify((caught as Error).message); }
  };
  return <div className="page"><div className="page-intro"><div><h2>Credential vault</h2><p>Passwords are stored in macOS Keychain or Windows Credential Manager, never in inventory data.</p></div><span className={`native-badge ${isNativeApp() ? "available" : ""}`}><LockKeyhole size={14} />{isNativeApp() ? "Native vault active" : "Native app required"}</span></div><section className="inventory-table credential-table"><div className="credential-row credential-head"><span>Device</span><span>Username</span><span>Protocol</span><span>Password</span><span /></div>{hosts.filter((host) => (host.protocol ?? "ssh") !== "serial").map((host) => <div className="credential-row" key={host.id}><span><strong>{host.name}</strong><small>{host.address}</small></span><span>{host.username ?? "Not set"}</span><span className="protocol-pill">{(host.protocol ?? "ssh").toUpperCase()}</span><span className={stored[host.id] ? "vault-stored" : "vault-empty"}><i />{stored[host.id] ? "Stored securely" : "Not stored"}</span><span className="row-actions"><button className="connect-button" disabled={!isNativeApp()} onClick={() => setSelected(host)}>{stored[host.id] ? "Replace" : "Set password"}</button>{stored[host.id] && <button className="delete-device" aria-label={`Delete ${host.name} password`} onClick={() => remove(host)}><Trash2 size={14} /></button>}</span></div>)}</section>{selected && <PasswordModal host={selected} onClose={() => setSelected(null)} onSave={async (password) => { try { await saveDevicePassword(selected.id, password); await refresh(); setSelected(null); notify(`${selected.name} password saved securely`); } catch (caught) { notify((caught as Error).message); } }} />}</div>;
}

function PasswordModal({ host, onClose, onSave }: { host: Host; onClose: () => void; onSave: (password: string) => void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="confirm-modal password-modal" onMouseDown={(event) => event.stopPropagation()}><span><KeyRound size={19} /></span><h3>Save password for {host.name}</h3><p>The password is written directly to your operating system credential vault.</p><div className="secret-input"><LockKeyhole size={15} /><input autoFocus type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Device password" /><button onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><div className="password-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!password} onClick={() => onSave(password)}>Save securely</button></div></section></div>;
}

function Toolbox({ notify }: { notify: (message: string) => void }) {
  const [activeTool, setActiveTool] = useState<"subnet" | "ping" | "dns" | "port">("subnet");
  const [cidr, setCidr] = useState("10.24.16.34/20");
  const [result, setResult] = useState<SubnetResult>(() => calculateSubnet(cidr));
  const [error, setError] = useState("");
  const calculate = (event?: FormEvent) => {
    event?.preventDefault();
    try { setResult(calculateSubnet(cidr)); setError(""); } catch (caught) { setError((caught as Error).message); }
  };
  const copy = (value: string) => { navigator.clipboard?.writeText(value); notify("Copied to clipboard"); };
  const tools = [
    { id: "subnet" as const, icon: Calculator, label: "Subnet calculator" },
    { id: "ping" as const, icon: Radio, label: "Ping & trace" },
    { id: "dns" as const, icon: Globe2, label: "DNS lookup" },
    { id: "port" as const, icon: Database, label: "Port check" },
  ];
  return <div className="page"><div className="page-intro"><div><h2>Network toolbox</h2><p>Fast, reliable utilities built into your workflow.</p></div></div><div className="tool-tabs">{tools.map((tool) => <button key={tool.id} className={activeTool === tool.id ? "active" : ""} onClick={() => setActiveTool(tool.id)}><tool.icon size={16} /> {tool.label}</button>)}</div>{activeTool === "subnet" ? <div className="tool-grid"><section className="panel calculator-panel"><div className="panel-title"><div><h3>IPv4 subnet calculator</h3><p>Enter any address using CIDR notation</p></div><span className="tool-icon"><Calculator size={20} /></span></div><form onSubmit={calculate} className="calculator-form"><label>IP address / CIDR</label><div><input value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="192.168.1.10/24" /><button className="primary-button">Calculate</button></div>{error && <span className="form-error">{error}</span>}</form><div className="result-grid"><Result label="Network" value={result.network} copy={copy} /><Result label="Broadcast" value={result.broadcast} copy={copy} /><Result label="Subnet mask" value={result.mask} copy={copy} /><Result label="Wildcard mask" value={result.wildcard} copy={copy} /><Result label="First usable" value={result.firstHost} copy={copy} /><Result label="Last usable" value={result.lastHost} copy={copy} /></div><div className="capacity-row"><div><span>Address space</span><strong>{result.cidr}</strong></div><div><span>Usable hosts</span><strong>{result.usable.toLocaleString()}</strong></div><div><span>Total addresses</span><strong>{result.total.toLocaleString()}</strong></div><div><span>Scope</span><strong>{result.isPrivate ? "Private" : "Public"}</strong></div></div></section><aside className="tool-aside"><section className="panel"><div className="panel-title"><div><h3>Binary view</h3><p>32-bit representation</p></div></div><div className="binary-value">{result.binary.split(".").map((part, index) => <span key={index}>{part}{index < 3 && <i>.</i>}</span>)}</div></section><section className="panel quick-tools"><div className="panel-title"><div><h3>Quick tools</h3><p>Common network checks</p></div></div>{tools.slice(1).map((tool) => <button key={tool.id} onClick={() => setActiveTool(tool.id)}><span><tool.icon size={17} /></span><div><strong>{tool.label}</strong><small>{tool.id === "ping" ? "Reachability and hop path" : tool.id === "dns" ? "System resolver lookup" : "Timed TCP handshake"}</small></div><ChevronRight size={15} /></button>)}</section></aside></div> : <DiagnosticPanel tool={activeTool} notify={notify} />}</div>;
}

function DiagnosticPanel({ tool, notify }: { tool: "ping" | "dns" | "port"; notify: (message: string) => void }) {
  const [mode, setMode] = useState<"ping" | "trace">("ping");
  const [target, setTarget] = useState(tool === "dns" ? "example.com" : "1.1.1.1");
  const [port, setPort] = useState("22");
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setResult(null); setError(""); setTarget(tool === "dns" ? "example.com" : "1.1.1.1"); }, [tool]);
  const kind: DiagnosticKind = tool === "ping" ? mode : tool;
  const labels = tool === "ping" ? { title: "Reachability and path", description: "Send ICMP probes or trace the route to a host", button: mode === "ping" ? "Run ping" : "Run trace" } : tool === "dns" ? { title: "DNS lookup", description: "Resolve A and AAAA records using the system resolver", button: "Resolve host" } : { title: "TCP port check", description: "Attempt a timed TCP handshake to a service", button: "Check port" };
  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (!target.trim()) { setError("Enter a hostname or IP address"); return; }
    const numericPort = Number(port);
    if (tool === "port" && (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)) { setError("Port must be between 1 and 65535"); return; }
    setRunning(true); setError(""); setResult(null);
    try { setResult(await runDiagnostic(kind, target.trim(), tool === "port" ? numericPort : undefined)); }
    catch (caught) { setError(String(caught)); }
    finally { setRunning(false); }
  };
  return <div className="diagnostic-layout"><section className="panel diagnostic-panel"><div className="panel-title"><div><h3>{labels.title}</h3><p>{labels.description}</p></div><span className="tool-icon">{tool === "ping" ? <Radio size={20} /> : tool === "dns" ? <Globe2 size={20} /> : <Database size={20} />}</span></div>{tool === "ping" && <div className="mode-switch"><button className={mode === "ping" ? "active" : ""} onClick={() => setMode("ping")}>Ping</button><button className={mode === "trace" ? "active" : ""} onClick={() => setMode("trace")}>Traceroute</button></div>}<form className="diagnostic-form" onSubmit={run}><label><span>Hostname or IP address</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="router.example.net" /></label>{tool === "port" && <label className="port-field"><span>Port</span><input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" /></label>}<button className="primary-button" disabled={running}>{running ? <><Activity size={15} className="spin" /> Running…</> : <><Zap size={15} /> {labels.button}</>}</button></form>{error && <div className="diagnostic-error">{error}</div>}<div className={`diagnostic-output ${result ? "has-result" : ""}`}>{result ? <><div className="output-head"><span className={result.success ? "success" : "failure"}><i />{result.success ? "Completed" : "Check failed"}</span><span>{result.elapsedMs} ms</span><button onClick={() => { navigator.clipboard?.writeText(result.output); notify("Diagnostic output copied"); }}><Copy size={14} /> Copy</button></div><pre>{result.output}</pre></> : <div className="output-empty"><TerminalSquare size={25} /><strong>Ready to run</strong><span>Results will appear here without changing the target device.</span></div>}</div></section><aside className="panel diagnostic-help"><div className="panel-title"><div><h3>Safe diagnostics</h3><p>What this tool does</p></div></div><div className="help-body"><ShieldCheck size={19} /><p>{kind === "ping" ? "Sends four ICMP echo requests. Some networks block ICMP, so a failed ping does not always mean the host is down." : kind === "trace" ? "Discovers the routed path with a maximum of 16 hops. Firewalls may hide intermediate devices." : kind === "dns" ? "Uses your operating system resolver and respects configured DNS servers, VPNs, and split DNS." : "Opens and immediately closes one TCP connection. It does not authenticate or send application data."}</p></div></aside></div>;
}

function Result({ label, value, copy }: { label: string; value: string; copy: (value: string) => void }) { return <div className="result-item"><span>{label}</span><div><code>{value}</code><button onClick={() => copy(value)}><Copy size={14} /></button></div></div>; }

function AddDeviceModal({ existingHosts, initialHost, defaultProtocol, configuredSites, configuredPlatforms, onClose, onSave }: { existingHosts: Host[]; initialHost?: Host; defaultProtocol: ConnectionProtocol; configuredSites: string[]; configuredPlatforms: string[]; onClose: () => void; onSave: (host: Host, password?: string) => void }) {
  const [name, setName] = useState(initialHost?.name ?? "");
  const [protocol, setProtocol] = useState<ConnectionProtocol>(initialHost?.protocol ?? defaultProtocol);
  const [address, setAddress] = useState(initialHost?.address ?? "");
  const [port, setPort] = useState(String(initialHost?.port ?? ((initialHost?.protocol ?? defaultProtocol) === "telnet" ? 23 : 22)));
  const [baudRate, setBaudRate] = useState(String(initialHost?.baudRate ?? 9600));
  const [username, setUsername] = useState(initialHost?.username ?? "");
  const [password, setPassword] = useState("");
  const [platform, setPlatform] = useState(initialHost?.platform ?? configuredPlatforms[0] ?? "Other");
  const [site, setSite] = useState(initialHost?.site ?? "");
  const [tags, setTags] = useState((initialHost?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(initialHost?.notes ?? "");
  const [error, setError] = useState("");
  const platformOptions = [...new Set([...configuredPlatforms, initialHost?.platform, platform].filter((value): value is string => Boolean(value)))];
  const siteOptions = [...new Set([...configuredSites, ...existingHosts.map((host) => host.site), initialHost?.site].filter((value): value is string => Boolean(value)))].sort();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanAddress = address.trim();
    const numericPort = protocol === "serial" ? undefined : Number(port);
    if (!cleanName || !cleanAddress || !site.trim()) { setError("Name, address, and site are required."); return; }
    if (protocol !== "serial" && !/^[a-zA-Z0-9.:-]+$/.test(cleanAddress)) { setError("Enter a valid hostname or IP address."); return; }
    if (protocol !== "serial" && (!Number.isInteger(numericPort) || Number(numericPort) < 1 || Number(numericPort) > 65535)) { setError("Port must be between 1 and 65535."); return; }
    if (existingHosts.some((host) => host.id !== initialHost?.id && host.address.toLowerCase() === cleanAddress.toLowerCase() && (host.protocol ?? "ssh") === protocol && (protocol === "serial" || (host.port ?? (protocol === "telnet" ? 23 : 22)) === numericPort))) { setError("A matching connection profile already exists."); return; }
    onSave({
      id: initialHost?.id ?? `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`,
      name: cleanName,
      address: cleanAddress,
      protocol,
      port: numericPort,
      baudRate: protocol === "serial" ? Number(baudRate) : undefined,
      username: protocol === "serial" ? undefined : username.trim() || undefined,
      platform,
      site: site.trim(),
      status: initialHost?.status ?? "online",
      latency: initialHost?.latency ?? null,
      favorite: initialHost?.favorite,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
    }, protocol === "serial" ? undefined : password || undefined);
  };
  const changeProtocol = (next: ConnectionProtocol) => { setProtocol(next); if (next === "ssh" && port === "23") setPort("22"); if (next === "telnet" && port === "22") setPort("23"); };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="device-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><Router size={18} /></span><div><h3>{initialHost ? `Edit ${initialHost.name}` : "Add a network device"}</h3><p>Create a reusable SSH, Telnet, or Serial connection profile.</p></div></div><button onClick={onClose}><X size={17} /></button></div><form className="device-form" onSubmit={submit}><div className="protocol-selector">{(["ssh", "telnet", "serial"] as ConnectionProtocol[]).map((value) => <button type="button" className={protocol === value ? "active" : ""} onClick={() => changeProtocol(value)} key={value}><Radio size={14} />{value.toUpperCase()}</button>)}</div><div className="form-grid"><label><span>Device name *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="CORE-SW-03" /></label><label><span>Platform</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}>{platformOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="wide-field"><span>{protocol === "serial" ? "Serial port *" : "Hostname or IP address *"}</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={protocol === "serial" ? "/dev/cu.usbserial-110 or COM3" : "10.24.1.5 or switch.example.net"} /></label>{protocol === "serial" ? <label><span>Baud rate</span><select value={baudRate} onChange={(event) => setBaudRate(event.target.value)}>{[9600, 19200, 38400, 57600, 115200].map((rate) => <option value={rate} key={rate}>{rate}</option>)}</select></label> : <><label><span>{protocol.toUpperCase()} port</span><input inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} /></label><label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="netadmin" autoComplete="username" /></label><label><span>{initialHost ? "Replace password" : "Password"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={initialHost ? "Leave blank to keep existing" : "Optional"} autoComplete="new-password" /></label></>}<label><span>Site *</span><select value={site} onChange={(event) => setSite(event.target.value)}><option value="" disabled>Select a site</option>{siteOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="core, production" /></label><label className="wide-field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Circuit ID, rack, support details…" rows={3} /></label></div>{error && <div className="modal-error">{error}</div>}<div className="form-security"><ShieldCheck size={15} /><span>{isNativeApp() ? "Passwords are saved directly to your operating system credential vault." : "Inventory changes work in preview; password storage requires the native NetSSH app."}</span></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{initialHost ? <Pencil size={15} /> : <Plus size={15} />} {initialHost ? "Save changes" : "Add device"}</button></div></form></section></div>;
}

function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={onCancel}><section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()}><span><Trash2 size={19} /></span><h3>{title}</h3><p>{message}</p><div><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="confirm-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function Snippets({ notify }: { notify: (message: string) => void }) {
  return <div className="page"><div className="page-intro"><div><h2>Command snippets</h2><p>Reusable, vendor-aware commands for faster troubleshooting.</p></div><button className="primary-button"><Plus size={17} /> New snippet</button></div><div className="snippet-grid">{snippets.map((snippet) => <section className="panel snippet-card" key={snippet.name}><div><span className="snippet-icon"><Code2 size={18} /></span><span className="vendor-tag">{snippet.vendor}</span></div><h3>{snippet.name}</h3><code>{snippet.command}</code><div><button onClick={() => { navigator.clipboard?.writeText(snippet.command); notify("Snippet copied"); }}><Copy size={15} /> Copy</button><button><Zap size={15} /> Run</button></div></section>)}</div></div>;
}

const assistantWelcome: AiMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hi, I’m your network engineering copilot. I can help interpret command output, build troubleshooting plans, explain protocols, and review configuration changes. I’ll suggest read-only checks first and flag commands that could affect service.",
  createdAt: Date.now(),
};

function AiAssistant({ notify }: { notify: (message: string) => void }) {
  const [provider, setProvider] = useState<AiProvider>("demo");
  const [messages, setMessages] = useState<AiMessage[]>([assistantWelcome]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connected, setConnected] = useState<Record<"openai" | "gemini", boolean>>({ openai: false, gemini: false });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([providerIsConnected("openai"), providerIsConnected("gemini")]).then(([openai, gemini]) => setConnected({ openai, gemini }));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const submit = async (event?: FormEvent, suggestion?: string) => {
    event?.preventDefault();
    const content = (suggestion ?? draft).trim();
    if (!content || sending) return;
    if (provider !== "demo" && !connected[provider]) {
      setSettingsOpen(true);
      return;
    }
    const userMessage: AiMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    try {
      const content = await sendAiMessage(provider, nextMessages);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content, createdAt: Date.now() }]);
    } catch (caught) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `I couldn't contact ${aiProviders[provider].name}: ${(caught as Error).message}`, createdAt: Date.now() }]);
    } finally {
      setSending(false);
    }
  };

  const switchProvider = (next: AiProvider) => {
    setProvider(next);
    if (next !== "demo" && !connected[next]) setSettingsOpen(true);
  };

  return <div className="assistant-page">
    <section className="assistant-main">
      <div className="assistant-header">
        <div className="assistant-title"><span><BrainCircuit size={20} /></span><div><h2>Network copilot</h2><p>Advice grounded in safe operational practice</p></div></div>
        <div className="provider-select">
          <span className="provider-dot" style={{ background: aiProviders[provider].accent }} />
          <select value={provider} onChange={(event) => switchProvider(event.target.value as AiProvider)} aria-label="AI provider">
            <option value="demo">NetSSH Demo · Offline</option>
            <option value="openai">OpenAI · GPT-5.6 Terra</option>
            <option value="gemini">Google · Gemini 3.6 Flash</option>
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
      <div className="assistant-notice"><ShieldCheck size={14} /><span>AI suggestions can be wrong. Review commands and configuration changes before applying them.</span></div>
      <div className="chat-scroll">
        <div className="message-list">
          {messages.map((message) => <ChatMessage key={message.id} message={message} provider={provider} />)}
          {sending && <div className="chat-message assistant-message"><span className="message-avatar"><Bot size={15} /></span><div className="message-bubble typing"><i /><i /><i /></div></div>}
          <div ref={scrollRef} />
        </div>
      </div>
      {messages.length === 1 && <div className="prompt-suggestions">
        {["Help me troubleshoot a BGP neighbour", "Review an interface with packet loss", "Plan a safe switch configuration change"].map((suggestion) => <button key={suggestion} onClick={() => submit(undefined, suggestion)}><Sparkles size={14} />{suggestion}<ChevronRight size={14} /></button>)}
      </div>}
      <form className="chat-composer" onSubmit={submit}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask about a fault, protocol, command output, or change plan…" rows={2} />
        <div><span><LockKeyhole size={12} /> Secrets stay in your OS credential vault</span><button type="submit" disabled={!draft.trim() || sending}><Send size={16} /></button></div>
      </form>
    </section>
    <aside className="assistant-context">
      <section><div className="context-heading"><span><Layers3 size={16} /></span><div><strong>Session context</strong><small>Optional context sent with chat</small></div></div><button className="context-empty"><TerminalSquare size={18} /><span><strong>No session attached</strong><small>Attach terminal output for analysis</small></span><Plus size={14} /></button></section>
      <section><div className="context-heading"><span><ShieldCheck size={16} /></span><div><strong>Privacy controls</strong><small>Review before sending</small></div></div><label className="privacy-row"><span>Redact IP addresses</span><input type="checkbox" /></label><label className="privacy-row"><span>Remove possible secrets</span><input type="checkbox" defaultChecked /></label></section>
      <section className="provider-card"><div className="context-heading"><span><Bot size={16} /></span><div><strong>{aiProviders[provider].name}</strong><small>{aiProviders[provider].model}</small></div></div><button onClick={() => setSettingsOpen(true)}><Settings size={14} /> API provider settings</button><div className="web-chat-divider"><span>or use your existing login</span></div><button onClick={() => openProviderWebApp("openai")}><ExternalLink size={14} /> Open ChatGPT web</button><button onClick={() => openProviderWebApp("gemini")}><ExternalLink size={14} /> Open Gemini web</button></section>
    </aside>
    {settingsOpen && <ProviderSettings connected={connected} setConnected={setConnected} onClose={() => setSettingsOpen(false)} notify={notify} />}
  </div>;
}

function ChatMessage({ message, provider }: { message: AiMessage; provider: AiProvider }) {
  const parts = message.content.split(/(`[^`]+`)/g);
  return <div className={`chat-message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}>
    <span className="message-avatar">{message.role === "assistant" ? <Bot size={15} /> : "NE"}</span>
    <div><div className="message-meta"><strong>{message.role === "assistant" ? aiProviders[provider].name : "You"}</strong><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><div className="message-bubble">{parts.map((part, index) => part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>)}</div></div>
  </div>;
}

function ProviderSettings({ connected, setConnected, onClose, notify }: { connected: Record<"openai" | "gemini", boolean>; setConnected: (value: Record<"openai" | "gemini", boolean>) => void; onClose: () => void; notify: (message: string) => void }) {
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await saveProviderKey(provider, apiKey.trim());
      setConnected({ ...connected, [provider]: true });
      setApiKey(""); setError(""); notify(`${aiProviders[provider].name} connected`); onClose();
    } catch (caught) { setError((caught as Error).message); }
  };
  const remove = async () => {
    await removeProviderKey(provider);
    setConnected({ ...connected, [provider]: false });
    notify(`${aiProviders[provider].name} disconnected`);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="provider-modal" onMouseDown={(event) => event.stopPropagation()}><div className="provider-modal-head"><div><span><LockKeyhole size={18} /></span><div><h3>Connect an AI provider</h3><p>Use the provider website or connect an API key.</p></div></div><button onClick={onClose}><X size={17} /></button></div><div className="provider-options"><button className={provider === "openai" ? "active" : ""} onClick={() => setProvider("openai")}><span className="openai-mark">O</span><div><strong>OpenAI</strong><small>GPT-5.6 Terra</small></div>{connected.openai && <Check size={15} />}</button><button className={provider === "gemini" ? "active" : ""} onClick={() => setProvider("gemini")}><span className="gemini-mark">G</span><div><strong>Google Gemini</strong><small>Gemini 3.6 Flash</small></div>{connected.gemini && <Check size={15} />}</button></div><form onSubmit={save} className="provider-form"><button type="button" className="web-mode-button" onClick={() => openProviderWebApp(provider)}><ExternalLink size={16} /><span><strong>Open {provider === "openai" ? "ChatGPT" : "Gemini"} web</strong><small>Sign in with your existing account or subscription</small></span><ChevronRight size={15} /></button><div className="web-chat-divider"><span>or connect for integrated context</span></div><label>{aiProviders[provider].name} API key</label><div className="secret-input"><KeyRound size={15} /><input type={visible ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider === "openai" ? "sk-…" : "AIza…"} /><button type="button" onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>{error && <span className="form-error">{error}</span>}<p>API access is separate from a consumer ChatGPT or Gemini subscription. It enables NetSSH to provide redacted session context and may be billed by your provider.</p><a href={provider === "openai" ? "https://platform.openai.com/api-keys" : "https://aistudio.google.com/app/apikey"} target="_blank" rel="noreferrer">Get an API key <ExternalLink size={12} /></a><div className="provider-actions">{connected[provider] && <button type="button" className="danger-button" onClick={remove}><Trash2 size={14} /> Disconnect</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!apiKey.trim()}>Save securely</button></div></form></section></div>;
}

function CommandPalette({ hosts, onClose, onConnect, onNavigate }: { hosts: Host[]; onClose: () => void; onConnect: (host: Host) => void; onNavigate: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => hosts.filter((host) => `${host.name} ${host.address}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4), [query]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="command-palette" onMouseDown={(event) => event.stopPropagation()}><div className="palette-search"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices, tools, and commands…" /><kbd>ESC</kbd></div><div className="palette-body"><span className="nav-label">Devices</span>{results.map((host) => <button key={host.id} onClick={() => { onConnect(host); onClose(); }}><span className="device-icon"><Router size={17} /></span><div><strong>{host.name}</strong><small>{host.address} · {host.site}</small></div><span className={`device-state ${host.status}`} /></button>)}<span className="nav-label">Actions</span><button onClick={() => { onNavigate("toolbox"); onClose(); }}><span className="device-icon"><Calculator size={17} /></span><div><strong>Open subnet calculator</strong><small>Network toolbox</small></div><Command size={14} /></button><button onClick={() => { onNavigate("assistant"); onClose(); }}><span className="device-icon"><Bot size={17} /></span><div><strong>Ask the network copilot</strong><small>AI assistant</small></div><Command size={14} /></button></div><div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span></div></div></div>;
}

export default App;
