"""
main.py — стартовый файл для авторегистрации TikTok аккаунтов на Android
"""

from device_controller import AndroidDeviceController




from registration_engine import RegistrationEngine
from proxy_controller import ProxyController
import questionary

METHODS = [
    {"name": "Gmail (txt)", "key": "gmail"},
    {"name": "AnyMessage", "key": "anymessage"},
    {"name": "NotLetters", "key": "notletters"},
    {"name": "FirstMail (no 2FA)", "key": "firstmail"}
]


def start_registration():
    method_name = questionary.select(
        "Выберите тип регистрации TikTok аккаунта:",
        choices=[m["name"] for m in METHODS]
    ).ask()
    method_key = next(m["key"] for m in METHODS if m["name"] == method_name)
    proxy_controller = ProxyController()
    engine = RegistrationEngine(proxy_controller=proxy_controller)
    if method_key == "gmail":
        import os
        from rich.prompt import Prompt
        gmail_file = Prompt.ask("Введите имя файла с gmail аккаунтами", default="gmail.txt")
        if not os.path.exists(gmail_file):
            print(f"Файл {gmail_file} не найден!")
            return
        engine.register_account(method_key, gmail_file=gmail_file)
    else:
        engine.register_account(method_key)

def set_proxy():
    proxy_controller = ProxyController()
    proxy_controller.set_proxy()
    print("Прокси установлен через ProxyController (CyberYozh поддерживается автоматически)")

def main():
    while True:
        action = questionary.select(
            "Выберите действие:",
            choices=["Начать регистрацию", "Установить прокси", "Выход"]
        ).ask()
        if action == "Начать регистрацию":
            start_registration()
        elif action == "Установить прокси":
            set_proxy()
        else:
            break

if __name__ == "__main__":
    main()
