# NetSSH

NetSSH is a modern, network-engineer-first SSH workspace for Windows and macOS, with a shared product foundation that can extend to iOS and Android through Tauri 2.

## Current MVP

- Device-centric multi-tab workspace with split terminals, optional AI side panel, favourites, and connection history
- Searchable, editable inventory with SSH, Telnet, and Serial connection profiles
- Interactive IPv4 subnet calculator with binary and capacity views
- Native ping, traceroute, DNS, and TCP port diagnostics
- Reusable, vendor-aware command snippets
- Network-focused AI copilot with OpenAI, Gemini, and offline demo modes
- Native OS credential storage for provider API keys and device passwords
- Global command palette (`Cmd/Ctrl + K`)
- Responsive UI designed to adapt to future tablet and mobile layouts
- Persistent light, dark, and operating-system appearance modes
- Local-first security concept with no required cloud account

The terminal currently provides an interactive product demonstration. The native SSH transport and device persistence are the next backend milestone.

Phase 2 has started with a pinned Rust toolchain, Windows/macOS CI, native diagnostics, OS-backed device-password storage, and protocol-aware preflights. SSH validates reachability and reads the server identification banner, Telnet validates the TCP service, and Serial opens the selected system port at the configured baud rate. Authentication, known-host verification, and interactive SSH/Telnet/Serial channels are not yet enabled; the interface reports this explicitly rather than simulating trust.

Phase 3 engineer workflows have also started. The workspace supports multiple independent tabs, side-by-side terminal panes, and a compact AI copilot beside a session. Attaching recent terminal context to AI requests is always opt-in.

## Test the AI assistant

1. Run `npm run dev` and open `http://127.0.0.1:1420`.
2. Select **AI assistant** in the left navigation.
3. Keep **NetSSH Demo** selected to test the complete chat workflow offline.
4. In the native desktop app, choose OpenAI or Gemini and open **Provider settings** to add an API key.

Users who prefer their existing ChatGPT or Gemini subscription can choose **Open ChatGPT web** or **Open Gemini web**. This launches the provider's own website so the provider handles sign-in directly. Web mode does not receive NetSSH terminal context; API mode remains available for integrated, redacted device assistance.

Provider credentials and device passwords are only accepted by the native Tauri app and are stored in the operating system credential vault. The browser preview deliberately refuses to save secrets. OpenAI API access is separate from a ChatGPT subscription, and Google Gemini API access is separate from the consumer Gemini application.

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

To package unsigned installers for a trusted testing group, use `npm run package:test:mac` on macOS or `npm run package:test:windows` on Windows. A manual GitHub Actions workflow can build both platforms. See [DISTRIBUTION.md](DISTRIBUTION.md) for artifact locations, tester delivery, signing, and notarization guidance.

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

1. Native SSH engine with password, key, agent, and jump-host support
2. OS-backed encrypted credential vault and known-host verification — AI keys and device passwords implemented
3. SQLite inventory, tags, folders, imports, and backups — persistent device inventory, tags, sites, filters, and duplicate validation implemented; SQLite migration remains
4. Real terminal emulation, split panes, session logging, and SFTP
5. Network diagnostics: ping, traceroute, DNS, TCP checks, and packet captures
6. Vendor profiles, prompt detection, command templates, and config diffs
7. Secure optional sync and team sharing with audit trails
8. Tauri mobile targets with touch-first terminal controls
