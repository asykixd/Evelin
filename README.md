<div align="center">

<img src="build/icon.png" width="128" height="128" alt="Evelin icon">

# Evelin

**Control a whole farm of USB-connected Android phones from one desktop window.**

Live screens, mouse control with broadcast to every selected device, action recording, reusable scenarios, batch commands and proxy rotation.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)

[Download](https://github.com/asykixd/androidkit/releases/latest) · [Features](#features) · [Getting started](#getting-started) · [Scenarios](#scenarios) · [Building](#building-from-source)

</div>

> The interface is currently in Russian.

---

## Features

| | |
|---|---|
| 📺 **Live screens** | Every connected device in a grid, streamed via scrcpy 3.3.3 (H.264) and hardware-decoded with WebCodecs. |
| 🖱️ **Mouse control** | Click and drag to tap and swipe. The wheel scrolls and right-click sends **Back**. |
| 📡 **Broadcast input** | Taps and key presses on one selected device are repeated on all selected devices. |
| ⏺️ **Action recording** | Record what you do, either with a finger on the phone itself or with the mouse on its tile. Taps, swipes, keys, text, app launches and the pauses between them are saved as a scenario. |
| 🧩 **Scenarios** | Step editor with repeats (including infinite), a delay between runs, parallel runs on any set of devices, and import/export to JSON. |
| ⚡ **Batch actions** | Buttons, text input, app launch, APK install, screenshots, reboot and raw `adb shell` on many devices at once. |
| 🌐 **Proxies** | Import from a file (`type://host:port[:login[:password]]`) or from the CyberYozh API. Proxies are handed out round-robin through Android's system HTTP proxy, and you can check each device's IP. |

## Getting started

### Requirements

- **ADB** ([Android platform-tools](https://developer.android.com/tools/releases/platform-tools)). Evelin starts the ADB server on its own and looks for `adb` in:
  - `PATH`
  - on macOS: Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and `~/Library/Android/sdk/platform-tools`
  - on Windows: `%LOCALAPPDATA%\Android\Sdk\platform-tools`
- Android 5.0+ devices with **USB debugging** enabled. Accept the RSA prompt on each phone the first time it connects.

### Install

Download the latest build from [**Releases**](https://github.com/asykixd/androidkit/releases/latest):

| Platform | File |
|---|---|
| macOS, Apple Silicon | `Evelin-x.y.z-mac-arm64.dmg` |
| macOS, Intel | `Evelin-x.y.z-mac-x64.dmg` |
| Windows, installer | `Evelin-x.y.z-win-x64-setup.exe` |
| Windows, portable | `Evelin-x.y.z-win-x64.zip` |

> [!NOTE]
> Release builds are not signed with a paid certificate yet, so the OS will ask you to confirm the first launch.
> - **macOS:** if you see *"Evelin can't be opened"*, open **System Settings → Privacy & Security** and click **Open Anyway**. You can also run `xattr -cr /Applications/Evelin.app`.
> - **Windows:** in the SmartScreen dialog, click **More info → Run anyway**.

## Scenarios

A scenario is a list of steps that runs on one device or many in parallel.

| Step | What it does |
|---|---|
| Tap / Swipe / Gesture | Touch at a point. Coordinates are a percentage of the screen, so one scenario works across resolutions. *Gesture* replays a recorded finger path. |
| Key | Back, Home, Recents, Power, volume |
| Type text | Types text into the focused field |
| Pause | Fixed, or random within a min–max range |
| Launch / Stop app, Clear data | `monkey`, `am force-stop`, `pm clear` |
| Next proxy / Reset proxy | Takes the next proxy from the shared pool (each device gets its own) |
| ADB shell | Any command on the device |
| Run scenario | Nested scenarios, up to 5 levels deep |

**Every N-th run.** Any step can be set to run only on runs 1, N+1, 2N+1, and so on. For example, to change the proxy every 3 loops, make *Next proxy* the first step with N = 3 and repeat the scenario forever.

**Recording.** Open **Scenarios**, pick a device and press **● Record**. Touches on the phone itself are read through `getevent`, single finger only (multitouch isn't recorded). Actions you do in Evelin are captured directly. When you stop, the recording opens in the editor.

> [!WARNING]
> Imported scenarios can contain `ADB shell` steps. Evelin flags them on import. Review them before you run the scenario.

## Security

- The renderer runs with `contextIsolation` and `sandbox` on and `nodeIntegration` off. It can only reach a narrow, typed `window.farm` API.
- The main process validates every IPC argument: the sender, device serials, package names, and proxy hosts and ports. Scenarios from both the UI and imported files go through strict schema validation.
- Arguments built into device shell commands are escaped. Raw input runs only from the console and from `ADB shell` steps.
- The CyberYozh token and proxy credentials are encrypted at rest with Electron `safeStorage` (Keychain, DPAPI or libsecret).
- The CSP is strict. Navigation and new windows are blocked, and permission requests are denied.

## Building from source

You need Node.js 20+ and `adb` on `PATH`.

```bash
git clone https://github.com/asykixd/androidkit.git
cd androidkit
npm install          # postinstall downloads Electron and scrcpy-server
npm run dev          # dev mode with HMR
```

| Script | Description |
|---|---|
| `npm run dev` | Run in development with hot reload |
| `npm run typecheck` | TypeScript check for main and renderer |
| `npm run build && npm start` | Production build, run locally |
| `npm run dist:mac` | `.dmg` and `.zip` for arm64 and x64 into `release/<version>/` |
| `npm run dist:win` | NSIS installer and portable `.zip` for x64 |

If npm 11+ blocked install scripts, run `npm approve-scripts esbuild`, then `npm run postinstall`.

**Releases.** Push a `v*` tag. [GitHub Actions](.github/workflows/release.yml) builds on macOS and Windows runners and attaches the installers to a draft release.

```bash
npm version patch && git push --follow-tags
```

**Code signing.** macOS builds get an ad-hoc signature by default. To sign with a Developer ID, remove `identity: "-"` from `electron-builder.yml` and set `CSC_LINK` / `CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.

## Architecture

```
src/
├── main/       Electron main process. Owns all ADB access.
├── preload/    Typed window.farm bridge (contract: FarmApi in shared/types.ts)
├── renderer/   React UI
└── shared/     Types, scenario schema and validation
```

| File | Responsibility |
|---|---|
| `main/devices.ts` | `DeviceManager`: connection to the ADB server ([Tango](https://github.com/yume-chan/ya-webadb)), device tracking, shell, proxy settings |
| `main/mirror.ts` | `MirrorManager`: scrcpy session per device, video packets to the UI, touch/scroll/key/text input |
| `main/recording.ts` | Pure recording logic: `getevent` parsing and conversion of events to steps |
| `main/recorder.ts` | `Recorder`: records from the device and from the UI |
| `main/runner.ts` | `ScenarioRunner`: runs scenarios, cancellation via `AbortSignal` |
| `main/scenarios.ts` | `ScenarioStore`: persists to `userData/scenarios.json` |
| `main/proxies.ts` | `ProxyStore`: proxies from a file or CyberYozh |
| `main/index.ts` | Window, CSP, validated IPC handlers |
| `renderer/src/` | UI. `DeviceTile` decodes video with `WebCodecsVideoDecoder` |

**Updating scrcpy.** The version lives in `src/shared/scrcpy-version.json` and must match the `AdbScrcpyOptionsX_Y_Z` class used in `src/main/mirror.ts`.

## Acknowledgements

- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile, the screen-mirroring server
- [Tango / ya-webadb](https://github.com/yume-chan/ya-webadb) by yume-chan, ADB and scrcpy client for JavaScript
- [Electron](https://www.electronjs.org/), [electron-vite](https://electron-vite.org/), [electron-builder](https://www.electron.build/)

## License

[MIT](LICENSE) © 2026 asyki
