#requires -Version 5.1
<#
.SYNOPSIS
  Onboarding de agentes do Open Design para o cc-pensador: localiza os CLIs do
  host (claude, codex, antigravity), registra-os no app-config.json do daemon
  LOCAL e, opcionalmente, sobe esse daemon no host com o PATH/env corretos para
  que a detecção de agentes do Open Design finalmente os encontre.

.DESCRIPTION
  O onboarding do Open Design detecta um agente probing seu binário no PATH do
  processo do daemon. Sob o install Docker (deploy/), o daemon roda num container
  Linux que NÃO enxerga os binários do host (claude.cmd / codex.cmd / agy.exe),
  então a detecção sempre falha. Detectar/rodar os agentes do host exige um
  daemon rodando NO HOST.

  Este script:
    1. Detecta os paths do host via scripts/od-onboard-agents.mjs e grava
       CLAUDE_BIN / CODEX_BIN em <clone>/.od/app-config.json (antigravity não tem
       chave *_BIN — é resolvido por PATH).
    2. Com -Launch: garante deps + build do daemon local, libera a porta (parando
       o container Docker se ele a estiver segurando), e sobe
       `node apps/daemon/dist/cli.js` com o diretório do agy prependido ao PATH.
    3. Aguarda /api/health e consulta /api/agents para confirmar que claude,
       codex e antigravity reportam `available`.

  Sem -Launch, apenas registra os paths e imprime exatamente o que rodar.

.PARAMETER CloneDir
  Raiz do clone do Open Design. Padrão: %USERPROFILE%\.open-design

.PARAMETER Port
  Porta do daemon local. Padrão: 7456.

.PARAMETER Launch
  Sobe o daemon local no host (build se necessário) após registrar os agentes.

.PARAMETER SkipBuild
  Não rodar pnpm install / build (usa um dist já existente).

.PARAMETER StopDocker
  Parar o container Docker `open-design` se ele estiver segurando a porta.

.EXAMPLE
  pwsh -File scripts/onboard-open-design-agents.ps1
  pwsh -File scripts/onboard-open-design-agents.ps1 -Launch -StopDocker
#>
[CmdletBinding()]
param(
  [string]$CloneDir = (Join-Path $env:USERPROFILE '.open-design'),
  [int]$Port = 7456,
  [string]$ClaudeBin = '',
  [string]$CodexBin = '',
  [string]$AgyBin = '',
  [switch]$Launch,
  [switch]$SkipBuild,
  [switch]$StopDocker
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg"  -ForegroundColor Yellow }

function Test-Command { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Onboarder = Join-Path $ScriptDir 'od-onboard-agents.mjs'
$DataDir = Join-Path $CloneDir '.od'
$DaemonUrl = "http://localhost:$Port"

if (-not (Test-Command 'node')) {
  throw 'node nao encontrado no PATH. Instale o Node 24+ para o onboarding do Open Design.'
}

# ── 1. Detect + register ─────────────────────────────────────────────────────
Write-Step 'Detectando agentes do host (claude, codex, antigravity) e registrando no app-config'
$onboardArgs = @($Onboarder, '--clone-dir', $CloneDir)
if ($ClaudeBin) { $onboardArgs += @('--claude-bin', $ClaudeBin) }
if ($CodexBin)  { $onboardArgs += @('--codex-bin',  $CodexBin) }
if ($AgyBin)    { $onboardArgs += @('--agy-bin',    $AgyBin) }

$reportJson = & node @onboardArgs
$detectExit = $LASTEXITCODE
Write-Host $reportJson
if ($detectExit -ne 0) {
  Write-Warn "Nenhum agente detectado no host (exit $detectExit). Instale claude/codex/agy ou passe -ClaudeBin/-CodexBin/-AgyBin."
}

$report = $null
try { $report = $reportJson | ConvertFrom-Json } catch { }
$pathAdditions = @()
if ($report -and $report.pathAdditions) { $pathAdditions = @($report.pathAdditions) }

if (-not $Launch) {
  Write-Host ''
  Write-Ok 'Agentes registrados no app-config do daemon local.'
  Write-Host "  app-config: $(Join-Path $DataDir 'app-config.json')"
  Write-Host '  Para o Open Design DETECTAR e RODAR esses agentes, suba o daemon NO HOST:'
  Write-Host "    pwsh -File `"$($MyInvocation.MyCommand.Path)`" -Launch -StopDocker"
  Write-Host '  (o daemon Docker, sendo um container Linux, nao executa binarios do host.)'
  return
}

# ── 2. Free the port (Docker daemon holds it under the bundled install) ──────
if ($StopDocker -and (Test-Command 'docker')) {
  $running = (& docker ps --filter 'name=open-design' --format '{{.Names}}') 2>$null
  if ($running -match 'open-design') {
    Write-Step "Parando o container Docker 'open-design' para liberar a porta $Port (daemon local assume os agentes)"
    & docker stop open-design *> $null
    Write-Ok 'Container Docker parado (o setup permanece em disco; `docker compose up -d` o retoma).'
  }
}

# ── 3. Ensure deps + build ───────────────────────────────────────────────────
$DistEntry = Join-Path $CloneDir 'apps\daemon\dist\cli.js'
if (-not $SkipBuild) {
  if (-not (Test-Path (Join-Path $CloneDir 'node_modules'))) {
    Write-Step 'Instalando dependencias do Open Design (corepack + pnpm install) — pode levar alguns minutos'
    Push-Location $CloneDir
    try {
      & corepack enable *> $null
      & corepack pnpm install
      if ($LASTEXITCODE -ne 0) { throw 'pnpm install falhou.' }
    } finally { Pop-Location }
  }
  if (-not (Test-Path $DistEntry)) {
    Write-Step 'Buildando o daemon do Open Design (@open-design/daemon)'
    Push-Location $CloneDir
    try {
      & corepack pnpm --filter @open-design/daemon... build
      if ($LASTEXITCODE -ne 0) { throw 'build do daemon falhou.' }
    } finally { Pop-Location }
  }
}
if (-not (Test-Path $DistEntry)) {
  throw "dist do daemon nao encontrado em $DistEntry. Rode sem -SkipBuild para buildar."
}

# ── 4. Launch the host daemon with the right PATH/env ────────────────────────
Write-Step "Subindo o daemon LOCAL do Open Design no host (porta $Port)"
$launchPath = $env:PATH
if ($pathAdditions.Count -gt 0) {
  $launchPath = (($pathAdditions + $env:PATH.Split(';')) | Where-Object { $_ } | Select-Object -Unique) -join ';'
}
$daemonEnv = @{
  PATH        = $launchPath
  OD_DATA_DIR = $DataDir
  OD_PORT     = "$Port"
}
if ($ClaudeBin) { $daemonEnv['CLAUDE_BIN'] = $ClaudeBin }
if ($CodexBin)  { $daemonEnv['CODEX_BIN']  = $CodexBin }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = (Get-Command node).Source
$psi.Arguments = "`"$DistEntry`" --no-open"
$psi.WorkingDirectory = $CloneDir
$psi.UseShellExecute = $false
foreach ($k in $daemonEnv.Keys) { $psi.EnvironmentVariables[$k] = $daemonEnv[$k] }
$proc = [System.Diagnostics.Process]::Start($psi)
Write-Ok "Daemon local iniciado (PID $($proc.Id))."

# ── 5. Wait for health + verify /api/agents ──────────────────────────────────
Write-Step "Aguardando o daemon em $DaemonUrl/api/health"
$deadline = (Get-Date).AddSeconds(60)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $resp = Invoke-WebRequest -Uri "$DaemonUrl/api/health" -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) {
  Write-Warn "Daemon local nao respondeu em 60s. Verifique a saida do processo (PID $($proc.Id))."
  return
}
Write-Ok "Daemon local respondendo em $DaemonUrl"

Write-Step 'Verificando deteccao dos agentes (/api/agents)'
& node $Onboarder --clone-dir $CloneDir --verify $DaemonUrl

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Ok   'Onboarding de agentes concluido (daemon local no host).'
Write-Host "  Daemon local:  $DaemonUrl  (PID $($proc.Id))"
Write-Host "  app-config:    $(Join-Path $DataDir 'app-config.json')"
Write-Host '  Para parar o daemon local: Stop-Process -Id ' $proc.Id
Write-Host '============================================================' -ForegroundColor Cyan
