"""
Android Device Controller based on uiautomator2 and adbutils
"""

from __future__ import annotations

import os
import time
import logging
import json
from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime
from rich.console import Console

try:
    import uiautomator2 as u2  # type: ignore
except Exception:  # pragma: no cover
    u2 = None  # type: ignore

try:
    from adbutils import adb  # type: ignore
except Exception: # pragma: no cover
    adb = None  # type: ignore

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
console = Console()


# Простая заглушка для Config - можно заменить на реальную реализацию
class Config:
    def __init__(self):
        self._config = {}
    
    def get(self, key, default=None):
        return self._config.get(key, default)
    
    def set(self, key, value):
        self._config[key] = value


@dataclass
class AndroidDevice:
    serial: str
    model: Optional[str]
    android_version: Optional[str]
    brand: Optional[str]
    connected: bool = True


class AndroidDeviceController:
    def __init__(self):
        self.config = Config()
        self._sessions: Dict[str, object] = {}

    def scan_devices(self) -> List[Dict]:
        devices: List[Dict] = []
        if adb is None:
            return devices
        try:
            for d in adb.device_list():  # type: ignore[attr-defined]
                try:
                    props = d.getprop()
                    devices.append({
                        "device_id": d.serial,
                        "device_name": props.get("ro.product.model") or d.serial,
                        "platform": "Android",
                        "android_version": props.get("ro.build.version.release"),
                        "brand": props.get("ro.product.brand"),
                        "connected": True
                    })
                except Exception as e:
                    # Fallback: basic device info without properties
                    devices.append({
                        "device_id": d.serial,
                        "device_name": d.serial,
                        "platform": "Android",
                        "android_version": "Unknown",
                        "brand": "Unknown",
                        "connected": True
                    })
        except Exception:
            pass
        return devices

    def _ensure_session(self, serial: str):
        if serial in self._sessions:
            return self._sessions[serial]
        if u2 is None:
            raise RuntimeError("uiautomator2 is not installed")
        sess = u2.connect_usb(serial)
        # Improve reliability
        try:
            sess.set_new_command_timeout(300)
        except Exception:
            pass
        self._sessions[serial] = sess
        return sess

    # --- App management ---
    def is_app_installed(self, device_id: str, package: str) -> bool:
        if adb is None:
            return False
        try:
            d = adb.device(serial=device_id)
            out = d.shell(["pm", "list", "packages", package])
            return package in out
        except Exception:
            return False

    def install_tiktok(self, device_id: str, apk_path: Optional[str] = None) -> bool:
        package = "com.zhiliaoapp.musically"
        if self.is_app_installed(device_id, package):
            return True
        if not apk_path:
            return False
        try:
            d = adb.device(serial=device_id)
            d.install(apk_path, reinstall=True)
            time.sleep(1)
            return self.is_app_installed(device_id, package)
        except Exception:
            return False

    def launch_app(self, device_id: str, package: str) -> Dict:
        try:
            sess = self._ensure_session(device_id)
            sess.app_start(package, use_monkey=False)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def open_tiktok(self, device_id: str) -> bool:
        result = self.launch_app(device_id, "com.zhiliaoapp.musically")
        return bool(result.get("success"))

    def go_to_home_screen(self, device_id: str) -> bool:
        try:
            sess = self._ensure_session(device_id)
            sess.press("home")
            return True
        except Exception:
            return False

    # --- Interactions ---
    def tap(self, device_id: str, x: int, y: int) -> bool:
        x, y = int(x), int(y)
        time.sleep(1)
        try:
            d = adb.device(serial=device_id)
            d.shell(["input", "tap", str(x), str(y)])
            time.sleep(1)
            return True
        except Exception:
            return False
    
        def reliable_tap(self, device_id: str, x: int, y: int) -> bool:
            x, y = int(x), int(y)
            time.sleep(0.5)
            try:
                if adb:
                    d = adb.device(serial=device_id)
                    d.shell(["input", "tap", str(x), str(y)])
                    time.sleep(1)
                    return True
            except Exception:
                pass
            try:
                sess = self._ensure_session(device_id)
                sess.click(x, y)
                time.sleep(1)
                return True
            except Exception:
                pass
            return False

    def wake_device(self, device_id: str) -> bool:
        try:
            d = adb.device(serial=device_id)
            sess = self._ensure_session(device_id)
            d.shell(["input", "keyevent", "KEYCODE_WAKEUP"])
            d.shell(["input", "keyevent", "KEYCODE_MENU"])
            sess.screen_on()
            sess.wake_up()
            
            time.sleep(1)
            return True
        except:
            return False
    

    def take_screenshot(self, device_id: str, output_path: str) -> Dict:
        try:
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            sess = self._ensure_session(device_id)
            sess.screenshot(output_path)
            return {"success": True, "path": output_path}
        except Exception as e:
            return {"success": False, "message": str(e)}


    # --- Proxy configuration ---
    def set_http_proxy(self, device_id: str, host: str, port: int) -> bool:
        if not adb:
            return False
        try:
            d = adb.device(serial=device_id)
            proxy = f"{host}:{port}"
            d.shell(["settings", "put", "global", "http_proxy", proxy])
            return d.shell(["settings", "get", "global", "http_proxy"]).strip() == proxy
        except Exception:
            return False

    def clear_http_proxy(self, device_id: str) -> bool:
        if not adb:
            return False
        try:
            d = adb.device(serial=device_id)
            d.shell(["settings", "put", "global", "http_proxy", ""])
            return d.shell(["settings", "get", "global", "http_proxy"]).strip() == ""
        except Exception:
            return False

    def get_proxy_status(self, device_id: str) -> dict:
        if not adb:
            return {"success": False, "error": "ADB не доступен"}
        try:
            d = adb.device(serial=device_id)
            proxy = d.shell(["settings", "get", "global", "http_proxy"]).strip()
            return {
                "success": True,
                "proxy": proxy,
                "enabled": bool(proxy)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def test_proxy_connection(self, device_id: str, test_url: str = "http://httpbin.org/ip") -> dict:
        if not adb:
            return {"success": False, "error": "ADB не доступен"}
        try:
            d = adb.device(serial=device_id)
            curl_installed = "curl" in d.shell(["which", "curl"])
            if not curl_installed:
                return {"success": False, "error": "curl не установлен"}
            result = d.shell(["curl", "-s", test_url])
            return {"success": True, "response": result.strip()}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_wifi_proxy_via_ui(self, device_id: str, ssid: str, host: str, port: int) -> bool:
        # may not work on some devices
        if not adb:
            return False
        try:
            d = adb.device(serial=device_id)
            proxy = f"{host}:{port}"
            d.shell(["settings", "put", "global", "wifi_proxy", proxy])
            return d.shell(["settings", "get", "global", "wifi_proxy"]).strip() == proxy
        except Exception:
            return False

    def execute_adb_command(self, device_id: str, command: str) -> Dict:
        if adb is None:
            return {"success": False, "error": "ADB не доступен"}
        try:
            d = adb.device(serial=device_id)
            
            if command.startswith("shell "):
                shell_command = command[6:].split()
                result = d.shell(shell_command)
            else:
                result = d.shell([command])
            
            return {
                "success": True,
                "output": result,
                "command": command
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "command": command
            }

    def cleanup(self):
        for serial, sess in list(self._sessions.items()):
            try:
                # uiautomator2 does not require explicit close, but we may stop app
                pass
            except Exception:
                pass
        self._sessions.clear()
