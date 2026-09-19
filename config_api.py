# config_api.py — хранение и загрузка API-ключей

import os
import json

CONFIG_PATH = "api_keys.json"

DEFAULT_CONFIG = {
    "anymessage_token": "your_token_here",
    "notletters_token": "your_notletters_token_here",
    "firstmail_token": "your_firstmail_token_here"
}

def load_api_keys():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)
