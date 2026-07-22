# Distributing NetSSH to testers

NetSSH produces native installers through Tauri. Build each platform on its matching operating system, or run the manual GitHub Actions workflow.

## Fast internal tester builds

On macOS:

```bash
npm ci
npm run package:test:mac
```

The application and DMG are written beneath `src-tauri/target/release/bundle/`.

On Windows:

```powershell
npm ci
npm run package:test:windows
```

The NSIS installer is written beneath `src-tauri\target\release\bundle\nsis\`.

These commands deliberately create unsigned builds. They are suitable only for a small, trusted testing group. macOS Gatekeeper and Windows SmartScreen may warn or block users because the publisher cannot be verified.

## Build both platforms in GitHub

1. Push the repository to GitHub.
2. Open **Actions → Build tester installers → Run workflow**.
3. Wait for the macOS and Windows jobs to finish.
4. Download the two workflow artifacts and share them through a trusted private channel.

The macOS workflow creates a universal Intel/Apple Silicon DMG. The Windows workflow creates an NSIS installer.

## Windows-first testing

For the fastest Windows-only route, run **Actions → Build Windows tester installer**. This dedicated workflow validates the frontend and Rust core, creates an unsigned NSIS installer, generates a SHA-256 checksum, and includes exact build metadata. Follow [WINDOWS_TESTING.md](WINDOWS_TESTING.md) for installation and verification steps.

## Public or wider testing

Before distributing beyond trusted testers:

1. Obtain an Apple Developer ID Application certificate and configure Apple notarization.
2. Obtain a trusted Windows code-signing certificate.
3. Store signing credentials only as protected CI secrets.
4. Remove `--no-sign` from the packaging commands.
5. Publish checksums with each installer and test upgrades before release.
6. Add an updater only after release signing and update-signing key management are established.

Never commit certificates, private keys, signing passwords, or notarization credentials to the repository.
