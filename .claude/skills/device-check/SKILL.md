---
name: device-check
description: Smoke-check USB-connected Android devices — list devices, verify uiautomator2 session, show current global http_proxy, and take a screenshot. Run before any on-device work.
disable-model-invocation: true
argument-hint: "[device_serial]"
---

# Device check

Touches real hardware, so it's user-invoked only.

1. Confirm `adb` is on PATH (`command -v adb`). If not, stop and tell the user to run `brew install android-platform-tools`.
2. Run the bundled script from the repo root (it imports `device_controller.py`):

   ```bash
   python3 .claude/skills/device-check/scripts/check.py $ARGUMENTS
   ```

   With no argument it checks every connected device; with a serial it checks just that one.
3. The script prints a JSON report per device: model/brand/Android version, whether a `uiautomator2` session could be opened, the current `settings get global http_proxy`, and the path of a screenshot saved to `.claude/skills/device-check/out/<serial>.png`.
4. Read the screenshot(s) with the Read tool and summarize: which devices are ready, which have a proxy set, and any failure (e.g. `unauthorized` → user must accept the USB-debugging prompt on the phone; u2 failure → agent not installed yet, first connect installs it).

Do not change device state (no proxy changes, no app launches) as part of this check.
