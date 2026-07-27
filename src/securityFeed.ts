import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type SecurityAdvisory = {
  id: string;
  vendor: "Cisco" | "Fortinet";
  title: string;
  url: string;
  published: string;
  severity: "Critical" | "High" | "Medium" | "Advisory";
};

export const securityFeedFallback: SecurityAdvisory[] = [
  {
    id: "cisco-security-feed",
    vendor: "Cisco",
    title: "Open the latest Cisco Security Advisories",
    url: "https://sec.cloudapps.cisco.com/security/center/publicationListing.x",
    published: "Official PSIRT source",
    severity: "Advisory",
  },
  {
    id: "fortinet-security-feed",
    vendor: "Fortinet",
    title: "Open the latest Fortinet PSIRT Advisories",
    url: "https://www.fortiguard.com/psirt",
    published: "Official PSIRT source",
    severity: "Advisory",
  },
];

export async function fetchSecurityAdvisories(): Promise<SecurityAdvisory[]> {
  if (!isTauri()) return securityFeedFallback;
  const advisories = await Promise.race([
    invoke<SecurityAdvisory[]>("fetch_security_advisories"),
    new Promise<SecurityAdvisory[]>((resolve) => window.setTimeout(() => resolve([]), 6500)),
  ]);
  return advisories.length ? advisories : securityFeedFallback;
}

export async function openSecurityAdvisory(url: string): Promise<void> {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
