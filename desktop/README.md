# Android Farm

Десктопное приложение (Electron + React + TypeScript) для управления фермой Android-устройств, подключённых по USB.

- живые экраны всех устройств в сетке (scrcpy 3.3.3 → H.264 → аппаратное декодирование WebCodecs);
- управление мышью: клик/свайп, колесо — прокрутка, правая кнопка — «Назад»;
- **синхронное управление**: касания и кнопки на одном из выбранных устройств повторяются на всех выбранных;
- пакетные действия: кнопки, ввод текста, запуск приложения, установка APK, скриншоты, перезагрузка, произвольный `adb shell`;
- прокси: импорт файла (`type://host:port[:login[:password]]`), CyberYozh API, раздача по кругу через системный HTTP-прокси Android, проверка IP.

## Запуск

Нужны Node.js 20+ и `adb` (platform-tools) в PATH.

```bash
cd desktop
npm install      # postinstall скачает Electron и scrcpy-server
npm run dev      # режим разработки с hot reload
npm run build && npm start   # собранная версия
```

Если `npm install` заблокировал install-скрипты (npm 11+), выполните `npm approve-scripts esbuild` и затем `npm run postinstall`.

## Архитектура

| Слой | Файл | Что делает |
|---|---|---|
| main | `src/main/devices.ts` | `DeviceManager`: подключение к ADB-серверу (Tango), отслеживание устройств, shell, прокси |
| main | `src/main/mirror.ts` | `MirrorManager`: запуск scrcpy на устройстве, отправка видеопакетов в UI, ввод (touch/scroll/keys/text) |
| main | `src/main/proxies.ts` | `ProxyStore`: порт `ProxyController` из Python-версии |
| main | `src/main/index.ts` | окно, CSP, IPC-обработчики с валидацией, пакетные операции |
| preload | `src/preload/index.ts` | узкий типизированный API `window.farm` (контракт — `FarmApi` в `src/shared/types.ts`) |
| renderer | `src/renderer/src/` | React UI; `DeviceTile` декодирует видео через `WebCodecsVideoDecoder` |

## Безопасность

- `contextIsolation`, `sandbox`, без `nodeIntegration`; renderer видит только `window.farm`.
- Все IPC-аргументы проверяются в main: отправитель, serial из списка подключённых, имена пакетов, хосты и порты прокси.
- Аргументы, собираемые в shell-команды на устройстве, экранируются (`shellCommand`); сырой ввод выполняется только в консоли «ADB shell».
- Токен CyberYozh и прокси с паролями хранятся в `userData/proxy-settings.json`, зашифрованные через `safeStorage` (Keychain / DPAPI / libsecret).
- Строгая CSP, навигация и новые окна запрещены, запросы разрешений отклоняются.

## Обновление scrcpy

Версия задаётся в `src/shared/scrcpy-version.json` и должна совпадать с классом опций `AdbScrcpyOptionsX_Y_Z` в `src/main/mirror.ts`.
