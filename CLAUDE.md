# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Evelin** — Electron + React + TypeScript desktop app for managing a farm of USB-connected Android devices: live screens (scrcpy), input control with broadcast, action recording, scenarios (presets), batch actions and proxy management. See `README.md` for features and architecture. The original Python toolkit was removed; its proxy logic lives on in `src/main/proxies.ts`.

Instagram/TikTok registration automation is intentionally out of scope — don't add platform-specific account-creation logic.

## Commands

```bash
npm install          # postinstall downloads Electron + scrcpy-server into resources/
npm run dev          # electron-vite dev with HMR
npm run typecheck    # TypeScript check for main + renderer (no linter)
npm test             # vitest unit tests in test/ (pure modules; mock `electron` with vi.mock)
npm run build && npm start
npm run dist:mac     # electron-builder → release/<version>/ (dist:win needs Windows/Rosetta for NSIS)
```

Packaging config is `electron-builder.yml` (incl. `electronFuses` — don't weaken them); `resources/scrcpy-server` ships via `extraResources`; `scripts/fetch-server.mjs` checks it against `SCRCPY_SERVER_SHA256` in `src/shared/scrcpy-version.json` — update both fields together when bumping scrcpy. Tagging `v*` triggers `.github/workflows/release.yml` (draft GitHub release); `.github/workflows/ci.yml` runs typecheck + tests on push/PR. Actions are pinned by commit SHA.

Requires `adb` on PATH. Renderer warnings/errors are forwarded to the terminal in dev.

## Architecture notes

- Main process owns all ADB access via Tango (`@yume-chan/*`) talking to the local ADB server; renderer only sees `window.farm` (`FarmApi` in `src/shared/types.ts`). New capabilities = add to `FarmApi`, preload, and a validated `handle(...)` in `src/main/index.ts`.
- **Gotcha:** Tango's `subprocess.noneProtocol.spawn*` joins array args with spaces **without escaping**. Build device shell commands with `shellCommand(...)` from `src/main/devices.ts`.
- Video: `MirrorManager` streams H.264 packets over IPC; `DeviceTile` decodes with `WebCodecsVideoDecoder` + `BitmapVideoFrameRenderer` (not WebGL — Chromium caps WebGL contexts at ~16).
- Touch coordinates are normalized 0..1 everywhere (IPC, scenarios), scaled to video size in `mirror.ts`.
- Scenarios: schema + validation in `src/shared/scenario.ts` (used for UI saves and file imports — keep it strict when adding step types; also add `step.<type>` strings to both dictionaries in `src/shared/i18n.ts`, and update `newStep`, `describeStep`, runner `#step`, and `StepParams` in the editor). `src/main/recording.ts` and `src/main/uiautomator.ts` are pure (no ADB) so they can be tested in isolation.
- Auto-update (`src/main/updater.ts`): polls GitHub `releases/latest`, compares with `app.getVersion()`, asks before downloading. Install in place only for the macOS `.app` (downloads the `-mac-<arch>.zip`, swaps the bundle via a detached shell script after quit — Squirrel.Mac can't be used with ad-hoc signing) and NSIS installs (runs `-setup.exe --updated /S`). Asset names come from `artifactName` in `electron-builder.yml` — keep them in sync. Draft releases are invisible to clients until published. Assets without a GitHub `sha256` digest are refused.
- Main-process methods report failures as `DeviceResult { success, error }` rather than throwing across IPC where batch semantics apply.

## Conventions

- Comments are in English and sparse: only where the *why* isn't obvious from the code. User-facing strings (UI, errors from main, dialog titles) go through `t()` from `src/shared/i18n.ts`; add every new key to both the `ru` and `en` dictionaries (`en` is typed as `Record<MessageKey, string>`, so a missing key fails typecheck). Console logs stay in Russian, untranslated.
- Settings: `AppSettings` in `src/shared/types.ts`, defaults + strict validation in `src/shared/settings.ts`, stored by `SettingsStore` (`userData/settings.json`, not secret). Renderer reads them through `useSettings()` / `useT()` from `src/renderer/src/settings.tsx`. The CyberYozh key stays in the encrypted `ProxyStore`, not in settings.
- Secrets: `api_keys.json` / `proxies.txt` are gitignored; app secrets are stored encrypted with `safeStorage` in Electron `userData`.
