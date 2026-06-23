#requires -Version 5.1
<#
.SYNOPSIS
  Instalador local do Open Design (https://github.com/nexu-io/open-design) via Docker,
  para uso opcional pelo cc-pensador (Pensador v2) quando a demanda tem front-end.

.DESCRIPTION
  O Open Design e um app local-first (daemon + web) e NAO possui instalador de uma linha
  (o antigo open-design.ai/install.sh responde 404). Este script automatiza o caminho
  Docker do QUICKSTART oficial:

    1. Verifica pre-requisitos (git, docker, docker compose v2).
    2. Clona (ou atualiza) nexu-io/open-design em -TargetDir.
    3. Prepara deploy/.env com um OD_API_TOKEN gerado (preserva um token existente).
    4. Sobe o servico com `docker compose up -d`.
    5. Aguarda o daemon responder em http://localhost:<porta>.
    6. Tenta registrar o MCP no agente via `od mcp install <agente>` quando o binario
       `od` existir; caso contrario imprime o passo manual (Settings -> MCP server).

  Depois disso o Pensador consegue acionar o Open Design (via `od` ou via API do daemon
  em http://localhost:<porta>/api/design-systems) para semear o design-system.md.

.PARAMETER TargetDir
  Pasta onde o repositorio sera clonado. Padrao: %USERPROFILE%\.open-design

.PARAMETER Agent
  Slug do agente para o `od mcp install`. Padrao: claude.

.PARAMETER Port
  Porta exposta pelo daemon. Padrao: 7456.

.PARAMETER SkipMcp
  Nao tentar registrar o MCP no agente.

.EXAMPLE
  pwsh -File scripts/install-open-design.ps1
  pwsh -File scripts/install-open-design.ps1 -Agent claude -Port 7456
#>
[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path $env:USERPROFILE '.open-design'),
  [string]$Agent = 'claude',
  [int]$Port = 7456,
  [string]$McpConfig = (Join-Path (Get-Location) '.mcp.json'),
  [string]$McpName = 'open-design',
  [switch]$SkipMcp,
  [switch]$SkipOnboardAgents
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/nexu-io/open-design'

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg"  -ForegroundColor Yellow }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Prerequisites {
  Write-Step 'Verificando pre-requisitos (git, docker, docker compose)'
  if (-not (Test-Command 'git')) {
    throw 'git nao encontrado no PATH. Instale o Git: https://git-scm.com/downloads'
  }
  if (-not (Test-Command 'docker')) {
    throw 'docker nao encontrado no PATH. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/'
  }
  # docker compose v2 (subcomando), nao o legado docker-compose.
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'docker compose (v2) indisponivel. Atualize o Docker Desktop para uma versao com Compose v2.'
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

function New-ApiToken {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Initialize-Env {
  param([string]$DeployDir)
  $envPath = Join-Path $DeployDir '.env'
  $examplePath = Join-Path $DeployDir '.env.example'
  if (-not (Test-Path $examplePath)) {
    throw "deploy/.env.example nao encontrado em $DeployDir. O layout do repositorio mudou?"
  }
  if (-not (Test-Path $envPath)) {
    Copy-Item $examplePath $envPath
    Write-Ok 'deploy/.env criado a partir do .env.example.'
  }

  $content = Get-Content $envPath -Raw
  $tokenMatch = [regex]::Match($content, '(?m)^OD_API_TOKEN=(.*)$')
  $existing = if ($tokenMatch.Success) { $tokenMatch.Groups[1].Value.Trim() } else { '' }
  if ([string]::IsNullOrWhiteSpace($existing)) {
    $token = New-ApiToken
    if ($tokenMatch.Success) {
      $content = [regex]::Replace($content, '(?m)^OD_API_TOKEN=.*$', "OD_API_TOKEN=$token")
    } else {
      $content = $content.TrimEnd() + "`nOD_API_TOKEN=$token`n"
    }
    Set-Content -Path $envPath -Value $content -NoNewline
    Write-Ok 'OD_API_TOKEN gerado e gravado em deploy/.env.'
  } else {
    $token = $existing
    Write-Ok 'OD_API_TOKEN ja configurado em deploy/.env (preservado).'
  }
  return $token
}

function Start-Daemon {
  param([string]$DeployDir)
  Write-Step 'Subindo o Open Design (docker compose up -d)'
  Push-Location $DeployDir
  try {
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up -d falhou.' }
  } finally {
    Pop-Location
  }
  Write-Ok 'Container iniciado.'
}

function Wait-Daemon {
  param([int]$Port, [int]$TimeoutSec = 120)
  $url = "http://localhost:$Port/api/health"
  Write-Step "Aguardando o daemon em $url (ate ${TimeoutSec}s)"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        Write-Ok "Daemon respondendo em http://localhost:$Port"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  Write-Warn "Daemon nao respondeu dentro de ${TimeoutSec}s. Verifique: docker compose logs -f (em $TargetDir\deploy)"
  return $false
}

function Register-Mcp {
  param([string]$Agent, [int]$Port, [string]$Token)
  if ($SkipMcp) { Write-Warn 'Registro de MCP pulado (-SkipMcp).'; return }
  $daemonUrl = "http://localhost:$Port"

  # Caminho nativo: se o binario `od` existir no host (instalacao pnpm), usa-o.
  if (Test-Command 'od') {
    Write-Step "Registrando o MCP do Open Design no agente '$Agent' (od mcp install)"
    & od mcp install $Agent --daemon-url $daemonUrl
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "MCP registrado no agente '$Agent'."
    } else {
      Write-Warn "od mcp install retornou codigo $LASTEXITCODE. Registre manualmente pela UI (Settings -> MCP server)."
    }
    return
  }

  # Modo Docker (sem `od` no host): busca a spec de lancamento do daemon
  # (/api/mcp/install-info) e escreve a entrada mcpServers.<nome> no .mcp.json.
  if (-not (Test-Command 'node')) {
    Write-Warn "Sem 'od' e sem 'node' no host: nao foi possivel auto-configurar o MCP."
    Write-Host  "    Conecte pela app (Settings -> MCP server) ou instale o caminho pnpm e rode: od mcp install $Agent"
    return
  }
  Write-Step "Configurando o MCP via daemon (/api/mcp/install-info) em $McpConfig"
  $helper = Join-Path $PSScriptRoot 'od-mcp-config.mjs'
  & node $helper --config $McpConfig --name $McpName --daemon-url $daemonUrl --token $Token
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Entrada MCP '$McpName' gravada em $McpConfig."
    Write-Warn "Modo Docker: o bridge stdio do MCP precisa do binario 'od' no host para subir."
    Write-Host  "    Se o agente reportar falha ao iniciar o MCP 'open-design', use o caminho pnpm (fornece 'od')."
    Write-Host  "    Enquanto isso, o Pensador le os design systems direto pela API: $daemonUrl/api/design-systems"
  } else {
    Write-Warn "Falha ao configurar o MCP via daemon (codigo $LASTEXITCODE). A API REST em $daemonUrl segue utilizavel."
  }
}

function Invoke-OnboardAgents {
  param([string]$TargetDir)
  if ($SkipOnboardAgents) { Write-Warn 'Onboarding de agentes pulado (-SkipOnboardAgents).'; return }
  $onboarder = Join-Path $PSScriptRoot 'od-onboard-agents.mjs'
  if (-not (Test-Command 'node') -or -not (Test-Path $onboarder)) {
    Write-Warn 'Onboarding de agentes pulado (node ou od-onboard-agents.mjs ausente).'
    return
  }
  Write-Step 'Detectando agentes do host (claude, codex, antigravity) e registrando no app-config local'
  & node $onboarder --clone-dir $TargetDir
  Write-Warn 'O daemon Docker (container Linux) NAO executa binarios do host — os agentes acima'
  Write-Host  '    so sao detectados por um daemon rodando NO HOST. Para subir esse daemon local:'
  Write-Host  "      pwsh -File `"$(Join-Path $PSScriptRoot 'onboard-open-design-agents.ps1')`" -Launch -StopDocker"
}

# ---- Main ------------------------------------------------------------------
Assert-Prerequisites
Sync-Repo
$deployDir = Join-Path $TargetDir 'deploy'
$token = Initialize-Env -DeployDir $deployDir
Start-Daemon -DeployDir $deployDir
$null = Wait-Daemon -Port $Port
Register-Mcp -Agent $Agent -Port $Port -Token $token
Invoke-OnboardAgents -TargetDir $TargetDir

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Ok   'Open Design instalado via Docker.'
Write-Host "  App / UI:    http://localhost:$Port"
Write-Host "  Repo local:  $TargetDir"
Write-Host "  API token:   $token"
Write-Host "  API REST:    http://localhost:$Port/api/design-systems"
Write-Host "  MCP config:  $McpConfig (server: $McpName)"
Write-Host ''
Write-Host '  Comandos uteis (no diretorio deploy):'
Write-Host "    docker compose -f `"$deployDir\docker-compose.yml`" logs -f"
Write-Host "    docker compose -f `"$deployDir\docker-compose.yml`" down"
Write-Host '============================================================' -ForegroundColor Cyan
