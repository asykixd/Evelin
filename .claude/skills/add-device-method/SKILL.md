---
name: add-device-method
description: Conventions for adding or changing methods on AndroidDeviceController in device_controller.py (return shapes, adb vs uiautomator2 access, error handling, Russian strings). Use whenever writing device-control code in this repo.
user-invocable: false
---

# Adding a method to `AndroidDeviceController`

## Rules

1. **Never raise to the caller.** Wrap the body in `try/except Exception`.
   - Simple yes/no actions → return `bool`.
   - Anything returning data or needing an error reason → return a dict:
     `{"success": True, ...data}` or `{"success": False, "error": str(e)}`.
     (Older methods use `"message"` for the error; prefer `"error"` in new code.)
2. **Guard optional imports first.** `adb` and `u2` may be `None`:
   - bool methods: `if adb is None: return False`
   - dict methods: `if adb is None: return {"success": False, "error": "ADB не доступен"}`
3. **Pick the access path:**
   - Raw shell / settings / input events / packages → `d = adb.device(serial=device_id)` then `d.shell([...])`.
     Always pass shell args as a **list**, never an interpolated string (avoids shell injection from proxy hosts, package names, etc.).
   - UI-level actions (app_start, press, click on selectors, screenshot, screen_on) → `sess = self._ensure_session(device_id)`. Never call `u2.connect*` directly; the session cache in `self._sessions` must be reused.
4. **Verify state-changing settings.** After `settings put`, read back with `settings get` and return whether it matches (see `set_http_proxy`).
5. **Strings:** user-facing error strings and log messages in Russian, consistent with the file. Code identifiers in English.
6. **Placement:** put the method under the matching `# --- Section ---` comment (App management / Interactions / Proxy configuration), at class indentation (4 spaces) — watch out for the existing `reliable_tap` bug, which is accidentally nested inside `tap`.
7. **Never log secrets.** Proxy login/password and API tokens must not appear in return values, prints, or logs.

## Template

```python
    def get_battery_level(self, device_id: str) -> Dict:
        if adb is None:
            return {"success": False, "error": "ADB не доступен"}
        try:
            d = adb.device(serial=device_id)
            out = d.shell(["dumpsys", "battery"])
            for line in out.splitlines():
                if "level:" in line:
                    return {"success": True, "level": int(line.split(":")[1].strip())}
            return {"success": False, "error": "Уровень заряда не найден"}
        except Exception as e:
            return {"success": False, "error": str(e)}
```
