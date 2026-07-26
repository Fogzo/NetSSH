import { invoke } from "@tauri-apps/api/core";

export const isNativeApp = () => "__TAURI_INTERNALS__" in window;

export async function saveCredentialPassword(credentialId: string, password: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("save_credential_password", { credentialId, password });
}

export async function hasCredentialPassword(credentialId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  return invoke<boolean>("has_credential_password", { credentialId });
}

export async function deleteCredentialPassword(credentialId: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("delete_credential_password", { credentialId });
}

export async function saveCredentialEnablePassword(credentialId: string, password: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Enable-password storage is available in the native NetSSH app.");
  await invoke("save_credential_enable_password", { credentialId, password });
}

export async function hasCredentialEnablePassword(credentialId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  return invoke<boolean>("has_credential_enable_password", { credentialId });
}

export async function deleteCredentialEnablePassword(credentialId: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Enable-password storage is available in the native NetSSH app.");
  await invoke("delete_credential_enable_password", { credentialId });
}

export async function saveDevicePassword(deviceId: string, password: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("save_device_password", { deviceId, password });
}

export async function hasDevicePassword(deviceId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  return invoke<boolean>("has_device_password", { deviceId });
}

export async function deleteDevicePassword(deviceId: string): Promise<void> {
  if (!isNativeApp()) throw new Error("Password storage is available in the native NetSSH app.");
  await invoke("delete_device_password", { deviceId });
}
