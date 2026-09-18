# Privacy Notice

[简体中文](PRIVACY.md) · [English](PRIVACY.en.md)

Last updated: 2026-09-18. This notice describes the **Agent Observatory application**, not the separate privacy practices of Codex, Claude Code, OpenClaw, Pi, GitHub, or your browser.

## What the application accesses

When you run it, the local server scans supported agents' session files under your home directory (or Pi paths you configure). These files may contain prompts, replies, tool calls and results, project paths, model names, timestamps, and secrets present in those records. The server parses this data to build the index and returns the requested session data to the browser at `127.0.0.1`. It does not create a remote account or upload session content to a project-operated server.

The browser saves only the selected agent, display mode, and theme in `localStorage`. The application does not set cookies or include analytics, advertising, external fonts, or a model API client. It does not make application-initiated network requests to agent providers. The agents themselves may have their own network behavior and privacy policies.

## Local storage and actions

The index and conversations are read from agent files when requested; Agent Observatory does not maintain a separate cloud copy. If you move a session to Trash, it stores a local mapping of the original path and metadata at `~/.codex/.codex-hub-trash-index.json`, moves or copies the session file into macOS Trash, and may store a per-thread Codex SQLite snapshot there. Restoring uses that local information. Codex archive and Trash actions also update Codex's native local records. Other agents may retain their own indexes, caches, or backups. An already-open client can keep an in-memory entry after a file action.

The app does not automatically expire Trash entries; macOS or a user can remove Trash files outside the app, which can make restoration impossible. Permanent deletion from the dashboard removes the tracked Trash artifact, but it is **not a guarantee that every copy of a conversation has been erased**. Your operating system, backups, agents, and synced storage may keep copies. A per-user service started with `start.sh` writes standard output and errors to `~/.agent-observatory.log`; avoid sharing that log without review.

To stop access, stop the service (`./stop.sh`), then remove the application checkout if desired. To clear display preferences, remove this site's data in your browser. Handle session files and macOS Trash through the agent and operating system as appropriate; deleting the app does not delete agent history.

## Local access and third parties

The server binds to `127.0.0.1`, checks local Host names and Origin headers, and does not grant cross-origin read access. It has **no login or per-user authorization**. Other processes on your computer may be able to reach the local port. Do not port-forward it, expose it through a proxy, or use it on an untrusted shared account. HTTP on loopback is not encrypted with TLS.

The application page loads its own code and system fonts only. Visiting this GitHub repository, opening an issue, or submitting a pull request is separate from running the local application; information you post there is sent to GitHub and may be public. Never include raw sessions, tokens, private paths, or unredacted screenshots in public reports. See [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) for GitHub's handling of that data.

## Questions and changes

For a general question, open a [redacted GitHub issue](https://github.com/zty-f/agent-observatory/issues/new/choose). For a vulnerability or sensitive report, use the private channel in [SECURITY.md](../.github/SECURITY.en.md). Changes to this notice will be committed in the repository; the date above identifies the current version.
