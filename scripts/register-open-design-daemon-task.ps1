#requires -Version 5.1
<#
.SYNOPSIS
  Registra uma Tarefa Agendada do Windows que sobe o daemon do Open Design NO HOST
  a cada logon (com os agentes claude/codex/antigravity no PATH) e o reinicia se cair.

.DESCRIPTION
  O daemon do cc-pensador roda no host. Sem esta tarefa ele e um processo solto que
  morre no reinicio da maquina. A tarefa executa
  `onboard-open-design-agents.ps1 -Launch -SkipBuild -Foreground` oculto: o script
  registra os caminhos dos agentes (claude/codex podem ter mudado), sobe o daemon e
  fica vivo enquanto ele viver, o que permite o Agendador reiniciar em caso de falha.

  E por usuario (roda no logon de quem registrou, sem privilegios de administrador).
  Idempotente: registrar de novo substitui a tarefa.

.PARAMETER CloneDir
  Raiz do clone do Open Design. Padrao: %USERPROFILE%\.open-design

.PARAMETER Port
  Porta do daemon. Padrao: 7456.

.PARAMETER TaskName
  Nome da tarefa. Padrao: OpenDesignDaemon.

.PARAMETER StartNow
  Inicia a tarefa logo apos registrar (senao ela so dispara no proximo logon).

.PARAMETER Unregister
  Remove a tarefa e sai.

.EXAMPLE
  pwsh -File scripts/register-open-design-daemon-task.ps1 -StartNow
  pwsh -File scripts/register-open-design-daemon-task.ps1 -Unregister
#>
[CmdletBinding()]
param(
  [string]$CloneDir = (Join-Path $env:USERPROFILE '.open-design'),
  [int]$Port = 7456,
  [string]$TaskName = 'OpenDesignDaemon',
  [switch]$StartNow,
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ok] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg"  -ForegroundColor Yellow }

if ($env:OS -ne 'Windows_NT') {
  throw 'Este script e so para Windows (Tarefa Agendada). No macOS/Linux use launchd/systemd --user chamando: bash scripts/onboard-open-design-agents.sh --launch --skip-build --foreground'
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Unregister) {
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Ok "Tarefa '$TaskName' removida."
  } else {
    Write-Warn "Tarefa '$TaskName' nao existe."
  }
  return
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Onboarder = Join-Path $ScriptDir 'onboard-open-design-agents.ps1'
if (-not (Test-Path $Onboarder)) { throw "onboard-open-design-agents.ps1 nao encontrado em $ScriptDir" }
$DistEntry = Join-Path $CloneDir 'apps\daemon\dist\cli.js'
if (-not (Test-Path $DistEntry)) {
  throw "daemon compilado nao encontrado em $DistEntry. Rode antes: scripts/install-open-design.ps1 (ou onboard-open-design-agents.ps1 -Launch) para clonar e compilar."
}

$powershell = (Get-Command powershell.exe).Source
$argument = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Onboarder`" -CloneDir `"$CloneDir`" -Port $Port -Launch -SkipBuild -StopLegacyContainer -Foreground"

Write-Step "Registrando a Tarefa Agendada '$TaskName' (logon de $env:USERNAME)"
$action = New-ScheduledTaskAction -Execute $powershell -Argument $argument -WorkingDirectory $CloneDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Sobe o daemon do Open Design no host (cc-pensador) a cada logon e o reinicia se cair.' -Force | Out-Null
Write-Ok "Tarefa '$TaskName' registrada: dispara no logon, reinicia ate 5 vezes (1 min) se falhar, sem limite de tempo."

if ($StartNow) {
  Write-Step "Iniciando '$TaskName' agora"
  Start-ScheduledTask -TaskName $TaskName
  Write-Ok 'Tarefa iniciada (o daemon leva de 10 a 40 s no primeiro start).'
}

Write-Host ''
Write-Host "  Estado:    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  Parar:     Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Remover:   pwsh -File `"$($MyInvocation.MyCommand.Path)`" -Unregister"
