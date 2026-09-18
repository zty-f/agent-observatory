# Contributing

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for helping improve Agent Observatory. The most useful contributions make session behavior clearer, safer, or easier to verify.

## Before you start

- Check existing issues; open a feature issue before a large change.
- Use Node.js 22 or newer and macOS for agent-specific Trash/restore testing.
- Run `npm test`. For session lifecycle changes, also test Trash → restore → Trash → delete with a synthetic session and verify the agent's native index or routing store. A successful HTTP response alone is not enough.
- Keep personal session files, tokens, private paths, unredacted screenshots, and service logs out of commits and public issues. Use small synthetic fixtures.
- Update both READMEs and both privacy notices when user-visible behavior or data handling changes.

## Design boundaries

Keep the server bound to loopback and preserve the same-origin and static-file restrictions. Do not add telemetry, external assets, or network requests without a clear reason and matching privacy disclosure. Agent readers should document the session format and path, handle missing files safely, and avoid claiming a client's UI has refreshed when only its disk state changed. Deletion and restoration should preserve history or clearly block unsupported cases.

## Pull requests

Make focused changes, describe the user-visible effect and risks, list the commands and real behavior you verified, and link any related issue. The pull request template is a guide. By contributing, you agree that your contribution is distributed under this repository's [license](LICENSE).

For sensitive security findings, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
