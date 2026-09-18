#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/io.agent-observatory.plist"
LABEL="io.agent-observatory"
LEGACY_LABEL="com.zty.agent-session-hub"
PORT="${AGENT_OBSERVATORY_PORT:-${CODEX_HUB_PORT:-4180}}"

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(command -v node)</string><string>$ROOT/server.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>AGENT_OBSERVATORY_PORT</key><string>$PORT</string></dict>
  <key>StandardOutPath</key><string>$HOME/.agent-observatory.log</string>
  <key>StandardErrorPath</key><string>$HOME/.agent-observatory.log</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  for _ in {1..20}; do
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Agent Observatory 已启动：http://127.0.0.1:${PORT}"
      open "http://127.0.0.1:${PORT}"
      exit 0
    fi
    sleep 0.1
  done
  echo "Agent Observatory 启动失败，请查看 $HOME/.agent-observatory.log" >&2
  exit 1
else
  echo "Agent Observatory 已在 http://127.0.0.1:${PORT} 运行"
fi
open "http://127.0.0.1:${PORT}"
