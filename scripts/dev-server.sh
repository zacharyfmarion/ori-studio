#!/usr/bin/env bash
#
# The web dev server, detached from whatever started it.
#
# `preview_start` (the agent Browser pane, `.claude/launch.json`) owns the
# process it spawns and stops it when the session goes away — so the server dies
# every time the tooling restarts, which is not when you wanted it to. This
# starts vite with `setsid` + `nohup` instead: it belongs to no shell, no pane
# and no session, and it keeps running until you stop it.
#
#   scripts/dev-server.sh start     # idempotent — reuses a healthy server
#   scripts/dev-server.sh status
#   scripts/dev-server.sh restart
#   scripts/dev-server.sh stop
#   scripts/dev-server.sh logs      # tail
#
# Point the Browser pane at it with the `web-attached` configuration, which has
# a `url` and no command and therefore attaches rather than spawning.
set -euo pipefail

PORT="${DEV_SERVER_PORT:-5224}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/artifacts/dev-server"
LOG="$LOG_DIR/vite-$PORT.log"
PID_FILE="$LOG_DIR/vite-$PORT.pid"

# Every PID listening on the port, over both stacks. A worktree that binds IPv4
# while another holds IPv6 gives two live servers on one port and no error from
# either, so this asks the kernel rather than trusting the pid file.
listeners() {
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

healthy() {
  curl -fsS -o /dev/null --max-time 3 "http://localhost:$PORT/" 2>/dev/null
}

stop() {
  local pids
  pids="$(listeners)"
  if [ -n "$pids" ]; then
    echo "stopping $(echo "$pids" | tr '\n' ' ')on port $PORT"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in $(seq 1 40); do
      [ -z "$(listeners)" ] && break
      sleep 0.25
    done
    pids="$(listeners)"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
}

start() {
  if healthy; then
    echo "already serving on http://localhost:$PORT/ (pid $(listeners | tr '\n' ' '))"
    return 0
  fi
  # A listener that does not answer is a half-dead server, not a reason to fail.
  [ -n "$(listeners)" ] && stop

  mkdir -p "$LOG_DIR"
  # `--strictPort` on purpose: silently sliding to 5225 is how you end up
  # reading a stale tab. Fail loudly instead.
  #
  # Detached in two ways, because one is not enough and macOS has no `setsid`:
  # `nohup` so a hangup on the parent's terminal does not reach it, and a
  # subshell that exits immediately so the server is re-parented away from this
  # script's process group. Whatever kills the caller then has nothing to kill.
  ( cd "$ROOT" \
      && nohup npx vite apps/web --port "$PORT" --strictPort >"$LOG" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
    disown 2>/dev/null || true ) &
  # Reap the subshell, not the server.
  wait $! 2>/dev/null || true

  for _ in $(seq 1 120); do
    if healthy; then
      echo "serving on http://localhost:$PORT/ (pid $(cat "$PID_FILE"))"
      echo "logs: $LOG"
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null && [ -z "$(listeners)" ]; then
      echo "vite exited before it served. Last lines:" >&2
      tail -n 30 "$LOG" >&2
      return 1
    fi
    sleep 0.25
  done
  echo "timed out waiting for http://localhost:$PORT/. Last lines:" >&2
  tail -n 30 "$LOG" >&2
  return 1
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop
    start
    ;;
  status)
    if healthy; then
      echo "up   http://localhost:$PORT/  pid $(listeners | tr '\n' ' ')"
    elif [ -n "$(listeners)" ]; then
      echo "sick something holds $PORT but does not answer: $(listeners | tr '\n' ' ')"
      exit 1
    else
      echo "down nothing on $PORT"
      exit 1
    fi
    ;;
  logs) tail -n "${2:-40}" -f "$LOG" ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
