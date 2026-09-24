#!/bin/bash
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || exit 1

alert(){ /usr/bin/osascript -e "display alert \"$1\" message \"${2//\"/\\\"}\" as critical buttons {\"好\"} default button \"好\"" >/dev/null 2>&1 || true; }

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) BIN="$ROOT/bin/macos/arm64/wence_server" ;;
  x86_64) BIN="$ROOT/bin/macos/x86_64/wence_server" ;;
  *) alert "无法启动问策台" "未识别的 Mac 架构：$ARCH"; exit 1 ;;
esac
chmod +x "$BIN" >/dev/null 2>&1 || true

TOKEN_FILE="$ROOT/api_key.txt"
if [ -z "${TUSHARE_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  TUSHARE_TOKEN="$(/usr/bin/sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TOKEN_FILE")"
fi

if [ -z "${TUSHARE_TOKEN:-}" ]; then
  printf 'Paste your Tushare token and press Return (input hidden): ' >&2
  IFS= read -r -s TUSHARE_TOKEN || true
  printf '\n' >&2
  [ -z "$TUSHARE_TOKEN" ] && exit 0
fi
export TUSHARE_TOKEN

PORT=8765
while [ "$PORT" -le 8785 ]; do
  if ! /usr/bin/nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then break; fi
  PORT=$((PORT+1))
done
[ "$PORT" -gt 8785 ] && { alert "无法启动问策台" "8765–8785 端口均被占用。"; exit 1; }
export WENCE_PORT="$PORT"
export WENCE_SHUTDOWN_TOKEN="$(/usr/bin/uuidgen | /usr/bin/tr -d '-')"
export WENCE_ROOT="$ROOT/web"

LOG_DIR="$ROOT/Logs"
mkdir -p "$LOG_DIR" || { alert "无法启动问策台" "无法创建项目日志目录：$LOG_DIR"; exit 1; }
LOG="$LOG_DIR/wence_v3.log"
: > "$LOG"
export WENCE_LOG_PATH="$LOG"
"$BIN" & PID=$!
STOPPING=0
stop_server(){
  [ "$STOPPING" -eq 1 ] && return
  STOPPING=1
  /usr/bin/curl -fsS -X POST -H "X-Wence-Shutdown: $WENCE_SHUTDOWN_TOKEN" "http://127.0.0.1:${PORT}/api/shutdown" >/dev/null 2>&1 || true
  if kill -0 "$PID" >/dev/null 2>&1; then
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      kill -0 "$PID" >/dev/null 2>&1 || break
      /bin/sleep .25
    done
  fi
  if kill -0 "$PID" >/dev/null 2>&1; then kill "$PID" >/dev/null 2>&1 || true; fi
  wait "$PID" >/dev/null 2>&1 || true
}
trap stop_server EXIT INT TERM HUP
READY=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if /usr/bin/curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 "$PID" >/dev/null 2>&1; then break; fi
  /bin/sleep .5
done
if [ "$READY" -ne 1 ]; then
  MSG="启动失败。日志：$LOG"
  [ -s "$LOG" ] && MSG="$MSG\n\n$(tail -n 4 "$LOG" | tr '\n' ' ' | cut -c1-600)"
  alert "问策台启动失败" "$MSG"
  cat "$LOG"; read -r -p "按回车关闭…" _; exit 1
fi
URL="http://127.0.0.1:${PORT}/"
/usr/bin/open "$URL"
clear
echo "============================================"
echo " 问策台 v3 已启动"
echo "============================================"
echo "浏览器地址：$URL"
echo "按 Ctrl+C 停止服务。"
echo ""
wait "$PID"
