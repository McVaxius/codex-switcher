<p align="center">
  <img src="src-tauri/icons/logo.svg" alt="Codex Switcher" width="128" height="128">
</p>

<h1 align="center">Codex Switcher</h1>

<p align="center">
  A Desktop Application for Managing Multiple OpenAI <a href="https://github.com/openai/codex">Codex CLI</a> Accounts<br>
  Easily switch between accounts, monitor usage limits, and stay in control of your quota
</p>

## Features

- **Multi-Account Management** – Add and manage multiple Codex accounts in one place
- **Quick Switching** – Switch between accounts with a single click
- **Usage Monitoring** – View real-time usage for both 5-hour and weekly limits
- **Dual Login Mode** – OAuth authentication or import existing `auth.json` files

## Installation

### Use the Windows Standalone Build

Use the files generated in `release/`:

- `Codex Switcher Setup <version>.exe` installs the app normally.
- `Codex Switcher <version>.exe` is the portable app.

Send either one to a new user. They do not need Node.js, pnpm, Rust, Tauri,
Visual Studio Build Tools, or `link.exe`.

After install, open **Codex Switcher** from the Start menu. For the portable
build, run the portable `.exe` directly.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) through Corepack

Rust, Tauri, Visual Studio Build Tools, and `link.exe` are not required.

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Lampese/codex-switcher.git
cd codex-switcher

# Install dependencies
corepack pnpm install

# Run the desktop app in development mode
corepack pnpm dev:electron

# Build the React UI and Electron backend
corepack pnpm build

# Build a Windows installer and portable app
corepack pnpm dist:win
```

The Windows installer and portable build are written to `release/`.

To share the app, send the generated `.exe` installer or portable `.exe`/zip from
`release/`. The recipient does not need Node.js, Rust, or Tauri installed.

### Update the Standalone Build

Building from source updates the files in this checkout only. An already
installed copy does not change until you install the new setup `.exe` or run the
new portable `.exe`.

```bash
corepack pnpm dist:win
```

Then use the new files in `release/`.

### Build Without Committing Binaries

Do not commit generated app files. These paths are build output and are already
ignored by Git:

```text
dist/
dist-electron/
release/
```

Local release build:

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm dist:win
```

This creates the installer and portable app in `release/` on your machine only.
Commit the source changes, not the generated `.exe`, `.blockmap`, or `latest.yml`
files.

### Build Installer and Portable App on GitHub

Use GitHub Actions when you want shareable Windows builds without committing
large files.

Manual release build:

1. Commit and push the source changes.
2. Open **Actions** in GitHub.
3. Run **Build & Release**.
4. Enter the version tag matching `package.json`, such as `v0.2.6`.
5. Download `Codex Switcher Setup <version>.exe` and
   `Codex Switcher <version>.exe` from the GitHub Release.

Tag-triggered release build:

```bash
corepack pnpm release:patch -- --push
```

Use `release:minor` or `release:major` for larger version bumps. The release
script requires a clean working tree, bumps `package.json`, commits the version,
creates a `v<version>` tag, and pushes the branch and tag. The pushed tag starts
the GitHub Actions build and publishes installer/portable assets on the GitHub
Release.

## First Run

1. Open Codex Switcher.
2. Click **Add Account**.
3. Pick one login method:
   - **ChatGPT Login**: enter a local account name, click **Generate Login Link**,
     open the link, sign in, and wait for the app to finish the callback.
   - **Import File**: enter a local account name, choose an existing Codex
     `auth.json`, and click **Import**.
4. Add each Codex/ChatGPT account you personally own.
5. Use **SWITCH** on a row to make that account active for Codex CLI.

`ACTIVE` marks the account currently written to Codex's active `auth.json`.
Switching is disabled while Codex is running so credentials are not changed under
an active Codex process. Close running Codex CLI sessions before switching.

## Common Actions

- **Refresh** updates quota/metadata for one row.
- Top refresh button updates all accounts.
- **Warm** sends minimal traffic for that account.
- **Hide** masks or unmasks that account's name and email.
- Click an account name to rename it.
- **Delete** removes that account from Codex Switcher.
- **Export Slim Text** creates a compact text backup/import string.
- **Import Slim Text** imports missing accounts from that string.
- **Export Full Encrypted File** writes a full `.cswf` backup.
- **Import Full Encrypted File** imports missing accounts from a `.cswf` backup.

Slim text and full encrypted backups contain account secrets. Keep them private.

### Run the Dashboard in a Browser

You can also serve the built dashboard over HTTP instead of opening the Electron shell.

```bash
# Build the frontend and start the local web server on 127.0.0.1:3210
corepack pnpm web
```

Optional environment variables:

- `CODEX_SWITCHER_WEB_HOST` to override the bind host (set `0.0.0.0` only when you want LAN access)
- `CODEX_SWITCHER_WEB_PORT` to override the port

The browser dashboard serves the same UI and backend actions through `/api/invoke/*`, which makes it usable over LAN, Tailscale, or a remote host tunnel when you expose the chosen port safely.

Health check:

```text
http://127.0.0.1:3210/api/health
```

Stop browser mode with `Ctrl+C` in the terminal that started it. If it is running
in the background on Windows, stop the local listener:

```powershell
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3210 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Where Data Is Saved

Codex Switcher stores its account list here:

```text
%USERPROFILE%\.codex-switcher\accounts.json
```

On a default Windows user account this looks like:

```text
C:\Users\<you>\.codex-switcher\accounts.json
```

The active account is written to the Codex CLI auth file:

```text
%CODEX_HOME%\auth.json
```

If `CODEX_HOME` is not set, Codex Switcher uses:

```text
%USERPROFILE%\.codex\auth.json
```

Backups are saved wherever you choose in the file dialog. The desktop app also
uses Electron/browser local storage for UI-only state such as theme:

```text
codex-switcher-theme
```

`accounts.json`, `auth.json`, slim text strings, and `.cswf` backups contain
credential material. Do not share them.

## Disclaimer

This tool is designed **exclusively for individuals who personally own multiple OpenAI/ChatGPT accounts**. It is intended to help users manage their own accounts more conveniently.

**This tool is NOT intended for:**

- Sharing accounts between multiple users
- Circumventing OpenAI's terms of service
- Any form of account pooling or credential sharing

By using this software, you agree that you are the rightful owner of all accounts you add to the application. The authors are not responsible for any misuse or violations of OpenAI's terms of service.

## Versioning

Use the version bump helper to update the package version before release.

```bash
# Exact version
corepack pnpm version:bump 0.2.1

# Semver bumps
corepack pnpm version:patch
corepack pnpm version:minor
corepack pnpm version:major

# Prepare a release commit and tag
# This automatically runs the version bump first.
corepack pnpm release patch

# Prepare and push a release
# This automatically runs the version bump first.
corepack pnpm release patch -- --push
```
