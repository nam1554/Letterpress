#!/bin/zsh
# Marketing HTML Maker — 더블클릭 시작 런처 (터미널 지식 불필요)
#
# 하는 일: 의존성 설치(첫 실행) → 코드가 바뀌었으면 재빌드 → 서버 시작 →
# 브라우저 자동 오픈. 이 창을 닫으면 앱도 함께 종료됩니다.
set -u
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

say() { printf "\n\033[1;36m%s\033[0m\n" "$1"; }
fail() {
  printf "\n\033[1;31m%s\033[0m\n" "$1"
  # 더블클릭 실행 시 창이 바로 닫혀 메시지를 못 보는 것 방지
  read -r "?확인했으면 Enter 키를 누르세요..."
  exit 1
}

# Finder에서 실행되면 셸 초기화가 얕을 수 있어 흔한 Node 설치 경로를 보강한다.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"
command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)"

command -v node >/dev/null 2>&1 ||
  fail "Node.js가 설치돼 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 더블클릭해 주세요."

if command -v pnpm >/dev/null 2>&1; then
  PNPM=pnpm
elif command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  command -v pnpm >/dev/null 2>&1 && PNPM=pnpm || PNPM="corepack pnpm"
else
  fail "pnpm이 없습니다. 터미널에서  npm install -g pnpm  실행 후 다시 시도해 주세요."
fi

# 이미 떠 있으면 브라우저만 연다 (/api/health 로 우리 앱인지 확인).
if curl -sf --max-time 8 "$URL/api/health" >/dev/null 2>&1; then
  say "이미 실행 중입니다 — 브라우저를 엽니다: $URL"
  [ -z "${MHM_NO_OPEN:-}" ] && open "$URL"
  exit 0
fi

if [ ! -d node_modules ]; then
  say "첫 실행 준비: 의존성을 설치합니다 (1~2분)…"
  ${=PNPM} install || fail "의존성 설치에 실패했습니다 — 네트워크 연결을 확인해 주세요."
fi

# 코드(git 리비전)가 바뀌었으면 다시 빌드한다.
REV=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
BUILT=$(cat .next/.mhm-build-rev 2>/dev/null || echo "")
if [ ! -f .next/BUILD_ID ] || [ "$REV" != "$BUILT" ]; then
  say "앱을 빌드합니다 (최대 1분)…"
  ${=PNPM} build || fail "빌드에 실패했습니다 — 개발자(관리자)에게 문의해 주세요."
  echo "$REV" >.next/.mhm-build-rev
fi

say "서버를 시작합니다… (이 창을 닫으면 앱이 종료됩니다)"
PORT=$PORT ${=PNPM} start &
SERVER_PID=$!

# pnpm → next-server 로 이어지는 자식 트리 전체를 정리한다
# (pnpm만 죽이면 next-server 손자가 살아남아 포트를 계속 점유).
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}
trap 'kill_tree $SERVER_PID' EXIT INT TERM

for _ in {1..60}; do
  curl -sf --max-time 2 "$URL/" >/dev/null 2>&1 && break
  kill -0 $SERVER_PID 2>/dev/null ||
    fail "서버가 시작하지 못했습니다. 포트 ${PORT}을 다른 프로그램이 쓰고 있는지 확인해 주세요."
  sleep 1
done

say "준비 완료 — 브라우저를 엽니다: $URL"
say "(끝내려면 이 창을 닫으세요)"
[ -z "${MHM_NO_OPEN:-}" ] && open "$URL"
wait $SERVER_PID
