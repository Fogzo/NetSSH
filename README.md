# NetSSH

NetSSH is a modern, network-engineer-first SSH workspace for Windows and macOS, with a shared product foundation that can extend to iOS and Android through Tauri 2.

## Current MVP

- Device-centric multi-tab workspace with split terminals, optional AI side panel, favourites, and connection history
- Searchable, editable inventory with SSH, Telnet, and Serial connection profiles
- Password-safe session import/export with NetSSH JSON, CSV, PuTTY, and MobaXterm migration
- Interactive IPv4 subnet calculator with binary and capacity views
- Native ping, traceroute, DNS, TCP port, and Wi-Fi health diagnostics
- Switch-port auditing from timestamped status and packet-counter snapshots
- Topology designer with inventory-linked devices, standalone network stencils, typed connections, local persistence, and JSON export
- Locally stored, searchable, editable command snippets with Cisco IOS/IOS-XE and NX-OS defaults
- Network-focused AI copilot with OpenAI, Gemini, and offline demo modes
- Reusable named login profiles with passwords stored in the native OS credential vault
- Global command palette (`Cmd/Ctrl + K`)
- Responsive UI designed to adapt to future tablet and mobile layouts
- Persistent light, dark, and operating-system appearance modes
- Local-first security concept with no required cloud account

The native desktop app now opens real interactive SSH, Telnet, and Serial sessions. SSH supports password and passwordless server authentication, including RSA host keys used by many network devices, requests an interactive PTY, verifies the server fingerprint on every connection, and warns when a saved host key changes. Telnet performs protocol negotiation and supplies the saved username and password when the device presents login prompts. Serial streams directly to local COM or `/dev/cu.*` ports at the configured baud rate.

To test a switch, add or edit the device in **Inventory**, select SSH, Telnet, or Serial, and enter the required connection details. Select **Connect** and verify the SSH SHA256 fingerprint against a trusted source the first time. The browser preview cannot create network terminal sessions; use `npm run desktop:dev` or a packaged desktop build. On macOS, Location Services may need to be enabled for network diagnostics before SSID and BSSID are available.

Windows release builds run as normal GUI applications without a separate Command Prompt window. Windows Wi-Fi diagnostics use the language-independent Native Wi-Fi API rather than parsing `netsh`. Current Windows 11 releases may require **Location services** and **Let desktop apps access your location** before SSID, BSSID, and signal details are available; NetSSH shows a direct settings shortcut when access is denied.

Saved credentials are optional. Create labelled profiles such as **Network Admin**, **Read only**, or **Lab TACACS** in **Credentials**, then assign one profile to multiple devices from the vault or device editor. Each profile supports a login password and a separate optional enable password. Passwords remain in the operating-system vault while devices store only the profile ID. From an active session menu, **Send enable password** writes the enable secret directly to the terminal only when the engineer requests it. Telnet and Serial can still present their normal login prompts. SSH requires a username before opening a shell, so unassigned devices use a one-time connection dialog. A blank password attempts passwordless authentication.

Use **Inventory → Import / export** to back up NetSSH connection profiles or migrate sessions from CSV, a PuTTY `.reg` export, a MobaXterm exported sessions file, or `MobaXterm.ini`. Imports create reusable username profiles where possible, but passwords, enable secrets, private keys, macros, proxy commands, and host-key trust are deliberately excluded.

Phase 3 engineer workflows have also started. The workspace supports multiple independent tabs, side-by-side terminal panes, and a compact AI copilot beside a session. Attaching recent terminal context to AI requests is always opt-in.

## Test the AI assistant

1. Run `npm run dev` and open `http://127.0.0.1:1420`.
2. Select **AI assistant** in the left navigation.
3. Keep **NetSSH Demo** selected to test the complete chat workflow offline.
4. In the native desktop app, choose OpenAI or Gemini and open **Provider settings** to add an API key for integrated context, or launch the provider in a dedicated NetSSH window.

Users who prefer their existing ChatGPT or Gemini subscription can select **ChatGPT Web** or **Gemini Web** directly from the provider dropdown. This embeds an isolated provider webview in both the main AI assistant and the terminal + AI split panel, where the provider handles sign-in and session storage. Web mode does not receive NetSSH terminal context; API mode remains available for integrated, redacted device assistance. Some identity providers may still require the system browser during sign-in because embedded authentication is restricted by their security policy.

Provider credentials and reusable login-profile passwords are only accepted by the native Tauri app and are stored in the operating system credential vault. The browser preview deliberately refuses to save secrets. OpenAI API access is separate from a ChatGPT subscription, and Google Gemini API access is separate from the consumer Gemini application.

## Run the interface

```bash
npm install
npm run dev
```

Create an optimized web build with:

```bash
npm run build
```

The web preview uses realistic demonstration results for diagnostics because browsers cannot send ICMP probes or open arbitrary TCP sockets. Run the native app to execute real operating-system diagnostics.

## Run as a native desktop app

Install the Rust toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, then run:

```bash
npm run desktop:dev
```

On macOS, build a directly launchable application bundle with:

```bash
npm run desktop:app
```

The bundle is written to `src-tauri/target/release/bundle/macos/NetSSH.app`. Use `npm run tauri -- build --debug --bundles app` for a faster debug bundle.

The Vite development server includes local Cisco IOS-XE and NX-OS test switches. They open without network access or credentials and support commands such as `show version`, `show ip interface brief`, `show interfaces status`, and `show vlan brief`. The interface-status command includes a Cisco-style `--More--` prompt for testing Space, Enter, scrolling, and terminal formatting.

Terminal productivity controls include Up/Down command history, Tab completion supplied by the remote device, selection copying with `Ctrl+Shift+C` or `Cmd+C`, native paste with `Ctrl+Shift+V` or `Cmd+V`, right-click paste, select-all with `Ctrl+Shift+A` or `Cmd+A`, and visible Copy, Paste, and Clear actions.

The **Toolbox → Switch audit** view identifies disconnected interfaces whose packet counters remain unchanged across a chosen number of weeks. Import periodic CSV snapshots, review protected infrastructure links separately, then copy validation commands or a shutdown-review template. NetSSH never changes switch configuration automatically; a single current interface state is not treated as proof of long-term inactivity.

The **Topology** workspace builds diagrams from inventory devices or standalone stencils for switches, Nexus platforms, routers, firewalls, wireless infrastructure, servers, user endpoints, clouds, and sites. Connections support Ethernet, fibre, EtherChannel, wireless, VPN, and console styles with editable interface labels. Drag devices into place and double-click an inventory node to open its terminal. Maps are saved locally and can be exported as JSON.

To package unsigned installers for a trusted testing group, use `npm run package:test:mac` on macOS or `npm run package:test:windows` on Windows. A manual GitHub Actions workflow can build both platforms. See [DISTRIBUTION.md](DISTRIBUTION.md) for artifact locations, tester delivery, signing, and notarization guidance.

Published desktop builds can update themselves from GitHub Releases. Open **Settings → Application updates** to check for and install a signed release without manually downloading a new installer. Release setup and the required GitHub secret are documented in [DISTRIBUTION.md](DISTRIBUTION.md).

For Windows-first testing, use the dedicated **Build Windows tester installer** GitHub Actions workflow and follow [WINDOWS_TESTING.md](WINDOWS_TESTING.md). It produces an NSIS installer with checksum and build metadata on a clean Windows runner.

## Architecture

```text
React + TypeScript product UI
          │
     Tauri command API
          │
Rust native core (SSH, vault, storage)
          │
Windows / macOS / iOS / Android
```

The product UI and network calculations stay platform-independent. Native responsibilities—SSH sockets, OS credential storage, local database, file transfer, and background sessions—live behind the Tauri command boundary.

## Recommended roadmap

See [ROADMAP.md](ROADMAP.md) for delivery phases and current status.

1. Native SSH engine — password sessions implemented; key, agent, and jump-host support remain
2. OS-backed encrypted credential vault and known-host verification — AI keys and reusable device login profiles implemented
3. SQLite inventory, tags, folders, imports, and backups — persistent device inventory, tags, sites, filters, and duplicate validation implemented; SQLite migration remains
4. Real terminal emulation, split panes, session logging, and SFTP
5. Network diagnostics: ping, traceroute, DNS, TCP checks, and packet captures
6. Vendor profiles, prompt detection, command templates, and config diffs
7. Secure optional sync and team sharing with audit trails
8. Tauri mobile targets with touch-first terminal controls
