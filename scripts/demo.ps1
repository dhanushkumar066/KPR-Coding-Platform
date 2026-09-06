# Runs a demo from this laptop, over public HTTPS, with Google sign-in only.
#
#   powershell -ExecutionPolicy Bypass -File scripts\demo.ps1
#
# Why a tunnel rather than just sharing the laptop's WiFi address:
#
# Google will not accept a raw IP as an OAuth origin. `localhost` and
# `127.0.0.1` are special-cased, everything else must be a real domain over
# https. So `http://192.168.x.x:4000` cannot do Google sign-in at all, and the
# only way to demo without it is dev login -- where anyone can sign in as anyone,
# including as a teacher. Not something to put in front of staff.
#
# A Cloudflare tunnel gives a public https address with a valid certificate,
# which Google does accept. It also means the session cookie can be Secure and
# the server can run in production mode, so what the teachers see behaves
# exactly like the real deployment.
#
# Nothing is exposed except this one app: the tunnel reaches localhost:4000 and
# nothing else on the machine.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Say($m) { Write-Host "==> $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# --- prerequisites ---------------------------------------------------------
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
    $guess = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (Test-Path $guess) { $cf = $guess } else {
        Warn "cloudflared is missing. Install it with:"
        Warn "  winget install --id Cloudflare.cloudflared"
        exit 1
    }
} else { $cf = $cf.Source }

$envFile = Join-Path $repo 'server\.env'
if (-not (Test-Path $envFile)) { Warn "server\.env is missing."; exit 1 }

$envText = Get-Content $envFile -Raw
if ($envText -notmatch '(?m)^GOOGLE_CLIENT_ID=\S') {
    Warn "GOOGLE_CLIENT_ID is empty in server\.env."
    Warn "Create one at https://console.cloud.google.com/apis/credentials"
    Warn "  Credentials -> Create credentials -> OAuth client ID -> Web application"
    Warn "Then put it in server\.env and run this again."
    exit 1
}

# --- judge0 ----------------------------------------------------------------
Say "Judge0"
wsl -u root -e bash /mnt/e/College-Coding-App/scripts/start-judge0.sh
if ($LASTEXITCODE -ne 0) { Warn "Judge0 did not come up -- students could sit the paper but nothing would be graded."; exit 1 }

# --- build -----------------------------------------------------------------
Say "Building the client"
npm run build 2>&1 | Select-String -Pattern 'built in|error'

# --- tunnel first, because the app needs to know its own address ------------
Say "Opening the tunnel"
$log = Join-Path $env:TEMP 'kpr-tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath $cf `
    -ArgumentList 'tunnel', '--url', 'http://localhost:4000', '--no-autoupdate' `
    -RedirectStandardError $log -PassThru -WindowStyle Hidden

$url = $null
foreach ($i in 1..30) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}
if (-not $url) { Warn "The tunnel did not report a URL. See $log"; Stop-Process -Id $tunnel.Id -Force; exit 1 }
Say "  $url"

# --- point the app at that address -----------------------------------------
# CLIENT_ORIGIN is the origin the session cookie is scoped to and the origin
# Socket.IO will accept, so it has to be the tunnel's address, not localhost.
Say "Configuring for this URL"
$envText = $envText -replace '(?m)^CLIENT_ORIGIN=.*', "CLIENT_ORIGIN=$url"
$envText = $envText -replace '(?m)^ALLOW_DEV_LOGIN=.*', 'ALLOW_DEV_LOGIN=false'
$envText = $envText -replace '(?m)^NODE_ENV=.*', 'NODE_ENV=production'
Set-Content -Path $envFile -Value $envText -NoNewline -Encoding utf8

Write-Host ""
Write-Host "  Before anyone signs in, add this to Google:" -ForegroundColor Cyan
Write-Host "    console.cloud.google.com/apis/credentials -> your OAuth client"
Write-Host "    Authorised JavaScript origins -> ADD URI ->" -NoNewline
Write-Host " $url" -ForegroundColor Cyan
Write-Host "    (Google can take a minute to apply it.)"
Write-Host ""
Write-Host "  Then share this link:" -NoNewline
Write-Host " $url" -ForegroundColor Green
Write-Host "  Dev login is OFF -- Google accounts only, exactly like the real thing."
Write-Host ""
Write-Host "  Ctrl+C here closes the tunnel and ends the demo." -ForegroundColor DarkGray
Write-Host ""

# --- run -------------------------------------------------------------------
Say "Starting the app"
try {
    npm start
} finally {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    Say "Tunnel closed."
}
