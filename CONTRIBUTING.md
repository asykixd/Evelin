# Contributing to Evelin

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

- **Questions and ideas:** [Discussions](https://github.com/asykixd/Evelin/discussions)
- **Bugs:** [open an issue](https://github.com/asykixd/Evelin/issues/new/choose) with your version, OS and device models
- **Security issues:** see [SECURITY.md](SECURITY.md)

## Development

You need Node.js 20+ and `adb` on `PATH`.

```bash
npm install          # also downloads Electron and the pinned scrcpy-server
npm run dev          # app with hot reload
npm run typecheck    # must pass
npm test             # unit tests (vitest)
```

Architecture notes and conventions live in [CLAUDE.md](CLAUDE.md) and the [README](README.md#building-from-source). In short:

- All ADB access stays in the main process; the renderer only talks to `window.farm`. Validate every IPC argument.
- Build device shell commands with `shellCommand(...)`: Tango doesn't escape arguments.
- User-facing strings go through `t()` and need both `ru` and `en` translations.
- Platform-specific account-creation automation (Instagram, TikTok, etc.) is out of scope.

CI runs typecheck and tests on every pull request.
