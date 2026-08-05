import { useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Check, ChevronDown, FileText, FolderOpen, Plus, Save, Search, WrapText, X } from "lucide-react";

type NoteLanguage = "plaintext" | "markdown" | "cisco" | "juniper" | "yaml" | "json" | "shell";

type NoteDocument = {
  id: string;
  name: string;
  path?: string;
  content: string;
  language: NoteLanguage;
  dirty: boolean;
};

type NoteTemplate = {
  name: string;
  fileName: string;
  language: NoteLanguage;
  content: string;
};

const fileFilters = [{ name: "Network notes and text", extensions: ["txt", "md", "cfg", "conf", "log", "yaml", "yml", "json", "ini", "csv", "sh"] }];
const languageLabels: Record<NoteLanguage, string> = {
  plaintext: "Plain text",
  markdown: "Markdown",
  cisco: "Cisco config",
  juniper: "Juniper config",
  yaml: "YAML",
  json: "JSON",
  shell: "Shell",
};

const templates: NoteTemplate[] = [
  {
    name: "Change plan",
    fileName: "change-plan.md",
    language: "markdown",
    content: `# Change plan\n\n## Objective\n- What is changing:\n- Why it is changing:\n- Maintenance window:\n\n## Pre-change checks\n- [ ] Confirm approval and rollback window\n- [ ] Capture current state\n- [ ] Confirm console or out-of-band access\n\n## Implementation\n\`\`\`text\nPaste commands here. Remove passwords and secrets before saving or sharing.\n\`\`\`\n\n## Validation\n- [ ] Confirm reachability\n- [ ] Confirm routing and critical services\n- [ ] Compare against the pre-change capture\n\n## Rollback\n1. \n2. \n\n## Outcome\n- Result:\n- Follow-up actions:\n`,
  },
  {
    name: "Incident notes",
    fileName: "incident-notes.md",
    language: "markdown",
    content: `# Incident notes\n\n**Incident:** \n**Started:** \n**Impact:** \n**Owner:** \n\n## Symptoms\n- \n\n## Timeline\n- **00:00** — \n\n## Evidence\n\`\`\`text\nPaste sanitized logs, show-command output, or monitoring observations here.\n\`\`\`\n\n## Working theory\n- \n\n## Actions taken\n- [ ] \n\n## Resolution and follow-up\n- \n`,
  },
  {
    name: "Device handover",
    fileName: "device-handover.md",
    language: "markdown",
    content: `# Device handover\n\n**Device:** \n**Address:** \n**Site / rack:** \n**Platform / version:** \n**Owner:** \n\n## Management access\n- Access method:\n- Out-of-band method:\n- Monitoring:\n\n## Interfaces and uplinks\n| Interface | Connected to | Purpose | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Important configuration\n- VLANs / VRFs:\n- Routing:\n- HA / stack role:\n\n## Operational notes\n- \n\n> Never store passwords, private keys, tokens, or SNMP communities in this document.\n`,
  },
  {
    name: "Cisco interface checklist",
    fileName: "cisco-interface-checklist.cfg",
    language: "cisco",
    content: `! Interface change checklist\n! Device: \n! Interface: \n! Ticket: \n\nshow interface <interface>\nshow interface <interface> status\nshow interface <interface> switchport\nshow run interface <interface>\nshow spanning-tree interface <interface> detail\n\n! Configuration goes below this line\n`,
  },
  {
    name: "Juniper operational checks",
    fileName: "juniper-checks.conf",
    language: "juniper",
    content: `## Juniper operational checks\nshow version\nshow chassis hardware\nshow interfaces terse\nshow route summary\nshow bgp summary\nshow log messages | last 50\n\n## Configuration candidate\n`,
  },
];

function languageForFile(name: string): NoteLanguage {
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "cfg" || extension === "ios" || extension === "cisco") return "cisco";
  if (extension === "conf" || extension === "junos") return "juniper";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "json") return "json";
  if (extension === "sh" || extension === "bash") return "shell";
  return "plaintext";
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).at(-1) || "Untitled note.txt";
}

function newDocument(name = "Untitled note.txt", content = "", language = languageForFile(name)): NoteDocument {
  return { id: crypto.randomUUID(), name, content, language, dirty: false };
}

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function cursorPosition(content: string, position: number) {
  const before = content.slice(0, position);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function EngineerNotes({ notify }: { notify: (message: string) => void }) {
  const initial = newDocument("Network notes.md", "# Network engineer notes\n\nUse tabs for separate working documents. Save configuration, change plans, sanitized outputs, and handover notes as local files.\n\nRemove passwords, private keys, tokens, and SNMP communities before saving or sharing notes.\n", "markdown");
  const [documents, setDocuments] = useState<NoteDocument[]>([initial]);
  const [activeId, setActiveId] = useState(initial.id);
  const [templateName, setTemplateName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [wrapLines, setWrapLines] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = documents.find((document) => document.id === activeId) ?? documents[0];
  const lineCount = active?.content.split("\n").length ?? 1;
  const searchMatches = useMemo(() => {
    if (!active || !searchQuery) return 0;
    return active.content.split(searchQuery).length - 1;
  }, [active, searchQuery]);

  const updateActive = (changes: Partial<NoteDocument>) => {
    setDocuments((current) => current.map((document) => document.id === activeId ? { ...document, ...changes } : document));
  };

  const setCursorFromEditor = (element: HTMLTextAreaElement) => {
    setCursor(cursorPosition(element.value, element.selectionStart));
  };

  const createBlank = () => {
    const document = newDocument();
    setDocuments((current) => [...current, document]);
    setActiveId(document.id);
    setError("");
    window.setTimeout(() => editorRef.current?.focus(), 0);
  };

  const createFromTemplate = () => {
    const template = templates.find((item) => item.name === templateName);
    if (!template) return;
    const document = newDocument(template.fileName, template.content, template.language);
    document.dirty = true;
    setDocuments((current) => [...current, document]);
    setActiveId(document.id);
    setTemplateName("");
    setError("");
    notify(`${template.name} note created`);
  };

  const openDocument = async () => {
    setError("");
    try {
      if (!isTauri()) {
        fileInputRef.current?.click();
        return;
      }
      const selected = await openFileDialog({ multiple: false, directory: false, filters: fileFilters });
      if (typeof selected !== "string") return;
      const content = await readTextFile(selected);
      const name = fileNameFromPath(selected);
      const document = newDocument(name, content, languageForFile(name));
      document.path = selected;
      setDocuments((current) => [...current, document]);
      setActiveId(document.id);
      notify(`${name} opened`);
    } catch (caught) {
      setError(`Could not open file: ${String(caught)}`);
    }
  };

  const handleBrowserFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const document = newDocument(file.name, await file.text(), languageForFile(file.name));
      setDocuments((current) => [...current, document]);
      setActiveId(document.id);
      notify(`${file.name} opened`);
    } catch (caught) {
      setError(`Could not open file: ${String(caught)}`);
    }
  };

  const saveAsDocument = async (document: NoteDocument) => {
    if (!isTauri()) {
      downloadText(document.name, document.content);
      updateActive({ dirty: false });
      notify(`${document.name} downloaded`);
      return;
    }
    const selected = await saveFileDialog({ defaultPath: document.name, filters: fileFilters });
    if (typeof selected !== "string") return;
    await writeTextFile(selected, document.content);
    updateActive({ path: selected, name: fileNameFromPath(selected), dirty: false });
    notify(`${fileNameFromPath(selected)} saved`);
  };

  const saveDocument = async () => {
    if (!active) return;
    setError("");
    try {
      if (!isTauri()) {
        downloadText(active.name, active.content);
        updateActive({ dirty: false });
        notify(`${active.name} downloaded`);
      } else if (active.path) {
        await writeTextFile(active.path, active.content);
        updateActive({ dirty: false });
        notify(`${active.name} saved`);
      } else {
        await saveAsDocument(active);
      }
    } catch (caught) {
      setError(`Could not save file: ${String(caught)}`);
    }
  };

  const closeDocument = (id: string) => {
    const document = documents.find((item) => item.id === id);
    if (!document) return;
    if (document.dirty && !window.confirm(`${document.name} has unsaved changes. Close it anyway?`)) return;
    if (documents.length === 1) {
      const replacement = newDocument();
      setDocuments([replacement]);
      setActiveId(replacement.id);
      return;
    }
    const index = documents.findIndex((item) => item.id === id);
    const remaining = documents.filter((item) => item.id !== id);
    setDocuments(remaining);
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id);
  };

  const findNext = () => {
    if (!active || !searchQuery || !editorRef.current) return;
    const editor = editorRef.current;
    const start = editor.selectionEnd >= active.content.length ? 0 : editor.selectionEnd;
    const match = active.content.toLowerCase().indexOf(searchQuery.toLowerCase(), start);
    const next = match >= 0 ? match : active.content.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (next < 0) return;
    editor.focus();
    editor.setSelectionRange(next, next + searchQuery.length);
    setCursorFromEditor(editor);
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (event.shiftKey && active) void saveAsDocument(active);
      else void saveDocument();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const nextContent = `${element.value.slice(0, start)}  ${element.value.slice(end)}`;
    updateActive({ content: nextContent, dirty: true });
    window.setTimeout(() => {
      element.setSelectionRange(start + 2, start + 2);
      setCursorFromEditor(element);
    }, 0);
  };

  return <div className="notes-page">
    <section className="panel notes-workspace">
      <div className="notes-toolbar">
        <div className="notes-toolbar-group">
          <button className="notes-tool-button" onClick={createBlank} title="New note"><Plus size={15} /> New</button>
          <button className="notes-tool-button" onClick={() => void openDocument()} title="Open a text or configuration file"><FolderOpen size={15} /> Open</button>
          <button className="notes-tool-button notes-tool-primary" onClick={() => void saveDocument()} title="Save note (Ctrl+S)"><Save size={15} /> Save</button>
          <button className="notes-tool-button" onClick={() => active && void saveAsDocument(active)} title="Save note as a new file (Ctrl+Shift+S)"><Save size={15} /> Save as</button>
        </div>
        <div className="notes-toolbar-group notes-toolbar-right">
          <div className="notes-search"><Search size={14} /><input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); findNext(); } }} placeholder="Find in note" /><small>{searchQuery ? `${searchMatches} ${searchMatches === 1 ? "match" : "matches"}` : "Ctrl+F"}</small></div>
          <button className={`notes-icon-button ${wrapLines ? "active" : ""}`} onClick={() => setWrapLines((value) => !value)} title="Toggle word wrap"><WrapText size={15} /></button>
        </div>
      </div>
      <div className="notes-tabs" role="tablist" aria-label="Open notes">
        {documents.map((document) => <button key={document.id} role="tab" aria-selected={document.id === activeId} className={`notes-tab ${document.id === activeId ? "active" : ""}`} onClick={() => setActiveId(document.id)}><FileText size={13} /><span>{document.name}</span>{document.dirty && <i aria-label="Unsaved changes" />}{documents.length > 1 && <X size={13} onClick={(event) => { event.stopPropagation(); closeDocument(document.id); }} />}</button>)}
        <button className="notes-new-tab" onClick={createBlank} title="New note"><Plus size={15} /></button>
      </div>
      <div className="notes-editor-heading"><div><strong>{active?.name}</strong><span>{active?.path ?? "Not saved to disk yet"}</span></div><span className="notes-language"><ChevronDown size={13} />{active ? languageLabels[active.language] : "Plain text"}</span></div>
      <div className="notes-editor-shell">
        <div className="notes-line-gutter" aria-hidden="true"><div style={{ transform: `translateY(-${editorScrollTop}px)` }}>{Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}</div></div>
        <textarea ref={editorRef} className={`notes-editor ${wrapLines ? "wrap" : ""}`} value={active?.content ?? ""} spellCheck={false} wrap={wrapLines ? "soft" : "off"} onChange={(event) => { updateActive({ content: event.target.value, dirty: true }); setCursorFromEditor(event.currentTarget); }} onKeyDown={handleEditorKeyDown} onClick={(event) => setCursorFromEditor(event.currentTarget)} onKeyUp={(event) => setCursorFromEditor(event.currentTarget)} onScroll={(event) => setEditorScrollTop(event.currentTarget.scrollTop)} aria-label="Network note editor" />
      </div>
      {error && <div className="notes-error">{error}</div>}
      <div className="notes-statusbar"><span>{active?.dirty ? "Unsaved changes" : "Saved"}</span><span>{active ? languageLabels[active.language] : "Plain text"}</span><span>Ln {cursor.line}, Col {cursor.column}</span><span>{active?.content.length ?? 0} characters · {lineCount} lines</span></div>
    </section>
    <aside className="panel notes-sidebar">
      <div className="notes-sidebar-heading"><div><h3>Engineer templates</h3><p>Start with a useful structure</p></div><FileText size={19} /></div>
      <div className="notes-template-picker"><select value={templateName} onChange={(event) => setTemplateName(event.target.value)}><option value="">Choose a template…</option>{templates.map((template) => <option value={template.name} key={template.name}>{template.name}</option>)}</select><button className="notes-tool-button notes-tool-primary" onClick={createFromTemplate} disabled={!templateName}>Create note</button></div>
      <div className="notes-template-list">{templates.map((template) => <button key={template.name} onClick={() => { setTemplateName(template.name); }}><span><strong>{template.name}</strong><small>{languageLabels[template.language]} · {template.fileName}</small></span><Plus size={14} /></button>)}</div>
      <div className="notes-tip"><Check size={15} /><span>Notes stay in memory until you save them. Use Ctrl+S regularly and sanitize secrets before sharing files.</span></div>
    </aside>
    <input ref={fileInputRef} className="notes-hidden-file" type="file" accept=".txt,.md,.cfg,.conf,.log,.yaml,.yml,.json,.ini,.csv,.sh" onChange={(event) => void handleBrowserFile(event)} />
  </div>;
}
