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
6. Configure the updater signing key and test an upgrade before wider distribution.

Never commit certificates, private keys, signing passwords, or notarization credentials to the repository.

## Automatic updates

NetSSH now uses the Tauri updater with GitHub Releases as its update source. The public updater verification key is committed in `src-tauri/tauri.conf.json`; the private signing key must remain outside the repository.

One-time GitHub setup:

1. Generate or use the updater private key. If you generate a new key, replace the public key in `src-tauri/tauri.conf.json` before publishing any release. Never rotate this key casually because installed versions trust the existing public key.
2. Add a repository secret named `TAURI_SIGNING_PRIVATE_KEY` containing the complete private key file.
3. Leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset when using an unencrypted key, or add it when the private key has a password.
4. Ensure Actions has read and write access to repository contents so it can create releases.

To publish an update, bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, commit the change, and push a matching tag:

```bash
git tag v0.1.10
git push origin v0.1.10
```

The `Release NetSSH` workflow builds signed updater artifacts for macOS and Windows, creates the GitHub Release, and uploads `latest.json`. Installed users can then open **Settings → Application updates → Check for updates** and install the release without manually downloading a new installer.

The updater endpoint expects public GitHub Releases. If the source repository is private, publish the release assets from a separate public distribution repository or replace the endpoint with an authenticated update service.
