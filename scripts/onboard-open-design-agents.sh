#!/usr/bin/env bash
#
# Onboarding de agentes do Open Design para o cc-pensador: localiza os CLIs do
# host (claude, codex, antigravity), registra-os no app-config.json do daemon
# LOCAL e, opcionalmente, sobe esse daemon no host com o PATH/env corretos para
# que a deteccao de agentes do Open Design finalmente os encontre.
#
# O onboarding do Open Design detecta um agente probing seu binario no PATH do
# processo do daemon. Sob o install Docker, o daemon roda num container Linux que
# NAO enxerga os binarios do host, entao a deteccao sempre falha. Detectar/rodar
# os agentes do host exige um daemon rodando NO HOST.
#
# Uso:
#   bash scripts/onboard-open-design-agents.sh [--clone-dir DIR] [--port 7456]
#        [--claude-bin PATH] [--codex-bin PATH] [--agy-bin PATH]
#        [--launch] [--skip-build] [--stop-docker]

set -euo pipefail

CLONE_DIR="${HOME}/.open-design"
PORT="7456"
CLAUDE_BIN=""
CODEX_BIN=""
AGY_BIN=""
LAUNCH="0"
SKIP_BUILD="0"
STOP_DOCKER="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --clone-dir)  CLONE_DIR="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --claude-bin) CLAUDE_BIN="$2"; shift 2 ;;
    --codex-bin)  CODEX_BIN="$2"; shift 2 ;;
    --agy-bin)    AGY_BIN="$2"; shift 2 ;;
    --launch)     LAUNCH="1"; shift ;;
    --skip-build) SKIP_BUILD="1"; shift ;;
    --stop-docker) STOP_DOCKER="1"; shift ;;
    -h|--help)    sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m[ok] %s\033[0m\n' "$1"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$1"; }

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ONBOARDER="${SCRIPT_DIR}/od-onboard-agents.mjs"
DATA_DIR="${CLONE_DIR}/.od"
DAEMON_URL="http://localhost:${PORT}"

command -v node >/dev/null 2>&1 || { echo "node nao encontrado no PATH. Instale o Node 24+." >&2; exit 1; }

# ── 1. Detect + register ─────────────────────────────────────────────────────
step "Detectando agentes do host (claude, codex, antigravity) e registrando no app-config"
onboard_args=("--clone-dir" "${CLONE_DIR}")
[ -n "${CLAUDE_BIN}" ] && onboard_args+=("--claude-bin" "${CLAUDE_BIN}")
[ -n "${CODEX_BIN}" ]  && onboard_args+=("--codex-bin"  "${CODEX_BIN}")
[ -n "${AGY_BIN}" ]    && onboard_args+=("--agy-bin"    "${AGY_BIN}")

REPORT_JSON="$(node "${ONBOARDER}" "${onboard_args[@]}")" || warn "Nenhum agente detectado no host. Instale claude/codex/agy ou passe --*-bin."
echo "${REPORT_JSON}"

# Extract pathAdditions (newline-joined) without requiring jq.
PATH_ADDITIONS="$(node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const r=JSON.parse(s); (r.pathAdditions||[]).forEach(d=>console.log(d)); } catch {}
  });' <<< "${REPORT_JSON}")"

if [ "${LAUNCH}" != "1" ]; then
  echo ""
  ok "Agentes registrados no app-config do daemon local."
  echo "  app-config: ${DATA_DIR}/app-config.json"
  echo "  Para o Open Design DETECTAR e RODAR esses agentes, suba o daemon NO HOST:"
  echo "    bash \"$0\" --launch --stop-docker"
  echo "  (o daemon Docker, sendo um container Linux, nao executa binarios do host.)"
  exit 0
fi

# ── 2. Free the port (Docker daemon holds it under the bundled install) ──────
if [ "${STOP_DOCKER}" = "1" ] && command -v docker >/dev/null 2>&1; then
  if docker ps --filter 'name=open-design' --format '{{.Names}}' 2>/dev/null | grep -q 'open-design'; then
    step "Parando o container Docker 'open-design' para liberar a porta ${PORT}"
    docker stop open-design >/dev/null 2>&1 || true
    ok "Container Docker parado (o setup permanece em disco; 'docker compose up -d' o retoma)."
  fi
fi

# ── 3. Ensure deps + build ───────────────────────────────────────────────────
DIST_ENTRY="${CLONE_DIR}/apps/daemon/dist/cli.js"
if [ "${SKIP_BUILD}" != "1" ]; then
  if [ ! -d "${CLONE_DIR}/node_modules" ]; then
    step "Instalando dependencias do Open Design (corepack + pnpm install) — pode levar alguns minutos"
    ( cd "${CLONE_DIR}" && corepack enable >/dev/null 2>&1 || true; corepack pnpm install )
  fi
  if [ ! -f "${DIST_ENTRY}" ]; then
    step "Buildando o daemon do Open Design (@open-design/daemon)"
    ( cd "${CLONE_DIR}" && corepack pnpm --filter @open-design/daemon... build )
  fi
fi
[ -f "${DIST_ENTRY}" ] || { echo "dist do daemon nao encontrado em ${DIST_ENTRY}. Rode sem --skip-build." >&2; exit 1; }

# ── 4. Launch the host daemon with the right PATH/env ────────────────────────
step "Subindo o daemon LOCAL do Open Design no host (porta ${PORT})"
LAUNCH_PATH="${PATH}"
if [ -n "${PATH_ADDITIONS}" ]; then
  while IFS= read -r dir; do
    [ -n "${dir}" ] && LAUNCH_PATH="${dir}:${LAUNCH_PATH}"
  done <<< "${PATH_ADDITIONS}"
fi

export PATH="${LAUNCH_PATH}"
export OD_DATA_DIR="${DATA_DIR}"
export OD_PORT="${PORT}"
[ -n "${CLAUDE_BIN}" ] && export CLAUDE_BIN="${CLAUDE_BIN}"
[ -n "${CODEX_BIN}" ]  && export CODEX_BIN="${CODEX_BIN}"

( cd "${CLONE_DIR}" && node "${DIST_ENTRY}" --no-open ) &
DAEMON_PID=$!
ok "Daemon local iniciado (PID ${DAEMON_PID})."

# ── 5. Wait for health + verify /api/agents ──────────────────────────────────
step "Aguardando o daemon em ${DAEMON_URL}/api/health"
elapsed=0
healthy=0
while [ "${elapsed}" -lt 60 ]; do
  if curl -fsS -m 5 "${DAEMON_URL}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2; elapsed=$((elapsed + 2))
done
if [ "${healthy}" != "1" ]; then
  warn "Daemon local nao respondeu em 60s. Verifique o processo (PID ${DAEMON_PID})."
  exit 0
fi
ok "Daemon local respondendo em ${DAEMON_URL}"

step "Verificando deteccao dos agentes (/api/agents)"
node "${ONBOARDER}" --clone-dir "${CLONE_DIR}" --verify "${DAEMON_URL}"

echo ""
echo "============================================================"
ok   "Onboarding de agentes concluido (daemon local no host)."
echo "  Daemon local:  ${DAEMON_URL}  (PID ${DAEMON_PID})"
echo "  app-config:    ${DATA_DIR}/app-config.json"
echo "  Para parar o daemon local: kill ${DAEMON_PID}"
echo "============================================================"
