# Letterpress(레터프레스) — Windows 시작 런처 (시작하기.bat이 이 파일을 실행합니다)
#
# 하는 일: Node 확인/안내 → pnpm 준비 → 의존성 설치(첫 실행) → 코드가 바뀌었으면
# 재빌드 → 서버 시작 → 브라우저 오픈. 창을 닫으면 앱도 함께 종료됩니다.
#
# 이 파일은 반드시 **UTF-8 BOM**으로 저장돼야 합니다. Windows PowerShell 5.1은
# BOM이 없는 파일을 레거시 ANSI 코드페이지로 읽어 한글이 깨지고 파싱까지
# 실패합니다(공식 문서 about_Character_Encoding). 최신 문법도 쓰지 않습니다 —
# 윈도우에 기본 탑재된 것이 5.1입니다.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

# 콘솔에 한글이 물음표로 나오지 않게. 실패해도 진행한다(표시 문제일 뿐).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { $null = $_ }

$NodeMin = 20                       # Next 16 요구 버전
$Log = Join-Path (Get-Location) '시작-기록.log'
'' | Set-Content -Path $Log -Encoding UTF8
# 기본 포트 25252 — IANA 미할당이고, 리눅스 임시 포트 범위(32768+) 밖이며,
# 흔한 개발 포트(3000·5173·8080)나 Steam·Mongo 대역과 겹치지 않는다.
$Port = if ($env:PORT) { [int]$env:PORT } else { 25252 }

function Say([string]$text) { Write-Host "`n  $text" -ForegroundColor Cyan }
function Warn([string]$text) { Write-Host "`n  $text" -ForegroundColor Yellow }
function Oops([string]$text) { Write-Host "`n  $text" -ForegroundColor Red }

function Die([string]$text) {
  Oops $text
  Write-Host ''
  Read-Host '확인했으면 Enter 키를 누르세요'
  exit 1
}

function Has([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# npm·pnpm은 .cmd/.ps1 shim이라 PowerShell에서 직접 부르면 실행 정책·PATHEXT
# 문제가 생긴다. cmd를 거치면 CMD와 똑같이 동작한다.
function RunTool([string]$commandLine) {
  & $env:ComSpec /c $commandLine *>> $Log
  return $LASTEXITCODE
}

function PortBusy([int]$p) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
  } catch {
    # Get-NetTCPConnection이 없는 환경 폴백
    return [bool]((netstat -ano -p tcp) -match ":$p\s.*LISTENING")
  }
}

function UrlResponds([string]$u, [int]$timeoutSec) {
  try {
    Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec $timeoutSec | Out-Null
    return $true
  } catch {
    return $false
  }
}

# ── Node.js ────────────────────────────────────────────────────────────────
function InstallNodeGuide {
  Write-Host ''
  Write-Host '  해결 방법 (2분, 터미널 지식 필요 없음)'
  Write-Host '  ----------------------------------------'
  Write-Host '  1) 방금 열린 nodejs.org 페이지에서 "LTS" 버튼으로 설치 파일을 받습니다'
  Write-Host '     (Windows Installer, .msi 파일).'
  Write-Host '  2) 받은 .msi 파일을 더블클릭하고 "Next"를 눌러 설치를 마칩니다.'
  Write-Host '  3) 설치가 끝나면 이 창을 닫고, 시작하기.bat을 다시 더블클릭하세요.'
  Write-Host ''
  if (-not $env:MHM_NO_OPEN) { Start-Process 'https://nodejs.org/ko/download' }
  Read-Host '확인했으면 Enter 키를 누르세요'
  exit 1
}

# winget이 있으면 클릭 없이 끝낼 수 있다 — 시스템을 건드리므로 반드시 물어본다.
function TryWingetNode {
  if (-not (Has 'winget')) { return $false }
  Say '이 PC에는 winget이 있어 Node.js를 여기서 바로 설치할 수 있습니다.'
  $answer = Read-Host '  지금 설치할까요? (y = 설치 / 그 외 = 직접 설치 안내)'
  if ($answer -ne 'y' -and $answer -ne 'Y') { return $false }
  Say 'Node.js를 설치합니다 (2~5분)...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Say '설치가 끝났습니다. 이 창을 닫고 시작하기.bat을 다시 더블클릭해 주세요.'
  Read-Host '확인했으면 Enter 키를 누르세요'
  exit 0
}

function NodeMajor {
  try {
    $v = (& node -v) -replace '^v', ''
    return [int]($v.Split('.')[0])
  } catch {
    return 0
  }
}

if (-not (Has 'node')) {
  Oops 'Node.js가 설치돼 있지 않습니다 (이 앱을 실행하는 데 필요합니다).'
  if (-not (TryWingetNode)) { InstallNodeGuide }
} elseif ((NodeMajor) -lt $NodeMin) {
  Oops "Node.js 버전이 낮습니다 (설치됨: $(node -v) · 필요: v$NodeMin 이상)."
  if (-not (TryWingetNode)) { InstallNodeGuide }
}

# ── pnpm ───────────────────────────────────────────────────────────────────
# 사용자가 명령을 치게 만들지 않는다 — Node가 있으면 여기서 해결한다.
if (-not (Has 'pnpm')) {
  if (Has 'corepack') { RunTool 'corepack enable' | Out-Null }
  if (-not (Has 'pnpm')) {
    Say '패키지 관리자(pnpm)를 설치합니다 (30초)...'
    RunTool 'npm install -g pnpm' | Out-Null
    if (-not (Has 'pnpm')) {
      Die 'pnpm 설치에 실패했습니다 — 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
    }
  }
}

# ── 이미 실행 중이면 브라우저만 연다 / 포트 충돌은 비켜간다 ────────────────
# 이전 실행이 포트 충돌로 옆 포트(25253~25262)로 비켜갔을 수 있으므로 그
# 범위까지 /api/health 로 확인한다 — 기본 포트만 보면 재더블클릭이 같은
# data\ 위에 두 번째 인스턴스를 띄운다 (macOS 런처에서 실측된 것과 동일 결함).
# 8초: health 첫 호출은 Chrome 탐색 때문에 2초를 넘을 수 있다 — 짧게 잡으면
# 멀쩡히 떠 있는 앱을 못 알아본다.
foreach ($candidate in (@($Port) + (25253..25262))) {
  if (-not (PortBusy $candidate)) { continue }
  if (UrlResponds "http://localhost:$candidate/api/health" 8) {
    Say "이미 실행 중입니다 — 브라우저를 엽니다: http://localhost:$candidate"
    if (-not $env:MHM_NO_OPEN) { Start-Process "http://localhost:$candidate" }
    exit 0
  }
}
if (PortBusy $Port) {
  $free = $null
  foreach ($candidate in 25253..25262) {
    if (-not (PortBusy $candidate)) { $free = $candidate; break }
  }
  if (-not $free) {
    Die '빈 포트를 찾지 못했습니다 — 실행 중인 다른 프로그램을 닫고 다시 시도해 주세요.'
  }
  Say "$Port 번 포트를 다른 프로그램이 쓰고 있어 $free 번으로 시작합니다."
  $Port = $free
}
$env:PORT = "$Port"
$url = "http://localhost:$Port"

# ── 설치 · 빌드 ────────────────────────────────────────────────────────────
if (-not (Test-Path 'node_modules')) {
  Say '첫 실행 준비: 의존성을 설치합니다 (1~2분)...'
  if ((RunTool 'pnpm install') -ne 0) {
    Die "의존성 설치에 실패했습니다 — 네트워크 연결을 확인해 주세요. (자세한 기록: $Log)"
  }
}

$rev = 'unknown'
# git이 없거나 저장소가 아니어도 진행한다 — 리비전은 재빌드 판단에만 쓴다.
try { $rev = (& git rev-parse HEAD 2>$null | Out-String).Trim() } catch { $null = $_ }
$built = ''
if (Test-Path '.next\.mhm-build-rev') { $built = (Get-Content '.next\.mhm-build-rev' -Raw).Trim() }
if ((-not (Test-Path '.next\BUILD_ID')) -or ($rev -ne $built)) {
  Say '앱을 빌드합니다 (최대 1분)...'
  if ((RunTool 'pnpm build') -ne 0) {
    Die "빌드에 실패했습니다 — 아래 파일을 관리자에게 보내주세요: $Log"
  }
  Set-Content -Path '.next\.mhm-build-rev' -Value $rev
}

# ── 픽셀 검증에 필요한 것들 (없어도 앱은 켜진다) ───────────────────────────
$chromeRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)
$chromeFound = $false
foreach ($root in $chromeRoots) {
  if ($root -and (Test-Path (Join-Path $root 'Google\Chrome\Application\chrome.exe'))) {
    $chromeFound = $true
  }
}
if (-not $chromeFound) {
  Warn '알림: Google Chrome이 없습니다 — 결과물 픽셀 검증 단계에서 실패합니다.'
  Write-Host '        https://www.google.com/chrome 에서 설치한 뒤 앱을 다시 시작하면 됩니다.'
}

# 윈도우에는 python3 명령이 없다 — 런처(py -3)나 python을 쓴다.
$pyCommand = $null
foreach ($candidate in @('py -3', 'python')) {
  if ((RunTool "$candidate -c ""import sys""") -eq 0) { $pyCommand = $candidate; break }
}
if (-not $pyCommand) {
  Warn '알림: 파이썬이 없습니다 — 결과물 픽셀 검증 단계에서 실패합니다.'
  Write-Host '        https://www.python.org/downloads 에서 설치하세요'
  Write-Host '        (설치 화면의 "Add python.exe to PATH"를 반드시 체크).'
} elseif ((RunTool "$pyCommand -c ""import PIL, numpy, fontTools, brotli""") -ne 0) {
  Warn '픽셀 검증에 필요한 파이썬 패키지가 없습니다 (pillow · numpy · fonttools · brotli).'
  $answer = Read-Host '  지금 설치할까요? (y = 설치 / 그 외 = 나중에)'
  if ($answer -eq 'y' -or $answer -eq 'Y') {
    Say '파이썬 패키지를 설치합니다 (1~2분)...'
    if ((RunTool "$pyCommand -m pip install --user pillow numpy fonttools brotli") -ne 0) {
      Warn "설치에 실패했습니다 — 앱은 그대로 시작합니다. 기록: $Log"
    }
  }
}

# ── 서버 시작 ──────────────────────────────────────────────────────────────
Say '서버를 시작합니다... (이 창을 닫으면 앱이 종료됩니다)'
# pnpm은 shim이라 cmd를 거쳐 띄운다. 종료할 때는 taskkill /T로 자식(next-server)
# 까지 정리한다 — pnpm만 죽이면 손자가 포트를 계속 점유한다.
# -NoNewWindow: 이 창의 콘솔을 함께 쓴다. 사용자가 창을 닫으면 윈도우가 콘솔에
# 붙은 프로세스 전부에 종료 이벤트를 보내므로 서버도 같이 내려간다.
# 정리를 어디에 맡기는가 (실측 기준):
#  - 창을 강제로 닫는 경우: PowerShell.Exiting 훅도, 아래 finally도 돌지 않는다.
#    이 경로는 위의 콘솔 공유(-NoNewWindow)가 담당한다. 그래서 종료 훅은 아예
#    등록하지 않는다.
#  - Ctrl-C·정상 종료: 아래 try/finally가 실제로 실행되므로 StopServer로 트리를
#    정리한다. 죽은 코드가 아니니 지우지 말 것 — 지우면 이 경로에서 next-server가
#    포트를 물고 남는다.
#  - 그럼에도 남는 경우: 다음 실행 때 "이미 실행 중"으로 감지해 브라우저만 열거나
#    빈 포트로 비켜간다.
$server = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', 'pnpm start' -NoNewWindow -PassThru

function StopServer {
  if ($script:server -and -not $script:server.HasExited) {
    # pnpm만 죽이면 next-server 손자가 포트를 계속 점유한다 → 트리 전체.
    & taskkill /T /F /PID $script:server.Id *>> $Log
  }
}

$ready = $false
foreach ($i in 1..60) {
  if ($server.HasExited) { break }
  if (UrlResponds "$url/" 2) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  StopServer
  Die "서버가 시작하지 못했습니다 — 기록을 확인해 주세요: $Log"
}

Say "준비 완료 — 브라우저를 엽니다: $url"
Say '(끝내려면 이 창을 닫으세요)'
if (-not $env:MHM_NO_OPEN) { Start-Process $url }

try {
  Wait-Process -Id $server.Id
} finally {
  StopServer
}
