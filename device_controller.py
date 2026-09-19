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
    """High-level Android device operations for TikTok automation.

    This class mirrors the iOS `DeviceController` API where practical,
    but uses uiautomator2/adb for Android.
    """

    def __init__(self):
        self.config = Config()
        self._sessions: Dict[str, object] = {}

    # --- Discovery ---
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
        """Install TikTok on device.

        Note: installing from Play Store is not automated here; supply an APK
        path or pre-install manually.
        """
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
        """Надежное нажатие через ADB"""
        x, y = int(x), int(y)
        time.sleep(1)  # Пауза перед нажатием
        try:
            d = adb.device(serial=device_id)
            d.shell(["input", "tap", str(x), str(y)])
            time.sleep(1)  # Пауза после нажатия
            return True
        except Exception:
            return False
    
        def reliable_tap(self, device_id: str, x: int, y: int) -> bool:
            """
            Универсальный надёжный тап (ADB + uiautomator2, с паузой).
            """
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

        def set_birth_date(self, device_id: str, year: int, month: int, day: int) -> bool:
            """
            Универсальный метод установки даты рождения через роллер/пикер.
            Можно доработать под конкретный UI.
            """
            # Пример: тап по координатам роллеров (можно заменить на свайпы/drag)
            # Координаты должны быть определены в COORDS или переданы явно
            coords = {
                "year": (600, 1200),
                "month": (420, 1200),
                "day": (270, 1200)
            }
            # Тап по каждому роллеру (можно заменить на свайп/drag для реального выбора)
            self.reliable_tap(device_id, *coords["year"])
            time.sleep(0.5)
            self.reliable_tap(device_id, *coords["month"])
            time.sleep(0.5)
            self.reliable_tap(device_id, *coords["day"])
            time.sleep(0.5)
            # Здесь можно добавить логику свайпа/drag для точного выбора значения
            return True
    def wake_device(self, device_id: str) -> bool:
        """Пробуждаем устройство"""
        try:
            d = adb.device(serial=device_id)
            sess = self._ensure_session(device_id)
            
            # Включаем экран
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
        """Установить HTTP proxy на устройстве."""
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
        """Сбросить HTTP proxy на устройстве."""
        if not adb:
            return False
        try:
            d = adb.device(serial=device_id)
            d.shell(["settings", "put", "global", "http_proxy", ""])
            return d.shell(["settings", "get", "global", "http_proxy"]).strip() == ""
        except Exception:
            return False

    def get_proxy_status(self, device_id: str) -> dict:
        """Получить текущий статус proxy."""
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
        """Проверить работу proxy через curl."""
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
        """Попытка установить Wi-Fi proxy через системные настройки (может не работать на всех устройствах)."""
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
        """Выполнить ADB команду на устройстве"""
        if adb is None:
            return {"success": False, "error": "ADB не доступен"}
        try:
            d = adb.device(serial=device_id)
            
            # Разбираем команду на части
            if command.startswith("shell "):
                # Убираем "shell " и разбиваем на команды
                shell_command = command[6:].split()
                result = d.shell(shell_command)
            else:
                # Выполняем как обычную ADB команду
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

    def set_date_picker(self, device_id: str, day: int = 5, month: int = 3, year: int = 1994) -> Dict:
        """Устанавливает дату в роллерах выбора даты (только год 1994)"""
        try:
            console.print(f"[blue]📅 Устанавливаем год: {year}[/blue]")
            
            # Загружаем координаты из config.json
            try:
                with open('config.json', 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
                ui_coordinates = config_data.get('ui_coordinates', {})
            except:
                ui_coordinates = {}
            
            # Получаем координаты роллера года
            year_coords = ui_coordinates.get('birth_year', {'x': 559, 'y': 1153})
            
            # Устанавливаем только год (1994)
            result_year = self._set_picker_value(device_id, year_coords['x'], year_coords['y'], year, "year")
            
            if result_year.get("success"):
                console.print(f"[green]✅ Год установлен: {year}[/green]")
                return {"success": True, "year": year}
            else:
                error_msg = f"Ошибка установки года: {result_year.get('error', 'unknown')}"
                console.print(f"[red]❌ {error_msg}[/red]")
                return {"success": False, "error": error_msg}
                
        except Exception as e:
            error_msg = f"Критическая ошибка установки года: {str(e)}"
            console.print(f"[red]❌ {error_msg}[/red]")
            return {"success": False, "error": error_msg}
    
    def _set_picker_value(self, device_id: str, x: int, y: int, target_value: int, picker_type: str) -> Dict:
        """Устанавливает значение в роллере (колесике выбора)"""
        try:
            console.print(f"[blue]🎯 Устанавливаем {picker_type}: {target_value} в координатах ({x}, {y})[/blue]")
            
            # Сначала нажимаем на роллер для активации
            self.tap(device_id, x, y)
            time.sleep(0.5)
            
            # Определяем стратегию в зависимости от типа
            if picker_type == "day":
                # Для дня: устанавливаем 5
                return self._scroll_to_day(device_id, x, y, target_value)
            elif picker_type == "month":
                # Для месяца: устанавливаем март (3)
                return self._scroll_to_month(device_id, x, y, target_value)
            elif picker_type == "year":
                # Для года: устанавливаем 1994
                return self._scroll_to_year(device_id, x, y, target_value)
            else:
                return {"success": False, "error": f"Неизвестный тип роллера: {picker_type}"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _scroll_to_day(self, device_id: str, x: int, y: int, target_day: int) -> Dict:
        """Прокручивает роллер дня до нужного значения (5)"""
        try:
            # TikTok ставит сегодняшнюю дату, например 19 августа
            # Нужно прокрутить от текущего дня до 5
            from datetime import datetime
            current_day = datetime.now().day
            
            if current_day > target_day:
                # Нужно прокрутить вверх (к меньшим числам)
                swipes_needed = current_day - target_day
                direction = "up"
            else:
                # Нужно прокрутить вниз (к большим числам)
                swipes_needed = target_day - current_day
                direction = "down"
            
            console.print(f"[blue]📅 Прокручиваем день: от {current_day} до {target_day}, {swipes_needed} свайпов {direction}[/blue]")
            
            for i in range(swipes_needed):
                if direction == "up":
                    self.swipe(device_id, x, y + 20, x, y - 20, 0.2)  # Свайп вверх
                else:
                    self.swipe(device_id, x, y - 20, x, y + 20, 0.2)  # Свайп вниз
                time.sleep(0.3)
            
            self.tap(device_id, x, y)
            time.sleep(0.5)
            
            console.print(f"[green]✅ День установлен: {target_day}[/green]")
            return {"success": True, "value": target_day}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _scroll_to_month(self, device_id: str, x: int, y: int, target_month: int) -> Dict:
        """Прокручивает роллер месяца до нужного значения (март = 3)"""
        try:
            # TikTok ставит сегодняшний месяц, например август (8)
            from datetime import datetime
            current_month = datetime.now().month
            
            if current_month > target_month:
                # Нужно прокрутить вверх (к меньшим месяцам)
                swipes_needed = current_month - target_month
                direction = "up"
            else:
                # Нужно прокрутить вниз (к большим месяцам)
                swipes_needed = target_month - current_month
                direction = "down"
            
            console.print(f"[blue]📅 Прокручиваем месяц: от {current_month} до {target_month}, {swipes_needed} свайпов {direction}[/blue]")
            
            for i in range(swipes_needed):
                if direction == "up":
                    self.swipe(device_id, x, y + 20, x, y - 20, 0.2)  # Свайп вверх
                else:
                    self.swipe(device_id, x, y - 20, x, y + 20, 0.2)  # Свайп вниз
                time.sleep(0.3)
            
            self.tap(device_id, x, y)
            time.sleep(0.5)
            
            console.print(f"[green]✅ Месяц установлен: {target_month} (март)[/green]")
            return {"success": True, "value": target_month}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _scroll_to_year(self, device_id: str, x: int, y: int, target_year: int) -> Dict:
        """Прокручивает роллер года до нужного значения"""
        try:
            # Сначала стабилизируем роллер
            console.print(f"[blue]📅 Стабилизируем роллер года...[/blue]")
            self.tap(device_id, x, y)
            time.sleep(1)
            
            # TikTok по умолчанию ставит текущий год минус 1
            from datetime import datetime
            current_year = datetime.now().year - 1
            
            # Рассчитываем количество свайпов
            if current_year > target_year:
                swipes_needed = current_year - target_year
                direction = "down"  # Свайп вниз (к меньшим годам)
            else:
                swipes_needed = target_year - current_year
                direction = "up"    # Свайп вверх (к большим годам)
            
            console.print(f"[blue]📅 Прокручиваем год: от {current_year} до {target_year}, {swipes_needed} свайпов {direction}[/blue]")
            
            # Ограничиваем до 21 свайпа
            max_swipes = min(swipes_needed, 21)
            
            # Быстрые свайпы с большим расстоянием
            for i in range(max_swipes):
                if direction == "down":
                    # Свайп вниз (к меньшим годам) - 60 пикселей
                    self.swipe(device_id, x, y - 60, x, y + 60, 0.2)
                else:
                    # Свайп вверх (к большим годам) - 60 пикселей
                    self.swipe(device_id, x, y + 60, x, y - 60, 0.2)
                
                time.sleep(0.1)
                
                if (i + 1) % 10 == 0:
                    console.print(f"[blue]📅 Свайп {i+1}/{max_swipes}[/blue]")
            
            # Финальная стабилизация
            console.print(f"[blue]📅 Финальная стабилизация...[/blue]")
            self.tap(device_id, x, y)
            time.sleep(1)
            
            console.print(f"[green]✅ Год установлен: {target_year} (выполнено {max_swipes} свайпов)[/green]")
            return {"success": True, "value": target_year, "swipes_performed": max_swipes}
            
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Cleanup ---
    def cleanup(self):
        for serial, sess in list(self._sessions.items()):
            try:
                # uiautomator2 does not require explicit close, but we may stop app
                pass
            except Exception:
                pass
        self._sessions.clear()
