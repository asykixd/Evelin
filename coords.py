"""
coords.py — хранение координат для автоматизации действий
"""


# Координаты из legacy config.json
COORDS = {
    "profile_tab": {"x": 965, "y": 2190},
    "signup_button": {"x": 540, "y": 1980},
    "phone_or_email": {"x": 540, "y": 980},
    "email_option": {"x": 820, "y": 380},
    "email_field": {"x": 300, "y": 620},
    "continue_after_email": {"x": 540, "y": 1150},
    "password_field": {"x": 300, "y": 1320},
    "continue_after_password": {"x": 540, "y": 1500},
    "birth_year": {"x": 860, "y": 1900},
    "birth_month": {"x": 540, "y": 1900},
    "birth_day": {"x": 360, "y": 1900},
    "confirm_birth_date": {"x": 540, "y": 1200},
    "username_field": {"x": 300, "y": 1050},
    "continue_after_username": {"x": 540, "y": 1500},
    "ok_button": {"x": 820, "y": 1560},
    "code_field": {"x": 300, "y": 900},
    "three_dots_menu": {"x": 1000, "y": 140},
    "settings": {"x": 300, "y": 2180},
    "security_permissions": {"x": 860, "y": 990},
    "two_step_verification": {"x": 860, "y": 820},
    "authenticator": {"x": 920, "y": 1780},
    "remove_phone": {"x": 420, "y": 1120},
    "add_email": {"x": 260, "y": 1500},
    "email_code_field": {"x": 300, "y": 980},
    "back_button": {"x": 80, "y": 160},
    "logout_button": {"x": 540, "y": 2000},
    "confirm_logout": {"x": 540, "y": 1250},
    "not_now": {"x": 280, "y": 1250},
    # birth_day можно добавить отдельно если нужно
}


def get_coord(name: str):
    """Получить координаты по имени элемента"""
    return COORDS.get(name)
