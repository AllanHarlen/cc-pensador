#requires -Version 5.1
<#
.SYNOPSIS
  Instalador local do Open Design (https://github.com/nexu-io/open-design) para uso
  opcional pelo cc-pensador (Pensador v2) quando a demanda tem front-end. O daemon
  roda NO HOST (Docker nao e suportado).

.DESCRIPTION
  O Open Design e um app local-first (daemon + web). O upstream documenta um instalador
  hospedado de uma linha (open-design.ai/install.sh | sh -s <agent>) mas este script
  NAO o usa deliberadamente: e opaco (nao da para revisar o script antes de rodar) e
  este repo ja clona o codigo-fonte de qualquer forma.

  Por que no host: o Pensador aciona o protótipo/critica do Open Design com o agente
  que voce escolher (claude, codex, antigravity...). O daemon so lanca agentes que
  existem no ambiente DELE; um container Linux nao enxerga claude.cmd / codex.cmd /
  agy.exe do host. Por isso o instalador nao usa Docker.

  Passos:
    1. Verifica pre-requisitos (git, node >= 22.6, corepack).
    2. Clona (ou atualiza) nexu-io/open-design em -TargetDir.
    3. Delega ao onboard-open-design-agents.ps1: registra claude/codex/antigravity no
       app-config do daemon, instala dependencias e compila (pnpm), verifica a porta
       (container Docker legado e recusado, ou parado com -StopLegacyContainer) e sobe
       o daemon no host.
    4. Registra o MCP no agente via `od mcp install <agente>` quando `od` existir; caso
       contrario grava a entrada no .mcp.json a partir de /api/mcp/install-info.
    5. Com -Autostart, registra a Tarefa Agendada que sobe o daemon a cada logon.

  O daemon do host em loopback nao exige token de API (a autenticacao so liga se
  OD_API_TOKEN estiver definido para ele).

.PARAMETER TargetDir
  Pasta onde o repositorio sera clonado. Padrao: %USERPROFILE%\.open-design

.PARAMETER Agent
  Slug do agente para o `od mcp install`. Padrao: claude.

.PARAMETER Port
  Porta do daemon. Padrao: 7456.

.PARAMETER SkipMcp
  Nao tentar registrar o MCP no agente.

.PARAMETER SkipLaunch
  So clona e registra os agentes; nao compila nem sobe o daemon.

.PARAMETER StopLegacyContainer
  Para (e faz `docker update --restart=no`) um container Docker legado `open-design`
  que esteja publicando a porta. Sem o switch, ele faz o instalador recusar.

.PARAMETER Autostart
  Registra a Tarefa Agendada (register-open-design-daemon-task.ps1) para subir o
  daemon a cada logon.

.EXAMPLE
  pwsh -File scripts/install-open-design.ps1
  pwsh -File scripts/install-open-design.ps1 -Agent claude -Port 7456 -Autostart
#>
[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path $env:USERPROFILE '.open-design'),
  [string]$Agent = 'claude',
  [int]$Port = 7456,
  [string]$McpConfig = (Join-Path (Get-Location) '.mcp.json'),
  [string]$McpName = 'open-design',
  [switch]$SkipMcp,
  [switch]$SkipLaunch,
  [switch]$StopLegacyContainer,
  [switch]$Autostart
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/nexu-io/open-design'
# 127.0.0.1, not localhost: the daemon answers 403 to API clients that reach it as localhost (powered-preview origin).
$DaemonUrl = "http://127.0.0.1:$Port"

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg"  -ForegroundColor Yellow }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Prerequisites {
  Write-Step 'Verificando pre-requisitos (git, node >= 22.6, corepack)'
  if (-not (Test-Command 'git')) {
    throw 'git nao encontrado no PATH. Instale o Git: https://git-scm.com/downloads'
  }
  if (-not (Test-Command 'node')) {
    throw 'node nao encontrado no PATH. Instale o Node 24+: https://nodejs.org'
  }
  $version = (& node --version).TrimStart('v')
  $major, $minor = ($version -split '\.')[0..1] | ForEach-Object { [int]$_ }
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 6)) {
    throw "Node ${version} e antigo demais (o brand engine remove tipos TypeScript: Node >= 22.6; o Open Design pede Node 24)."
  }
  if ($major -lt 24) { Write-Warn "Node ${version}: o Open Design pede Node 24; o build pode falhar." }
  if (-not (Test-Command 'corepack')) {
    throw 'corepack nao encontrado (vem com o Node). Reinstale o Node 24+.'
  }
  Write-Ok 'Pre-requisitos presentes.'
}

function Sync-Repo {
  if (Test-Path (Join-Path $TargetDir '.git')) {
    Write-Step "Atualizando repositorio existente em $TargetDir"
    & git -C $TargetDir pull --ff-only
  } else {
    Write-Step "Clonando $RepoUrl em $TargetDir"
    & git clone --depth 1 $RepoUrl $TargetDir
  }
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao clonar/atualizar o repositorio.' }
  Write-Ok 'Repositorio pronto.'
}

function Wait-Daemon {
  param([int]$TimeoutSec = 120)
  $url = "$DaemonUrl/api/health"
  Write-Step "Aguardando o daemon em $url (ate ${TimeoutSec}s)"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        Write-Ok "Daemon respondendo em $DaemonUrl"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  Write-Warn "Daemon nao respondeu dentro de ${TimeoutSec}s. Rode: pwsh -File scripts/onboard-open-design-agents.ps1 -Launch -SkipBuild"
  return $false
}

function Register-Mcp {
  param([string]$Agent)
  if ($SkipMcp) { Write-Warn 'Registro de MCP pulado (-SkipMcp).'; return }

  # Caminho nativo: se o binario `od` existir no host, usa-o. (GNU coreutils tambem
  # tem um `od`: o `mcp install` falha nele e cai no aviso abaixo.)
  if (Test-Command 'od') {
    Write-Step "Registrando o MCP do Open Design no agente '$Agent' (od mcp install)"
    & od mcp install $Agent --daemon-url $DaemonUrl
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "MCP registrado no agente '$Agent'."
    } else {
      Write-Warn "od mcp install retornou codigo $LASTEXITCODE. Registre manualmente pela UI (Settings -> MCP server)."
    }
    return
  }

  # Sem `od` no PATH: busca a spec de lancamento do daemon (/api/mcp/install-info)
  # e escreve a entrada mcpServers.<nome> no .mcp.json.
  Write-Step "Configurando o MCP via daemon (/api/mcp/install-info) em $McpConfig"
  $helper = Join-Path $PSScriptRoot 'od-mcp-config.mjs'
  & node $helper --config $McpConfig --name $McpName --daemon-url $DaemonUrl
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Entrada MCP '$McpName' gravada em $McpConfig."
    Write-Host  "    O bridge stdio do MCP precisa do binario 'od' no PATH para subir; se o agente falhar ao iniciar o MCP,"
    Write-Host  "    o Pensador segue lendo os design systems direto pela API: $DaemonUrl/api/design-systems"
  } else {
    Write-Warn "Falha ao configurar o MCP via daemon (codigo $LASTEXITCODE). A API REST em $DaemonUrl segue utilizavel."
  }
}

# ---- Main ------------------------------------------------------------------
Assert-Prerequisites
Sync-Repo

$onboarder = Join-Path $PSScriptRoot 'onboard-open-design-agents.ps1'
$onboardArgs = @{ CloneDir = $TargetDir; Port = $Port }
if (-not $SkipLaunch) { $onboardArgs['Launch'] = $true }
if ($StopLegacyContainer) { $onboardArgs['StopLegacyContainer'] = $true }
& $onboarder @onboardArgs

if (-not $SkipLaunch) {
  $healthy = Wait-Daemon
  if ($healthy) { Register-Mcp -Agent $Agent }
  if ($Autostart) {
    & (Join-Path $PSScriptRoot 'register-open-design-daemon-task.ps1') -CloneDir $TargetDir -Port $Port
  }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Ok   'Open Design instalado (daemon no host).'
Write-Host "  App / UI:    $DaemonUrl"
Write-Host "  Repo local:  $TargetDir"
Write-Host "  API REST:    $DaemonUrl/api/design-systems  (sem token em loopback)"
Write-Host "  MCP config:  $McpConfig (server: $McpName)"
Write-Host ''
Write-Host '  Comandos uteis:'
Write-Host "    Religar o daemon:      pwsh -File `"$(Join-Path $PSScriptRoot 'onboard-open-design-agents.ps1')`" -Launch -SkipBuild"
Write-Host "    Subir a cada logon:    pwsh -File `"$(Join-Path $PSScriptRoot 'register-open-design-daemon-task.ps1')`" -StartNow"
Write-Host '============================================================' -ForegroundColor Cyan
