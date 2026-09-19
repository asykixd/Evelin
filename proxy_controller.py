import uiautomator2 as u2
"""
proxy_controller.py — идеальный оператор для управления HTTPS и SOCKS5 прокси, с поддержкой CyberYozh API
"""

import requests
import os
import json
from typing import List, Dict, Optional
from config_api import load_api_keys

class ProxyController:
    def setup_proxydroid(self, device_id, proxy):
        """
        Автоматически настраивает ProxyDroid на Android-устройстве через uiautomator2.
        Требуется установленное приложение ProxyDroid и подключенное устройство.
        """
        d = u2.connect_usb(device_id)
        d.app_start("org.proxydroid")
        d(text="Host").set_text(proxy["host"])
        d(text="Port").set_text(str(proxy["port"]))
        if proxy.get("login"):
            d(text="Username").set_text(proxy["login"])
        if proxy.get("password"):
            d(text="Password").set_text(proxy["password"])
        d(text="Start").click()
        print(f"ProxyDroid настроен: {proxy['host']}:{proxy['port']}")
    def __init__(self, proxies_file: str = "proxies.txt"):
        self.proxies_file = proxies_file
        self.api_keys = load_api_keys()
        self.cyberyozh_token = self.api_keys.get("cyberyozh_token")
        self.current_proxy = None
        self.proxies = self._load_proxies()
        self.cyberyozh_proxies = []
        self.cyberyozh_index = 0
        if self.cyberyozh_token:
            self._fetch_cyberyozh_proxies()

    def _load_proxies(self) -> List[Dict]:
        proxies = []
        if os.path.exists(self.proxies_file):
            with open(self.proxies_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    # Формат: type://host:port:login:password
                    parts = line.split("://")
                    if len(parts) == 2:
                        proto, rest = parts
                        host_port_login_pass = rest.split(":")
                        if len(host_port_login_pass) >= 2:
                            host = host_port_login_pass[0]
                            port = host_port_login_pass[1]
                            login = host_port_login_pass[2] if len(host_port_login_pass) > 2 else ""
                            password = host_port_login_pass[3] if len(host_port_login_pass) > 3 else ""
                            proxies.append({
                                "type": proto,
                                "host": host,
                                "port": port,
                                "login": login,
                                "password": password
                            })
        return proxies

    def _fetch_cyberyozh_proxies(self):
        url = "https://app.cyberyozh.com/api/v1/proxies/history/"
        headers = {"accept": "application/json", "X-Api-Key": self.cyberyozh_token}
        try:
            r = requests.get(url, headers=headers, timeout=30)
            data = r.json()
            proxies_list = []
            if isinstance(data, dict) and "results" in data:
                proxies_list = data["results"]
            elif isinstance(data, list):
                proxies_list = data
            else:
                print(f"[ProxyController] Некорректный ответ от CyberYozh: {data}")
                self.cyberyozh_proxies = []
                return
            self.cyberyozh_proxies = [p for p in proxies_list if isinstance(p, dict) and p.get("system_status") == "active"]
        except Exception as e:
            print(f"[ProxyController] Ошибка получения прокси CyberYozh: {e}")
            self.cyberyozh_proxies = []

    def set_proxy(self, proxy: Optional[Dict] = None) -> bool:
        """
        Устанавливает HTTPS/SOCKS5 прокси на устройство (или в систему).
        Если proxy не указан — берёт следующий из списка.
        """
        if proxy is None:
            proxy = self.get_next_proxy()
        if not proxy:
            print("[ProxyController] Нет доступных прокси!")
            return False
        self.current_proxy = proxy
        # Здесь должна быть интеграция с Android/iOS/Windows для установки прокси
        # Например, через adb shell settings или сторонние приложения
        print(f"[ProxyController] Установлен прокси: {proxy}")
        return True

    def remove_proxy(self) -> bool:
        """
        Удаляет текущий прокси (сбрасывает настройки).
        """
        self.current_proxy = None
        # Здесь должна быть интеграция для сброса прокси
        print("[ProxyController] Прокси удалён.")
        return True

    def get_next_proxy(self) -> Optional[Dict]:
        """
        Возвращает следующий прокси из списка (с ротацией CyberYozh).
        """
        # Сначала используем CyberYozh, если есть
        if self.cyberyozh_proxies:
            proxy = self.cyberyozh_proxies[self.cyberyozh_index % len(self.cyberyozh_proxies)]
            self.cyberyozh_index += 1
            return {
                "type": proxy["url"].split(":")[0],
                "host": proxy["url"].split("//")[1].split(":")[0],
                "port": proxy["url"].split(":")[2],
                "login": proxy.get("connection_login", ""),
                "password": proxy.get("connection_password", "")
            }
        # Если нет CyberYozh — используем локальные
        if self.proxies:
            idx = self.cyberyozh_index % len(self.proxies)
            self.cyberyozh_index += 1
            return self.proxies[idx]
        return None

    def rotate_proxy(self):
        """
        Ротирует прокси после каждого аккаунта (вызывает set_proxy с новым прокси).
        """
        proxy = self.get_next_proxy()
        self.set_proxy(proxy)

# Пример использования:
if __name__ == "__main__":
    pc = ProxyController()
    pc.set_proxy()  # Установить первый прокси
    # ...
    pc.rotate_proxy()  # Ротировать после аккаунта
    pc.remove_proxy()  # Удалить прокси
