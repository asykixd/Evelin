"""Read-only smoke check of connected Android devices for the /device-check skill."""

import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
sys.path.insert(0, REPO_ROOT)

from device_controller import AndroidDeviceController, adb, u2  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "out")


def check_device(ctrl: AndroidDeviceController, info: dict) -> dict:
    serial = info["device_id"]
    report = dict(info)
    try:
        ctrl._ensure_session(serial)
        report["u2_session"] = True
    except Exception as e:
        report["u2_session"] = False
        report["u2_error"] = str(e)
    report["proxy"] = ctrl.get_proxy_status(serial)
    shot = ctrl.take_screenshot(serial, os.path.abspath(os.path.join(OUT_DIR, f"{serial}.png")))
    report["screenshot"] = shot.get("path") if shot.get("success") else f"failed: {shot.get('message')}"
    return report


def main() -> int:
    if adb is None:
        print(json.dumps({"error": "adbutils не установлен (pip install -r requirements.txt)"}))
        return 1
    if u2 is None:
        print(json.dumps({"warning": "uiautomator2 не установлен — проверка сессии будет пропущена"}))

    ctrl = AndroidDeviceController()
    devices = ctrl.scan_devices()
    wanted = sys.argv[1] if len(sys.argv) > 1 else None
    if wanted:
        devices = [d for d in devices if d["device_id"] == wanted]

    if not devices:
        print(json.dumps({"devices": [], "error": "Устройства не найдены" + (f": {wanted}" if wanted else "")}))
        return 1

    reports = [check_device(ctrl, d) for d in devices]
    ctrl.cleanup()
    print(json.dumps({"devices": reports}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
