# NetSSH delivery roadmap

The roadmap is split into security and platform milestones so features that handle credentials or production devices are not shipped as non-functional UI.

## Phase 1 — Product foundation

- [x] Responsive Windows/macOS product interface
- [x] Persistent device inventory
- [x] Add and remove devices with validation
- [x] Search plus working site and status filters
- [x] Tags, notes, username, and custom SSH port metadata
- [x] IPv4 subnet calculator
- [x] Command snippets and global search
- [x] Offline network copilot demonstration
- [x] OpenAI and Gemini native provider adapters
- [x] OS credential-vault storage for AI keys
- [x] ChatGPT and Gemini web-login mode
- [x] Native ping, traceroute, DNS, and TCP diagnostics
- [x] Editable inventory with favourites and local connection history
- [x] SSH, Telnet, and Serial connection profiles

## Phase 2 — Native connection core

- [x] Install and pin the Rust build toolchain in CI
- [x] TCP connection and SSH server-banner preflight
- [x] Telnet TCP and native Serial port preflights
- [ ] SSH password, private-key, and agent authentication
- [ ] Strict known-host verification and fingerprint workflow
- [ ] Jump hosts, proxies, keepalives, and reconnect policy
- [ ] Full terminal emulation, resize, colours, and keyboard modes
- [x] OS-backed reusable login profiles with device assignments
- [ ] SQLite inventory migration and backup/restore

## Phase 3 — Engineer workflows

- [x] Multi-tab workspace and new-session device picker
- [x] Side-by-side terminal sessions
- [x] Session and opt-in AI copilot side-by-side
- [x] Inventory-linked topology designer
- [ ] Broadcast input with explicit safeguards
- [ ] SFTP browser and transfer queue
- [ ] Session logs with secret redaction
- [x] Ping, traceroute, DNS, and TCP diagnostics
- [ ] Vendor detection and command profiles
- [ ] Configuration snapshots and semantic diffs
- [ ] Change-plan mode with pre-checks and rollback steps
- [ ] Import/export from CSV, OpenSSH config, and common clients

## Phase 4 — Teams and mobility

- [ ] Optional end-to-end encrypted sync
- [ ] Shared vaults, role controls, and audit trails
- [ ] iOS and Android Tauri targets
- [ ] Touch terminal toolbar and mobile key handling
- [ ] Background-session behaviour per mobile platform policy

Each phase requires automated tests and a threat review before the next phase is considered release-ready.
