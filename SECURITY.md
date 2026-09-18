# Security Policy

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## Supported versions

Security fixes target the latest `main` branch. This small project has not had an independent security audit. Older commits and forks may not receive fixes.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/zty-f/agent-observatory/security/advisories/new). It is enabled for this repository. Please do not open a public issue for an unpatched vulnerability. Include the affected commit or version, impact, reproduction steps, and a minimal **synthetic** example. Do not send real session files, secrets, or full home-directory paths. The maintainer will review reports and coordinate a fix; no fixed response time is promised.

For ordinary bugs, use the [public issue templates](https://github.com/zty-f/agent-observatory/issues/new/choose) after removing private data. If GitHub's private reporting page is unavailable, open a public issue asking for a private contact method without disclosing the vulnerability.

## Local threat model

Agent Observatory handles sensitive local session text. The HTTP service listens only on `127.0.0.1`, restricts Host and browser Origin values, does not grant cross-origin read access, and serves only the dashboard's public assets. It does **not** authenticate other processes or users on the same computer. Keep the port local; do not publish it through port forwarding, tunnels, or a reverse proxy. Review [PRIVACY.md](PRIVACY.md) for what the app reads and stores.
