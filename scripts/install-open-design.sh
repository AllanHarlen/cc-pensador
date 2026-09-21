#!/usr/bin/env bash
#
# Instalador local do Open Design (https://github.com/nexu-io/open-design) para uso
# opcional pelo cc-pensador (Pensador v2) quando a demanda tem front-end. O daemon
# roda NO HOST (Docker nao e suportado).
#
# O upstream documenta um instalador hospedado de uma linha (open-design.ai/install.sh
# | sh -s <agent>) mas este script NAO o usa deliberadamente: e opaco (nao da para
# revisar o script antes de rodar) e este repo ja clona o codigo-fonte de qualquer forma.
#
# Por que no host: o Pensador aciona o prototipo/critica do Open Design com o agente
# que voce escolher (claude, codex, antigravity...). O daemon so lanca agentes que
# existem no ambiente DELE; um container Linux nao enxerga os binarios do host.
#
#   1. Verifica pre-requisitos (git, node >= 22.6, corepack).
#   2. Clona (ou atualiza) nexu-io/open-design em --target-dir.
#   3. Delega ao onboard-open-design-agents.sh: registra claude/codex/antigravity no
#      app-config do daemon, instala dependencias e compila (pnpm), verifica a porta
#      (container Docker legado e recusado, ou parado com --stop-legacy-container) e
#      sobe o daemon no host.
#   4. Registra o MCP no agente via `od mcp install <agente>` quando `od` existir; caso
#      contrario grava a entrada no .mcp.json a partir de /api/mcp/install-info.
#
# O daemon do host em loopback nao exige token de API (a autenticacao so liga se
# OD_API_TOKEN estiver definido para ele).
#
# Uso:
#   bash scripts/install-open-design.sh [--target-dir DIR] [--agent claude] [--port 7456]
#        [--skip-mcp] [--skip-launch] [--stop-legacy-container]
#
# Para subir o daemon sozinho a cada boot no macOS/Linux, use launchd/systemd --user
# chamando: bash scripts/onboard-open-design-agents.sh --launch --skip-build --foreground

set -euo pipefail

REPO_URL="https://github.com/nexu-io/open-design"
TARGET_DIR="${HOME}/.open-design"
AGENT="claude"
PORT="7456"
MCP_CONFIG="$(pwd)/.mcp.json"
MCP_NAME="open-design"
SKIP_MCP="0"
SKIP_LAUNCH="0"
STOP_LEGACY="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --agent)      AGENT="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --mcp-config) MCP_CONFIG="$2"; shift 2 ;;
    --mcp-name)   MCP_NAME="$2"; shift 2 ;;
    --skip-mcp)   SKIP_MCP="1"; shift ;;
    --skip-launch) SKIP_LAUNCH="1"; shift ;;
    --stop-legacy-container) STOP_LEGACY="1"; shift ;;
    -h|--help)
      sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

# 127.0.0.1, nao localhost: o daemon responde 403 a clientes de API que o acessam como localhost (origem de powered preview).
DAEMON_URL="http://127.0.0.1:${PORT}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m[ok] %s\033[0m\n' "$1"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$1"; }

assert_prerequisites() {
  step "Verificando pre-requisitos (git, node >= 22.6, corepack)"
  command -v git >/dev/null 2>&1 || { echo "git nao encontrado. Instale: https://git-scm.com/downloads" >&2; exit 1; }
  command -v node >/dev/null 2>&1 || { echo "node nao encontrado. Instale o Node 24+: https://nodejs.org" >&2; exit 1; }
  local version major minor
  version="$(node --version | sed 's/^v//')"
  major="${version%%.*}"; minor="$(echo "${version}" | cut -d. -f2)"
  if [ "${major}" -lt 22 ] || { [ "${major}" -eq 22 ] && [ "${minor}" -lt 6 ]; }; then
    echo "Node ${version} e antigo demais (o brand engine remove tipos TypeScript: Node >= 22.6; o Open Design pede Node 24)." >&2
    exit 1
  fi
  [ "${major}" -lt 24 ] && warn "Node ${version}: o Open Design pede Node 24; o build pode falhar."
  command -v corepack >/dev/null 2>&1 || { echo "corepack nao encontrado (vem com o Node). Reinstale o Node 24+." >&2; exit 1; }
  ok "Pre-requisitos presentes."
}

sync_repo() {
  if [ -d "${TARGET_DIR}/.git" ]; then
    step "Atualizando repositorio existente em ${TARGET_DIR}"
    git -C "${TARGET_DIR}" pull --ff-only
  else
    step "Clonando ${REPO_URL} em ${TARGET_DIR}"
    git clone --depth 1 "${REPO_URL}" "${TARGET_DIR}"
  fi
  ok "Repositorio pronto."
}

wait_daemon() {
  local url="${DAEMON_URL}/api/health"
  local timeout=120
  step "Aguardando o daemon em ${url} (ate ${timeout}s)"
  local elapsed=0
  while [ "${elapsed}" -lt "${timeout}" ]; do
    if curl -fsS -m 5 "${url}" >/dev/null 2>&1; then
      ok "Daemon respondendo em ${DAEMON_URL}"
      return 0
    fi
    sleep 3; elapsed=$((elapsed + 3))
  done
  warn "Daemon nao respondeu em ${timeout}s. Rode: bash ${SCRIPT_DIR}/onboard-open-design-agents.sh --launch --skip-build"
  return 1
}

register_mcp() {
  [ "${SKIP_MCP}" = "1" ] && { warn "Registro de MCP pulado (--skip-mcp)."; return 0; }

  # Caminho nativo: se `od` existir no host, usa-o. (GNU coreutils tambem tem um `od`:
  # o `mcp install` falha nele e cai no aviso abaixo.)
  if command -v od >/dev/null 2>&1; then
    step "Registrando o MCP do Open Design no agente '${AGENT}' (od mcp install)"
    if od mcp install "${AGENT}" --daemon-url "${DAEMON_URL}"; then
      ok "MCP registrado no agente '${AGENT}'."
    else
      warn "od mcp install falhou. Registre manualmente pela UI (Settings -> MCP server)."
    fi
    return 0
  fi

  # Sem `od` no PATH: busca a spec do daemon (/api/mcp/install-info) e escreve a
  # entrada mcpServers.<nome> no .mcp.json via helper Node.
  step "Configurando o MCP via daemon (/api/mcp/install-info) em ${MCP_CONFIG}"
  if node "${SCRIPT_DIR}/od-mcp-config.mjs" --config "${MCP_CONFIG}" --name "${MCP_NAME}" --daemon-url "${DAEMON_URL}"; then
    ok "Entrada MCP '${MCP_NAME}' gravada em ${MCP_CONFIG}."
    echo  "    O bridge stdio do MCP precisa do binario 'od' no PATH para subir; se o agente falhar ao iniciar o MCP,"
    echo  "    o Pensador segue lendo os design systems pela API: ${DAEMON_URL}/api/design-systems"
  else
    warn "Falha ao configurar o MCP via daemon. A API REST em ${DAEMON_URL} segue utilizavel."
  fi
}

# ---- Main ------------------------------------------------------------------
assert_prerequisites
sync_repo

onboard_args=(--clone-dir "${TARGET_DIR}" --port "${PORT}")
[ "${SKIP_LAUNCH}" = "1" ] || onboard_args+=(--launch)
[ "${STOP_LEGACY}" = "1" ] && onboard_args+=(--stop-legacy-container)
bash "${SCRIPT_DIR}/onboard-open-design-agents.sh" "${onboard_args[@]}"

if [ "${SKIP_LAUNCH}" != "1" ]; then
  wait_daemon && register_mcp
fi

echo ""
echo "============================================================"
ok   "Open Design instalado (daemon no host)."
echo "  App / UI:    ${DAEMON_URL}"
echo "  Repo local:  ${TARGET_DIR}"
echo "  API REST:    ${DAEMON_URL}/api/design-systems  (sem token em loopback)"
echo "  MCP config:  ${MCP_CONFIG} (server: ${MCP_NAME})"
echo ""
echo "  Comando util (religar o daemon):"
echo "    bash ${SCRIPT_DIR}/onboard-open-design-agents.sh --launch --skip-build"
echo "============================================================"
