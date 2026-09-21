#requires -Version 5.1
<#
.SYNOPSIS
  Onboarding de agentes do Open Design para o cc-pensador: localiza os CLIs do
  host (claude, codex, antigravity), registra-os no app-config.json do daemon
  LOCAL e, opcionalmente, sobe esse daemon no host com o PATH/env corretos para
  que a detecção de agentes do Open Design finalmente os encontre.

.DESCRIPTION
  O onboarding do Open Design detecta um agente probing seu binário no PATH do
  processo do daemon. O daemon do cc-pensador roda SEMPRE NO HOST (Docker não é
  suportado: um container Linux não enxerga claude.cmd / codex.cmd / agy.exe).

  Este script:
    1. Detecta os paths do host via scripts/od-onboard-agents.mjs e grava
       CLAUDE_BIN / CODEX_BIN em <clone>/.od/app-config.json (antigravity não tem
       chave *_BIN — é resolvido por PATH).
    2. Com -Launch: garante deps + build do daemon local, verifica a porta (um
       container Docker LEGADO segurando-a é recusado; -StopLegacyContainer o
       para e desliga o restart automático dele) e sobe
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

.PARAMETER StopLegacyContainer
  Parar (e definir --restart=no) um container Docker legado `open-design` que
  esteja publicando a porta. Alias: -StopDocker. Sem o switch, um container
  segurando a porta faz o script recusar em vez de subir um daemon conflitante.

.PARAMETER Foreground
  Mantém o daemon como filho deste processo e só retorna quando ele encerra
  (usado pela Tarefa Agendada, que precisa de um processo vivo para reiniciar em falha).

.EXAMPLE
  pwsh -File scripts/onboard-open-design-agents.ps1
  pwsh -File scripts/onboard-open-design-agents.ps1 -Launch -StopLegacyContainer
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
  [Alias('StopDocker')]
  [switch]$StopLegacyContainer,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg"  -ForegroundColor Yellow }

function Test-Command { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Onboarder = Join-Path $ScriptDir 'od-onboard-agents.mjs'
$DataDir = Join-Path $CloneDir '.od'
# 127.0.0.1, not localhost: the daemon answers 403 to API clients that reach it as localhost (powered-preview origin).
$DaemonUrl = "http://127.0.0.1:$Port"

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
# A parse failure here used to silently drop pathAdditions (antigravity's PATH
# wiring) with no signal at all; it now warns, so a report-shape change
# upstream is visible instead of just quietly not resolving `agy`.
try { $report = $reportJson | ConvertFrom-Json } catch { Write-Warn "Falha ao parsear o report do onboarder (pathAdditions indisponivel): $($_.Exception.Message)" }
$pathAdditions = @()
if ($report -and $report.pathAdditions) { $pathAdditions = @($report.pathAdditions) }

if (-not $Launch) {
  Write-Host ''
  Write-Ok 'Agentes registrados no app-config do daemon local.'
  Write-Host "  app-config: $(Join-Path $DataDir 'app-config.json')"
  Write-Host '  Para o Open Design DETECTAR e RODAR esses agentes, suba o daemon NO HOST:'
  Write-Host "    pwsh -File `"$($MyInvocation.MyCommand.Path)`" -Launch"
  Write-Host '  (para subir sozinho a cada logon: scripts/register-open-design-daemon-task.ps1)'
  return
}

# ── 2. Port guard (a LEGACY Docker container may still hold the port) ────────
if (Test-Command 'docker') {
  $legacy = @()
  $rows = (& docker ps --format '{{.Names}}|{{.Ports}}') 2>$null
  foreach ($row in @($rows)) {
    $name, $ports = "$row" -split '\|', 2
    if ($name -match 'open-?design' -and $ports -match ":$Port->") { $legacy += $name }
  }
  foreach ($name in $legacy) {
    if (-not $StopLegacyContainer) {
      throw "O container Docker '$name' esta publicando a porta $Port e nao enxerga os agentes do host. Rode de novo com -StopLegacyContainer (para o container e faz 'docker update --restart=no')."
    }
    Write-Step "Parando o container Docker legado '$name' (porta $Port) e desligando o restart automatico"
    & docker stop $name *> $null
    & docker update --restart=no $name *> $null
    Write-Ok "Container '$name' parado; nao volta sozinho no boot. O daemon do host assume a porta."
  }
}

# A host daemon that already answers on the port is left alone (idempotent: the logon task may fire twice).
try {
  $existing = Invoke-WebRequest -Uri "$DaemonUrl/api/health" -UseBasicParsing -TimeoutSec 3
  if ($existing.StatusCode -ge 200 -and $existing.StatusCode -lt 500) {
    Write-Ok "Ja existe um daemon respondendo em $DaemonUrl; nada a subir."
    & node $Onboarder --clone-dir $CloneDir --verify $DaemonUrl
    return
  }
} catch { <# nothing listening: proceed to launch #> }

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
if ($Foreground) { Write-Host '  (-Foreground: este processo aguarda o daemon encerrar)' }

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
Write-Host "  Para parar o daemon local: Stop-Process -Id $($proc.Id)"
Write-Host '============================================================' -ForegroundColor Cyan

if ($Foreground) {
  $proc.WaitForExit()
  exit $proc.ExitCode
}
