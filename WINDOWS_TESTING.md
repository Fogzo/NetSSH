# Windows tester build guide

The recommended first-test route is the dedicated GitHub Actions workflow. It uses a clean Windows runner and produces an NSIS installer, SHA-256 checksum, and build metadata.

## Create the installer

1. Push the current NetSSH repository to GitHub.
2. Open the repository's **Actions** tab.
3. Select **Build Windows tester installer**.
4. Select **Run workflow**, choose the branch to test, and confirm.
5. Wait for `build-windows-installer` to complete.
6. Download the `NetSSH-Windows-Tester-<run number>` artifact from the workflow summary.
7. Extract the downloaded ZIP before running the installer.

The installer itself is the `.exe` file inside the extracted artifact. Double-click it to install NetSSH.

The artifact contains:

- The NetSSH NSIS `.exe` installer.
- A matching `.sha256` checksum file.
- `build-info.txt` containing the version, commit, workflow run, and signing status.

## Verify the download

In PowerShell, from the extracted artifact directory:

```powershell
Get-FileHash .\NetSSH_*-setup.exe -Algorithm SHA256
Get-Content .\NetSSH_*-setup.exe.sha256
```

The two SHA-256 values must match before installation.

## Install and test

1. Use a non-production Windows 10 or Windows 11 device or VM.
2. Run the installer as the current user; administrator access should not normally be required.
3. Windows SmartScreen may show an unknown-publisher warning because this first tester package is unsigned.
4. For Wi-Fi diagnostics on current Windows 11 releases, enable **Settings → Privacy & security → Location → Location services** and **Let desktop apps access your location**. NetSSH provides a direct settings button if Windows denies access.
5. Test inventory persistence, credential-vault storage, SSH/Telnet reachability, diagnostics, multiple tabs, split panes, and AI provider configuration.
6. Remove NetSSH through **Settings → Apps → Installed apps** when testing is complete.

Only share unsigned packages with a small, trusted tester group through a private channel. Obtain a Windows code-signing certificate before wider or public distribution.

## Build directly on Windows

If GitHub Actions is not available, install the Tauri Windows prerequisites, Node.js 20, and Rust 1.97.1, then run:

```powershell
npm ci
npm run package:test:windows
```

The installer is created beneath `src-tauri\target\release\bundle\nsis\`.
