import { invoke } from "@tauri-apps/api/core";

export const isNativeApp = () => "__TAURI_INTERNALS__" in window;

export async function saveDevicePassword(deviceId: string, password: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("save_device_password", { deviceId, password });
  const stored = await invoke<boolean>("has_device_password", { deviceId });
  if (!stored) throw new Error("Windows Credential Manager did not return the saved password. Try saving it again or use it once at connection time.");
}

export async function hasDevicePassword(deviceId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  return invoke<boolean>("has_device_password", { deviceId });
}

export async function deleteDevicePassword(deviceId: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("delete_device_password", { deviceId });
}
