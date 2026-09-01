# Contributing

[Русский](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md)

Thank you for your interest in Nocturne Vault. Every change should preserve three qualities: local-first operation, a clear interface, and safe handling of personal data.

## Before you start

- open an Issue before proposing a larger feature and describe the user problem;
- a small bug fix may go directly into a focused Pull Request;
- keep unrelated changes in separate Pull Requests;
- never commit builds, user data, keys, passwords, local reports, or generated files.

## Local checks

Windows and Node.js 22 or newer are required.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
node tests/ui-smoke.js
```

Changes to encryption, unlocking, import, export, or data deletion must include tests. For substantial interface changes, include screenshots in both light and dark themes.

## Pull Requests

Explain what changed, why it is needed, and how it was tested. Make sure CI passes and the diff contains no secrets or machine-specific paths.

Do not disclose vulnerabilities in Issues. Follow [SECURITY.en.md](SECURITY.en.md) instead.
