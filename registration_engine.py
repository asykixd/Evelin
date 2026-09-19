"""
registration_engine.py — универсальный движок для регистрации TikTok аккаунтов
"""

import os
import time
from rich.console import Console
from coords import COORDS
from device_controller import AndroidDeviceController
from services.anymessage_api import AnyMessageAPI
from config_api import load_api_keys
from services.firstmail_api import FirstMailAPI

# --- API-заглушки / функции получения почт с токенами из config ---
def get_anymessage_email(site="tiktok.com", domain="outlook.com"):
    api_keys = load_api_keys()
    token = api_keys.get("anymessage_token", "your_token_here")
    api = AnyMessageAPI(token)
    order = api.order_email(site=site, domain=domain)
    if order.get("status") == "success":
        email = order["email"]
        return email, ""
    else:
        raise Exception(f"AnyMessage API error: {order}")

def get_notletters_email():
    api_keys = load_api_keys()
    token = api_keys.get("notletters_token", "your_notletters_token_here")
    # Заглушка: имитируем выдачу почты notletters.com, используем токен (если есть)
    unique = int(time.time())
    return f"user{unique}@notletters.com", "Pwd!23456"

def get_firstmail_email(type_id=3):
    api_keys = load_api_keys()
    token = api_keys.get("firstmail_token")
    if not token:
        raise Exception("FirstMail API token not found in config!")
    api = FirstMailAPI(token)
    if not hasattr(get_firstmail_email, "api_instance"):
        get_firstmail_email.api_instance = api
        api.buy_emails(type_id=type_id, count=100)
    username, password = get_firstmail_email.api_instance.get_next_email()
    if username and password:
        return username, password
    else:
        # Автоматически покупаем новую пачку и пробуем снова
        get_firstmail_email.api_instance.buy_emails(type_id=type_id, count=100)
        username, password = get_firstmail_email.api_instance.get_next_email()
        if username and password:
            return username, password
        else:
            raise Exception("No more emails available from FirstMail API after repurchase!")

def get_gmail_email(gmail_file: str | None = None):
    """Получить Gmail логин:пароль.
    Если в config есть gmail_token — используем заглушку на его основе (без реального API),
    иначе читаем первую строку из gmail.txt формата login:password.
    """
    api_keys = load_api_keys()
    gmail_token = api_keys.get("gmail_token")
    if gmail_token:
        unique = int(time.time())
        # Заглушка: формируем уникальный email и фиксированный пароль
        return f"user{unique}@gmail.com", "Pwd!23456"
    # Fallback к файлу
    file_path = gmail_file or "gmail.txt"
    with open(file_path, encoding="utf-8") as f:
        line = f.readline().strip()
        login, password = line.split(":", 1)
        return login, password

# --- Координаты для разных методов ---
# Общий набор координат для e-mail регистрации (без OTP)
BASE_EMAIL_FLOW_COORDS = {
    # Навигация
    "profile_tab": COORDS.get("profile_tab", {"x": 965, "y": 2190}),
    "signup_button": COORDS.get("signup_button", {"x": 540, "y": 1980}),
    "phone_or_email": COORDS.get("phone_or_email", {"x": 540, "y": 980}),
    "email_option": COORDS.get("email_option", {"x": 820, "y": 380}),

    # Ввод email/пароля
    "email_field": COORDS.get("email_field", {"x": 300, "y": 620}),
    "continue_after_email": COORDS.get("continue_after_email", {"x": 540, "y": 1150}),
    "password_field": COORDS.get("password_field", {"x": 300, "y": 1320}),
    "continue_after_password": COORDS.get("continue_after_password", {"x": 540, "y": 1500}),

    # Дата рождения
    "birth_day": COORDS.get("birth_day", {"x": 360, "y": 1900}),
    "birth_month": COORDS.get("birth_month", {"x": 540, "y": 1900}),
    "birth_year": COORDS.get("birth_year", {"x": 860, "y": 1900}),
    "confirm_birth_date": COORDS.get("confirm_birth_date", {"x": 540, "y": 1200}),

    # Username (опционально)
    "username_field": COORDS.get("username_field", {"x": 300, "y": 1050}),
    "continue_after_username": COORDS.get("continue_after_username", {"x": 540, "y": 1500}),

    # Финальные шаги
    "ok_button": COORDS.get("ok_button", {"x": 820, "y": 1560}),
    "profile_button": COORDS.get("profile_button", {"x": 120, "y": 220}),
}

# Для Gmail допускаем корректировку роллеров даты (если разметка иная)
GMAIL_COORDS = dict(BASE_EMAIL_FLOW_COORDS)
GMAIL_COORDS.update({
    "birth_day": {"x": 360, "y": 1900},
    "birth_month": COORDS.get("birth_month", {"x": 540, "y": 1900}),
    "birth_year": COORDS.get("birth_year", {"x": 860, "y": 1900}),
})

# AnyMessage / NotLetters / FirstMail используют тот же UI-поток email-регистрации
ANYMESSAGE_COORDS = dict(BASE_EMAIL_FLOW_COORDS)
NOTLETTERS_COORDS = dict(BASE_EMAIL_FLOW_COORDS)
FIRSTMAIL_COORDS = dict(BASE_EMAIL_FLOW_COORDS)

REG_METHOD_COORDS = {
    "anymessage": ANYMESSAGE_COORDS,
    "notletters": NOTLETTERS_COORDS,
    "firstmail": FIRSTMAIL_COORDS,
    "gmail": GMAIL_COORDS,
}

# Нумерация методов для логов/сохранения
METHOD_NUMBERS = {
    "anymessage": 1,
    "notletters": 2,
    "gmail": 3,
    "firstmail": 4,
}

# --- Файлы ---
PROXIES_FILE = "proxies.txt"
ACCOUNTS_FILE = "accounts.txt"

# --- Вспомогательные функции ---
def ensure_file_exists(filename):
    if not os.path.exists(filename):
        with open(filename, "w", encoding="utf-8") as f:
            pass

# --- Основной класс ---
class RegistrationEngine:
    def __init__(self):
        self.console = Console()
        self.controller = AndroidDeviceController()
        ensure_file_exists(PROXIES_FILE)
        ensure_file_exists(ACCOUNTS_FILE)

    def select_method(self):
        methods = ["anymessage", "notletters", "gmail", "firstmail"]
        self.console.print("[bold blue]Выберите метод регистрации:[/bold blue]")
        for i, m in enumerate(methods, 1):
            self.console.print(f"{i}. {m}")
        choice = int(input("Введите номер метода: "))
        return methods[choice-1]

    def get_email(self, method):
        if method == "anymessage":
            return get_anymessage_email()
        elif method == "notletters":
            return get_notletters_email()
        elif method == "firstmail":
            return get_firstmail_email()
        elif method == "gmail":
            return get_gmail_email("gmail.txt")
        else:
            raise ValueError("Unknown method")

    def get_coords(self, method):
        return REG_METHOD_COORDS.get(method, COORDS)

    def register_account(self, method, gmail_file=None):
        # 1) Подготовка данных и координат
        if method == "gmail" and gmail_file:
            email, password = get_gmail_email(gmail_file)
            coords = REG_METHOD_COORDS["gmail"]
        else:
            email, password = self.get_email(method)
            coords = self.get_coords(method)

        method_no = METHOD_NUMBERS.get(method, 0)
        self.console.print(f"[green]Регистрируем аккаунт: {email} ({method} #{method_no})[/green]")

        # 2) Поиск устройства
        devices = self.controller.scan_devices()
        if not devices:
            raise RuntimeError("Не найдено ни одного Android-устройства по ADB")
        device_id = devices[0]["device_id"]
        self.console.print(f"[blue]Используем устройство: {device_id}[/blue]")

        # 3) Разбудить устройство и открыть TikTok
        self.controller.wake_device(device_id)
        opened = self.controller.open_tiktok(device_id)
        if not opened:
            self.console.print("[yellow]Не удалось открыть TikTok. Продолжаем, если уже открыт.[/yellow]")

        # 4) Вспомогательные функции
        def tap(name: str, delay: float = 1.0):
            pt = coords.get(name)
            if not pt:
                raise KeyError(f"Нет координат для '{name}'")
            self.controller.tap(device_id, pt["x"], pt["y"])
            time.sleep(delay)

        def type_at(name: str, text: str, delay: float = 0.5):
            tap(name, delay=0.3)
            self.controller.input_text(device_id, text)
            time.sleep(delay)

        # 5) Навигация: профиль -> регистрация по email
        try:
            tap("profile_tab")
        except Exception:
            pass
        tap("signup_button")
        tap("phone_or_email")
        tap("email_option")

        # 6) Ввод email и пароля (без OTP)
        type_at("email_field", email)
        tap("continue_after_email")
        type_at("password_field", password)
        tap("continue_after_password")

        # 7) Дата рождения (без ввода кода): ставим через контроллер и подтверждаем
        try:
            self.controller.set_date_picker(device_id, day=5, month=3, year=1994)
            tap("confirm_birth_date")
        except Exception:
            try:
                tap("confirm_birth_date")
            except Exception:
                pass

        # 8) Имя пользователя (опционально)
        try:
            type_at("username_field", email.split("@")[0])
            tap("continue_after_username")
        except Exception:
            pass

        # 9) Финальный OK (если есть)
        try:
            tap("ok_button")
        except Exception:
            pass

        # 10) Сохранение аккаунта без OTP
        with open(ACCOUNTS_FILE, "a", encoding="utf-8") as f:
            f.write(f"{email}:{password}:{method_no}\n")

# --- Точка входа ---
def main():
    engine = RegistrationEngine()
    method = engine.select_method()
    engine.register_account(method)

if __name__ == "__main__":
    main()
