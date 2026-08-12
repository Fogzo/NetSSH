import { readFile, writeFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";

if (!token || !repository) {
  throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid repository name: ${repository}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const apiHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(path, headers = apiHeaders) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }
  return response;
}

const release = await (await github(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`)).json();
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));

function findSignedAsset(predicate, description) {
  const asset = [...assets.values()].find((candidate) => predicate(candidate) && assets.has(`${candidate.name}.sig`));
  if (!asset) {
    throw new Error(`Could not find a signed ${description} asset in release ${tag}`);
  }
  return { asset, signatureAsset: assets.get(`${asset.name}.sig`) };
}

async function signatureFor(asset) {
  const response = await github(
    `/repos/${owner}/${repo}/releases/assets/${asset.id}`,
    { ...apiHeaders, Accept: "application/octet-stream" },
  );
  const signature = (await response.text()).trim();
  if (!signature) {
    throw new Error(`Signature asset ${asset.name} is empty`);
  }
  return signature;
}

const mac = findSignedAsset((asset) => asset.name.endsWith(".app.tar.gz"), "macOS");
const windows = findSignedAsset((asset) => asset.name.endsWith(".exe"), "Windows");
const [macSignature, windowsSignature] = await Promise.all([
  signatureFor(mac.signatureAsset),
  signatureFor(windows.signatureAsset),
]);

const macUpdate = {
  signature: macSignature,
  url: mac.asset.browser_download_url,
};
const windowsUpdate = {
  signature: windowsSignature,
  url: windows.asset.browser_download_url,
};

const manifest = {
  version,
  notes: release.body ?? "",
  pub_date: release.published_at ?? new Date().toISOString(),
  platforms: {
    "darwin-aarch64": macUpdate,
    "darwin-x86_64": macUpdate,
    "darwin-aarch64-app": macUpdate,
    "darwin-x86_64-app": macUpdate,
    "windows-x86_64": windowsUpdate,
    "windows-x86_64-nsis": windowsUpdate,
  },
};

await writeFile("latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created latest.json for ${tag} with ${Object.keys(manifest.platforms).length} platform entries`);
