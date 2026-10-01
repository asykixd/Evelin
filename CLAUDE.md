# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Evelin** — Electron + React + TypeScript desktop app for managing a farm of USB-connected Android devices: live screens (scrcpy), input control with broadcast, action recording, scenarios (presets), batch actions and proxy management. See `README.md` for features and architecture. The original Python toolkit was removed; its proxy logic lives on in `src/main/proxies.ts`.

Instagram/TikTok registration automation is intentionally out of scope — don't add platform-specific account-creation logic.

## Commands

```bash
npm install          # postinstall downloads Electron + scrcpy-server into resources/
npm run dev          # electron-vite dev with HMR
npm run typecheck    # the only static check (no tests/linter)
npm run build && npm start
npm run dist:mac     # electron-builder → release/<version>/ (dist:win needs Windows/Rosetta for NSIS)
```

Packaging config is `electron-builder.yml`; `resources/scrcpy-server` ships via `extraResources`. Tagging `v*` triggers `.github/workflows/release.yml` (draft GitHub release).

Requires `adb` on PATH. Renderer warnings/errors are forwarded to the terminal in dev.

## Architecture notes

- Main process owns all ADB access via Tango (`@yume-chan/*`) talking to the local ADB server; renderer only sees `window.farm` (`FarmApi` in `src/shared/types.ts`). New capabilities = add to `FarmApi`, preload, and a validated `handle(...)` in `src/main/index.ts`.
- **Gotcha:** Tango's `subprocess.noneProtocol.spawn*` joins array args with spaces **without escaping**. Build device shell commands with `shellCommand(...)` from `src/main/devices.ts`.
- Video: `MirrorManager` streams H.264 packets over IPC; `DeviceTile` decodes with `WebCodecsVideoDecoder` + `BitmapVideoFrameRenderer` (not WebGL — Chromium caps WebGL contexts at ~16).
- Touch coordinates are normalized 0..1 everywhere (IPC, scenarios), scaled to video size in `mirror.ts`.
- Scenarios: schema + validation in `src/shared/scenario.ts` (used for UI saves and file imports — keep it strict when adding step types; also update `STEP_LABELS`, `newStep`, `describeStep`, runner `#step`, and `StepParams` in the editor). `src/main/recording.ts` is pure (no ADB) so it can be tested in isolation.
- Main-process methods report failures as `DeviceResult { success, error }` rather than throwing across IPC where batch semantics apply.

## Conventions

- UI strings, comments and errors are in Russian.
- Secrets: `api_keys.json` / `proxies.txt` are gitignored; app secrets are stored encrypted with `safeStorage` in Electron `userData`.
