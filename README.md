# Agent Observatory

> A local-first observatory for coding-agent sessions.
>
> 一个只运行在本机的 Coding Agent 会话观察台：把分散在 Codex、Claude Code、OpenClaw 与 Pi Agent 中的 JSONL 会话收进同一个可搜索、可追踪、可恢复的工作现场。

`Agent Observatory` is not another chat client. It is the place to answer: **which agent is working, on what project, and what happened most recently?**

<p align="center">
  <img alt="Node.js 18 or newer" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white" />
  <img alt="macOS" src="https://img.shields.io/badge/platform-macOS-111827?logo=apple&logoColor=white" />
  <img alt="Local only" src="https://img.shields.io/badge/network-localhost%20only-0f766e" />
  <img alt="Built-in agents" src="https://img.shields.io/badge/agents-4-6d5bd0" />
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#agent-support">Agent support</a> ·
  <a href="#runtime-states">Runtime states</a> ·
  <a href="#privacy-and-safety">Privacy</a> ·
  <a href="#development">Development</a>
</p>

## Why Agent Observatory?

Coding work now happens across several local agents, terminal windows, and projects. Each tool keeps its own history; none gives you a calm, shared view of the work in progress.

Agent Observatory reads those local session records and turns them into one operational view:

- Find a session by title, project, path, agent, or message summary.
- Group work by project instead of by one vendor's sidebar.
- See a filesystem-derived runtime signal: responding, thinking, using tools, just completed, waiting, or needs attention.
- Open the full recorded conversation without leaving the dashboard.
- Move session files to the macOS Trash, restore them later, or archive Codex sessions.
- Copy verified resume commands for agents whose CLI syntax is known.

The deliberately loud, animated rainbow edge belongs only to a currently active session. Everything else stays quiet so the work that is actually moving is obvious at a glance.

## Quick Start

### Requirements

- macOS (the Trash and `launchd` helpers are macOS-specific)
- Node.js 18 or newer
- At least one supported agent with local JSONL sessions

### Run from a checkout

```bash
git clone https://github.com/YOUR_GITHUB_ACCOUNT/agent-observatory.git
cd agent-observatory
npm start
```

Open <http://127.0.0.1:4180>.

There are no runtime npm dependencies. `npm start` runs the built-in Node.js server directly.

### Run as a local background service (macOS)

```bash
./start.sh
```

`start.sh` creates a per-user `launchd` job, waits for the local port to become ready, and opens the dashboard. Stop it with either the power button in the dashboard or:

```bash
./stop.sh
```

Both scripts target only this project's server process. They do not stop Codex, Claude Code, OpenClaw, Pi Agent, or any other process.

### Use another port

For a one-off server:

```bash
AGENT_OBSERVATORY_PORT=4181 npm start
```

Then open <http://127.0.0.1:4181>.

`CODEX_HUB_PORT` remains accepted as a legacy alias for existing installations.

## What It Does

| Area | What you get |
| --- | --- |
| Unified index | One switcher for all supported agents, with counts per agent |
| Retrieval | Search titles, projects, modules, paths, agent names, and message summaries |
| Project view | Group sessions by detected repository or working directory |
| Live signal | 8-second local refresh; active cards receive a moving border and a precise latest-event label |
| Conversation detail | Read the recorded user and agent messages, then search within a conversation |
| Session hygiene | Archive Codex sessions, move sessions to macOS Trash, restore them, or permanently delete trashed files |
| Resume assistance | Copy `codex resume` or `claude --resume` commands where the upstream CLI behavior is known |
| Display modes | Dense timeline list, grid view, dark/light themes, desktop/mobile layouts |

## Agent Support

| Agent | Session source | Read | Trash / restore | Resume command |
| --- | --- | :---: | :---: | :---: |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` | Yes | Yes | Yes |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Yes | Yes | Yes |
| OpenClaw | `~/.openclaw/agents/**/sessions/*.jsonl` | Yes | Unreferenced history only | Not exposed |
| Pi Agent | `~/.pi/agent/sessions/**/*.jsonl` | Yes | Yes | Not exposed |

OpenClaw trajectory, checkpoint, reset, and deleted session artifacts are intentionally ignored. OpenClaw sessions still referenced by its live `sessions.json` routing store cannot be moved from this dashboard: moving only their JSONL would leave a broken route. Unreferenced OpenClaw history and Pi sessions can be moved as files. Agent Observatory does not invent a resume command when the upstream CLI contract has not been verified.

### Pi Agent paths

Use either variable when Pi Agent stores its data outside the default location:

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent npm start
PI_CODING_AGENT_SESSION_DIR=/path/to/pi-sessions npm start
```

`PI_CODING_AGENT_SESSION_DIR` takes precedence and should point directly to the session directory.

## Runtime States

Agent Observatory infers state from the newest event written to the session JSONL file. It does not hook into a model provider or claim to know an agent's private process state.

| State | Meaning |
| --- | --- |
| Responding to user | The newest recent event is a user request; the agent is expected to be handling it |
| Thinking | A recent reasoning event was written |
| Executing tool | A recent tool call was written |
| Processing tool result | A recent tool result was written |
| Just completed | The agent wrote a visible response in the last 8 minutes |
| Waiting | The last known event is a user message, without a newer agent output |
| Needs attention | A recent error or interruption was detected in the latest events |
| Completed / idle | No current activity can be inferred from the latest recorded event |

The active-state threshold is currently **8 minutes**. This makes the UI responsive to new JSONL writes without marking old sessions as permanently active.

## Privacy and Safety

- The server listens on `127.0.0.1` only. It is not exposed to your LAN by default.
- It reads session JSONL files from your local home directory. It does not call OpenAI, Anthropic, Pi, or another model API.
- Session text can include prompts, tool output, paths, and other sensitive development context. Treat the dashboard like your terminal history.
- Archive and Trash actions change local files only after an explicit UI confirmation. Trash is recoverable from the dashboard; permanent deletion is not. Moving a Codex session to Trash saves its JSONL and per-thread SQLite history in macOS Trash, runs the installed Codex CLI's `delete --force` command, and removes its entry from the desktop app's local thread catalog. Restoring reinstates the JSONL, history, metadata, and saved catalog entry. Permanently deleting a trashed session removes both Trash files and any remaining catalog entry. Because Codex deletion can affect spawned descendants, the dashboard blocks moving or deleting a parent while any descendant session remains. An already open ChatGPT/Codex window can show an in-memory sidebar entry until fully quit and reopened; the dashboard cannot force its renderer to refresh.
- The local Trash index lives at `~/.codex/.codex-hub-trash-index.json` so restored sessions can return to their original paths. Codex history snapshots are `CodexHub-state-<thread-id>.sqlite` files in macOS Trash.
- Recent Codex versions can keep valid paginated session history in SQLite after the JSONL rollout disappears. A missing rollout file alone is not proof that a Codex session was deleted.

## Keyboard and Interaction

| Shortcut / control | Action |
| --- | --- |
| `Cmd/Ctrl + F` | Focus session search |
| `Esc` | Close an open filter, Agent menu, or mobile detail panel |
| Agent switcher | Scope the entire dashboard to one agent |
| Running card | Open its detail panel; the moving border indicates a recent active event |
| Power button | Stop the local observatory service after confirmation |

## HTTP Endpoints

The dashboard consumes a small local API. It is useful for diagnosing installation issues and for lightweight local integrations.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health status and session counts by agent |
| `GET /api/agents` | Supported agents, roots, counts, and resume capabilities |
| `GET /api/sessions?agent=all` | Indexed sessions and tracked Trash entries |
| `GET /api/conversation/:id` | A session's readable conversation entries |
| `POST /api/action` | Local archive, restore, trash, delete, resume-command, and service-stop actions |

## Development

```bash
node --check server.js
node --check app.js
npm start
curl http://127.0.0.1:4180/api/health
```

This project intentionally uses a small Node.js HTTP server and browser-native JavaScript. Keeping the stack dependency-free makes it easy to inspect, modify, and run beside coding tools.

### Project layout

```text
agent-observatory/
├── index.html      # dashboard structure
├── styles.css      # responsive visual system and live-session motion
├── app.js          # client state, filtering, detail panel, polling
├── server.js       # local JSONL readers, runtime inference, file actions, API
├── start.sh        # macOS launchd-backed start helper
└── stop.sh         # verified local service stop helper
```

## Contributing

Contributions are welcome, especially for new session readers, cross-platform service helpers, runtime-state parsing, accessibility improvements, and test coverage.

When adding an agent reader, please include: its exact on-disk session format, a safe default path, environment-variable overrides when applicable, a conversation parser, runtime-event mapping, and clear evidence for any resume command.

## Before You Publish a Fork

1. Replace `YOUR_GITHUB_ACCOUNT` in the clone command with the real repository owner.
2. Review every file staged for commit. Do not publish exported session JSONL, screenshots containing private prompts, local logs, or unrelated design documents.
3. Choose and add a license. This repository currently has **no `LICENSE` file**, so others do not yet have permission to reuse the code.
4. Consider adding a sanitized product screenshot or short GIF below the title. A real dashboard state is much more convincing than a mockup.

## Name and Repository

The product name is **Agent Observatory**. The recommended GitHub repository slug is **`agent-observatory`**. It is memorable, search-friendly, and describes the central promise: observe a distributed local agent workflow without moving the data anywhere else.

---

Built for people whose coding work no longer fits in one agent sidebar.
