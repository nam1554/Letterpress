#!/bin/zsh
# Letterpress(레터프레스) — 더블클릭 시작 런처 (터미널 지식 불필요)
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

# ── Node.js ──────────────────────────────────────────────────────────────
# Next 16이 요구하는 최소 버전. 낮은 버전은 설치돼 있어도 빌드가 깨진다.
NODE_MIN=20

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }

# 비개발자용: 브라우저로 다운로드 페이지까지 열어주고, 할 일을 한 문장으로.
guide_node_download() {
  cat <<'GUIDE'

  해결 방법 (2분, 터미널 지식 필요 없음)
  ────────────────────────────────────────
  1) 방금 열린 nodejs.org 페이지에서 초록색 "LTS" 버튼으로 설치 파일을 받습니다
     (macOS Installer, .pkg 파일).
  2) 받은 .pkg 파일을 더블클릭하고 "계속 → 동의 → 설치"를 누릅니다.
  3) 설치가 끝나면 이 창을 닫고, 시작하기.command를 다시 더블클릭하세요.

GUIDE
  [ -z "${MHM_NO_OPEN:-}" ] && open "https://nodejs.org/ko/download" 2>/dev/null
  read -r "?확인했으면 Enter 키를 누르세요..."
  exit 1
}

# Homebrew가 있으면 다운로드·설치 클릭 없이 한 번에 끝낼 수 있다 — 시스템을
# 건드리는 일이라 반드시 물어보고, 기본은 "아니오".
offer_brew_node() {
  command -v brew >/dev/null 2>&1 || return 1
  printf "\n\033[1;36m%s\033[0m\n" "이 맥에는 Homebrew가 있어 Node.js를 여기서 바로 설치할 수 있습니다."
  read -r "?지금 설치할까요? (y = 설치 / 그 외 = 직접 설치 안내) : " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || return 1
  say "Node.js를 설치합니다 (2~5분, 비밀번호를 물어볼 수 있습니다)…"
  brew install node || return 1
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  hash -r
  command -v node >/dev/null 2>&1
}

# 왜 막혔는지 먼저 말하고, 그 다음에 해결책을 제안한다 (자동 설치 → 직접 설치).
need_node() {
  printf "\n\033[1;31m%s\033[0m\n" "$1"
  offer_brew_node || guide_node_download
}

if ! command -v node >/dev/null 2>&1; then
  need_node "Node.js가 설치돼 있지 않습니다 (이 앱을 실행하는 데 필요합니다)."
elif [ "$(node_major)" -lt "$NODE_MIN" ] 2>/dev/null; then
  need_node "Node.js 버전이 낮습니다 (설치됨: $(node -v) · 필요: v${NODE_MIN} 이상)."
fi

# ── pnpm ─────────────────────────────────────────────────────────────────
# 사용자가 터미널에 명령을 치게 만들지 않는다 — Node가 있으면 여기서 해결한다.
if command -v pnpm >/dev/null 2>&1; then
  PNPM=pnpm
elif command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  command -v pnpm >/dev/null 2>&1 && PNPM=pnpm || PNPM="corepack pnpm"
elif command -v npm >/dev/null 2>&1; then
  say "패키지 관리자(pnpm)를 설치합니다 (30초)…"
  npm install -g pnpm >/dev/null 2>&1
  hash -r
  command -v pnpm >/dev/null 2>&1 && PNPM=pnpm ||
    fail "pnpm 설치에 실패했습니다 — 네트워크 연결을 확인한 뒤 다시 시도해 주세요."
else
  printf "\n\033[1;31m%s\033[0m\n" "Node.js 설치가 온전하지 않습니다 (npm이 없습니다) — 다시 설치해 주세요."
  guide_node_download
fi

# 이미 떠 있으면 브라우저만 연다 (/api/health 로 우리 앱인지 확인).
if curl -sf --max-time 8 "$URL/api/health" >/dev/null 2>&1; then
  say "이미 실행 중입니다 — 브라우저를 엽니다: $URL"
  [ -z "${MHM_NO_OPEN:-}" ] && open "$URL"
  exit 0
fi

# 다른 프로그램이 포트를 쓰고 있으면 빈 포트를 찾아 쓴다 — 터미널에서
# PORT=3001 을 붙여 실행하라고 안내해봐야 비개발자에겐 막다른 길이다.
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
if port_busy "$PORT"; then
  FREE_PORT=""
  for candidate in {3001..3010}; do
    port_busy "$candidate" || { FREE_PORT=$candidate; break; }
  done
  [ -n "$FREE_PORT" ] ||
    fail "빈 포트를 찾지 못했습니다 — 실행 중인 다른 프로그램을 닫고 다시 시도해 주세요."
  say "${PORT}번 포트를 다른 프로그램이 쓰고 있어 ${FREE_PORT}번으로 시작합니다."
  PORT=$FREE_PORT
  URL="http://localhost:${PORT}"
fi

# 실패했을 때 물어볼 곳이 있도록 설치·빌드 출력은 파일로도 남긴다.
LOG="$PWD/시작-기록.log"
: >"$LOG"
setopt pipefail

if [ ! -d node_modules ]; then
  say "첫 실행 준비: 의존성을 설치합니다 (1~2분)…"
  ${=PNPM} install 2>&1 | tee -a "$LOG" ||
    fail "의존성 설치에 실패했습니다 — 네트워크 연결을 확인해 주세요. (자세한 기록: $LOG)"
fi

# 코드(git 리비전)가 바뀌었으면 다시 빌드한다.
REV=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
BUILT=$(cat .next/.mhm-build-rev 2>/dev/null || echo "")
if [ ! -f .next/BUILD_ID ] || [ "$REV" != "$BUILT" ]; then
  say "앱을 빌드합니다 (최대 1분)…"
  ${=PNPM} build 2>&1 | tee -a "$LOG" ||
    fail "빌드에 실패했습니다 — 아래 파일을 관리자에게 보내주세요: $LOG"
  echo "$REV" >.next/.mhm-build-rev
fi

# ── 픽셀 검증에 필요한 것들 ──────────────────────────────────────────────
# 없어도 앱은 켜진다 (변환 마지막의 검증 단계에서만 실패). 그래서 막지 않고
# 여기서 미리 알려주고, 터미널을 열지 않고 해결할 수 있게 해준다.
if [ ! -d "/Applications/Google Chrome.app" ]; then
  printf "\n\033[1;33m%s\033[0m\n" "알림: Google Chrome이 없습니다 — 결과물 픽셀 검증 단계에서 실패합니다."
  printf "%s\n" "  https://www.google.com/chrome 에서 설치한 뒤 앱을 다시 시작하면 됩니다."
fi

if command -v python3 >/dev/null 2>&1 &&
  ! python3 -c "import PIL, numpy, fontTools, brotli" >/dev/null 2>&1; then
  printf "\n\033[1;33m%s\033[0m\n" "픽셀 검증에 필요한 파이썬 패키지가 없습니다 (pillow · numpy · fonttools · brotli)."
  read -r "?지금 설치할까요? (y = 설치 / 그 외 = 나중에) : " install_py
  if [ "$install_py" = "y" ] || [ "$install_py" = "Y" ]; then
    say "파이썬 패키지를 설치합니다 (1~2분)…"
    python3 -m pip install --user pillow numpy fonttools brotli 2>&1 | tee -a "$LOG" ||
      python3 -m pip install --user --break-system-packages pillow numpy fonttools brotli 2>&1 |
      tee -a "$LOG" ||
      printf "\033[1;33m%s\033[0m\n" "설치에 실패했습니다 — 앱은 그대로 시작합니다. 기록: $LOG"
  fi
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
