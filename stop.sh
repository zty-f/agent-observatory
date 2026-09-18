#!/bin/zsh
set -e

PORT="${AGENT_OBSERVATORY_PORT:-${CODEX_HUB_PORT:-4180}}"
LABEL="io.agent-observatory"
LEGACY_LABEL="com.zty.agent-session-hub"
USER_ID="$(id -u)"
ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()
while IFS= read -r PID; do
  [[ -n "$PID" ]] && PIDS+=("$PID")
done < <(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)

if (( ${#PIDS[@]} == 0 )); then
  launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
  launchctl bootout "gui/${USER_ID}/${LEGACY_LABEL}" 2>/dev/null || true
  echo "Agent Observatory 未在 127.0.0.1:${PORT} 运行"
  exit 0
fi

for PID in "${PIDS[@]}"; do
  COMMAND="$(ps -p "$PID" -o command=)"
  if [[ "$COMMAND" != *"node"* || "$COMMAND" != *"$ROOT/server.js"* ]]; then
    echo "端口 ${PORT} 被非 Agent Observatory 进程占用，未停止：${COMMAND}"
    exit 1
  fi
done

kill -TERM "${PIDS[@]}"
launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
launchctl bootout "gui/${USER_ID}/${LEGACY_LABEL}" 2>/dev/null || true
echo "Agent Observatory 已停止（端口 ${PORT}）"
