# Letterpress(레터프레스) — Windows 시작 런처 (시작하기.bat이 이 파일을 실행합니다)
#
# 하는 일: Node 확인/안내 → pnpm 준비 → 의존성 설치(첫 실행) → 코드가 바뀌었으면
# 재빌드 → 서버 시작 → 브라우저 오픈. 창을 닫으면 앱도 함께 종료됩니다.
# PowerShell 5.1(윈도우 기본 탑재)에서 동작하도록 최신 문법은 쓰지 않습니다.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$NodeMin = 20                       # Next 16 요구 버전
$Log = Join-Path (Get-Location) '시작-기록.log'
'' | Set-Content -Path $Log -Encoding UTF8
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }

function Say([string]$text) { Write-Host "`n  $text" -ForegroundColor Cyan }
function Warn([string]$text) { Write-Host "`n  $text" -ForegroundColor Yellow }

function Die([string]$text) {
  Write-Host "`n  $text" -ForegroundColor Red
  Write-Host ''
  Read-Host '확인했으면 Enter 키를 누르세요'
  exit 1
}

function Has([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function PortBusy([int]$p) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
  } catch {
    # Get-NetTCPConnection이 없는 환경(구버전/일부 SKU) 폴백
    return [bool]((netstat -ano -p tcp) -match ":$p\s.*LISTENING")
  }
}

function AppRespondsOn([int]$p) {
  try {
    Invoke-WebRequest -Uri "http://localhost:$p/api/health" -UseBasicParsing -TimeoutSec 8 | Out-Null
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
  Write-Host "`n  Node.js가 설치돼 있지 않습니다 (이 앱을 실행하는 데 필요합니다)." -ForegroundColor Red
  if (-not (TryWingetNode)) { InstallNodeGuide }
} elseif ((NodeMajor) -lt $NodeMin) {
  Write-Host "`n  Node.js 버전이 낮습니다 (설치됨: $(node -v) · 필요: v$NodeMin 이상)." -ForegroundColor Red
  if (-not (TryWingetNode)) { InstallNodeGuide }
}

# ── pnpm ───────────────────────────────────────────────────────────────────
# 사용자가 명령을 치게 만들지 않는다 — Node가 있으면 여기서 해결한다.
if (-not (Has 'pnpm')) {
  if (Has 'corepack') {
    & corepack enable *> $null
  }
  if (-not (Has 'pnpm')) {
    Say '패키지 관리자(pnpm)를 설치합니다 (30초)...'
    & npm install -g pnpm *>> $Log
    if (-not (Has 'pnpm')) {
      Die 'pnpm 설치에 실패했습니다 — 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
    }
  }
}

# ── 이미 실행 중이면 브라우저만 연다 / 포트 충돌은 비켜간다 ────────────────
if (PortBusy $Port) {
  if (AppRespondsOn $Port) {
    Say "이미 실행 중입니다 — 브라우저를 엽니다: http://localhost:$Port"
    if (-not $env:MHM_NO_OPEN) { Start-Process "http://localhost:$Port" }
    exit 0
  }
  $free = $null
  foreach ($candidate in 3001..3010) {
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
  & pnpm install *>> $Log
  if ($LASTEXITCODE -ne 0) {
    Die "의존성 설치에 실패했습니다 — 네트워크 연결을 확인해 주세요. (자세한 기록: $Log)"
  }
}

$rev = 'unknown'
try { $rev = (& git rev-parse HEAD 2>$null).Trim() } catch { }
$built = ''
if (Test-Path '.next\.mhm-build-rev') { $built = (Get-Content '.next\.mhm-build-rev' -Raw).Trim() }
if ((-not (Test-Path '.next\BUILD_ID')) -or ($rev -ne $built)) {
  Say '앱을 빌드합니다 (최대 1분)...'
  & pnpm build *>> $Log
  if ($LASTEXITCODE -ne 0) {
    Die "빌드에 실패했습니다 — 아래 파일을 관리자에게 보내주세요: $Log"
  }
  Set-Content -Path '.next\.mhm-build-rev' -Value $rev
}

# ── 픽셀 검증에 필요한 것들 (없어도 앱은 켜진다) ───────────────────────────
$chromePaths = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
if (-not ($chromePaths | Where-Object { $_ -and (Test-Path $_) })) {
  Warn '알림: Google Chrome이 없습니다 — 결과물 픽셀 검증 단계에서 실패합니다.'
  Write-Host '        https://www.google.com/chrome 에서 설치한 뒤 앱을 다시 시작하면 됩니다.'
}

# 윈도우에는 python3 명령이 없다 — 런처(py -3)나 python을 쓴다.
$py = $null
foreach ($candidate in @(@('py', '-3'), @('python'))) {
  try {
    & $candidate[0] @($candidate[1..($candidate.Length - 1)]) -c 'import sys' *> $null
    if ($LASTEXITCODE -eq 0) { $py = $candidate; break }
  } catch { }
}
if (-not $py) {
  Warn '알림: 파이썬이 없습니다 — 결과물 픽셀 검증 단계에서 실패합니다.'
  Write-Host '        https://www.python.org/downloads 에서 설치하세요'
  Write-Host '        (설치 화면의 "Add python.exe to PATH"를 반드시 체크).'
} else {
  $pyArgs = @($py[1..($py.Length - 1)])
  & $py[0] @pyArgs -c 'import PIL, numpy, fontTools, brotli' *> $null
  if ($LASTEXITCODE -ne 0) {
    Warn '픽셀 검증에 필요한 파이썬 패키지가 없습니다 (pillow · numpy · fonttools · brotli).'
    $answer = Read-Host '  지금 설치할까요? (y = 설치 / 그 외 = 나중에)'
    if ($answer -eq 'y' -or $answer -eq 'Y') {
      Say '파이썬 패키지를 설치합니다 (1~2분)...'
      & $py[0] @pyArgs -m pip install --user pillow numpy fonttools brotli *>> $Log
      if ($LASTEXITCODE -ne 0) {
        Warn "설치에 실패했습니다 — 앱은 그대로 시작합니다. 기록: $Log"
      }
    }
  }
}

# ── 서버 시작 ──────────────────────────────────────────────────────────────
Say '서버를 시작합니다... (이 창을 닫으면 앱이 종료됩니다)'
$server = Start-Process -FilePath 'pnpm' -ArgumentList 'start' -NoNewWindow -PassThru

# 창을 닫거나 Ctrl+C로 끝낼 때 next-server 자식까지 정리한다
# (pnpm만 죽이면 손자가 살아남아 포트를 계속 점유).
$cleanup = {
  if ($server -and -not $server.HasExited) {
    & taskkill /T /F /PID $server.Id *> $null
  }
}
Register-EngineEvent PowerShell.Exiting -Action $cleanup | Out-Null

$ready = $false
foreach ($i in 1..60) {
  if ($server.HasExited) { break }
  try {
    Invoke-WebRequest -Uri "$url/" -UseBasicParsing -TimeoutSec 2 | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $ready) {
  & $cleanup
  Die "서버가 시작하지 못했습니다 — 기록을 확인해 주세요: $Log"
}

Say "준비 완료 — 브라우저를 엽니다: $url"
Say '(끝내려면 이 창을 닫으세요)'
if (-not $env:MHM_NO_OPEN) { Start-Process $url }

try {
  Wait-Process -Id $server.Id
} finally {
  & $cleanup
}
