# Security policy

Evelin drives phones over ADB, stores proxy credentials and API tokens, and updates itself from GitHub Releases, so security reports are taken seriously.

## Supported versions

Only the [latest release](https://github.com/asykixd/Evelin/releases/latest) gets fixes. The app updates itself, so please check that you're on it.

## Reporting a vulnerability

Please report privately through [GitHub security advisories](https://github.com/asykixd/Evelin/security/advisories/new) rather than a public issue. Include the version, your OS, and steps to reproduce. You'll get a reply within a week.

Of particular interest:

- ways for a scenario file, proxy list or device output to run commands on the host;
- shell injection into commands sent to devices;
- leaks of proxy credentials or the CyberYozh token;
- bypasses of update checksum verification.
