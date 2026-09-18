#!/bin/zsh
set -e

PORT="${AGENT_OBSERVATORY_PORT:-${CODEX_HUB_PORT:-4180}}"
LABEL="io.agent-observatory"
LEGACY_LABEL="com.zty.agent-session-hub"
USER_ID="$(id -u)"
ROOT="$(cd "$(dirname "$0")" && pwd -P)"
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
  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"
  [[ -z "$COMMAND" ]] && continue
  EXECUTABLE="$(ps -p "$PID" -o comm= 2>/dev/null || true)"
  CWD="$(lsof -nP -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  IS_OURS=false
  if [[ "${EXECUTABLE:t}" == node* ]]; then
    if [[ "$COMMAND" == *" $ROOT/server.js" || "$COMMAND" == *" $ROOT/server.js "* ||
          "$COMMAND" == *" $ROOT/src/server.js" || "$COMMAND" == *" $ROOT/src/server.js "* ]]; then
      IS_OURS=true
    elif [[ "$CWD" == "$ROOT" ]] &&
         [[ "$COMMAND" == *" server.js" || "$COMMAND" == *" server.js "* ||
            "$COMMAND" == *" ./server.js" || "$COMMAND" == *" ./server.js "* ||
            "$COMMAND" == *" src/server.js" || "$COMMAND" == *" src/server.js "* ||
            "$COMMAND" == *" ./src/server.js" || "$COMMAND" == *" ./src/server.js "* ]]; then
      IS_OURS=true
    fi
  fi
  if [[ "$IS_OURS" != true ]]; then
    echo "端口 ${PORT} 被非 Agent Observatory 进程占用，未停止：${COMMAND}"
    exit 1
  fi
done

launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
launchctl bootout "gui/${USER_ID}/${LEGACY_LABEL}" 2>/dev/null || true
for PID in "${PIDS[@]}"; do
  kill -0 "$PID" 2>/dev/null && kill -TERM "$PID" 2>/dev/null || true
done
for _ in {1..30}; do
  if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Agent Observatory 已停止（端口 ${PORT}）"
    exit 0
  fi
  sleep 0.1
done
echo "停止失败：端口 ${PORT} 仍在监听" >&2
exit 1
