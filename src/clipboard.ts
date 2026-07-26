import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function readClipboardText(): Promise<string> {
  if (isTauri()) return (await readText()) ?? "";
  return navigator.clipboard?.readText() ?? "";
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) await writeText(text);
  else await navigator.clipboard?.writeText(text);
}
