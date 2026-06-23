#!/usr/bin/env bash
#
# Instalador local do Open Design (https://github.com/nexu-io/open-design) via Docker,
# para uso opcional pelo cc-pensador (Pensador v2) quando a demanda tem front-end.
#
# O Open Design e um app local-first (daemon + web) e NAO possui instalador de uma linha
# (o antigo open-design.ai/install.sh responde 404). Este script automatiza o caminho
# Docker do QUICKSTART oficial:
#
#   1. Verifica pre-requisitos (git, docker, docker compose v2).
#   2. Clona (ou atualiza) nexu-io/open-design em --target-dir.
#   3. Prepara deploy/.env com um OD_API_TOKEN gerado (preserva um token existente).
#   4. Sobe o servico com `docker compose up -d`.
#   5. Aguarda o daemon responder em http://localhost:<porta>.
#   6. Tenta registrar o MCP no agente via `od mcp install <agente>` quando `od` existir;
#      caso contrario imprime o passo manual (Settings -> MCP server).
#
# Uso:
#   bash scripts/install-open-design.sh [--target-dir DIR] [--agent claude] [--port 7456] [--skip-mcp]

set -euo pipefail

REPO_URL="https://github.com/nexu-io/open-design"
TARGET_DIR="${HOME}/.open-design"
AGENT="claude"
PORT="7456"
MCP_CONFIG="$(pwd)/.mcp.json"
MCP_NAME="open-design"
SKIP_MCP="0"
SKIP_ONBOARD_AGENTS="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --agent)      AGENT="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --mcp-config) MCP_CONFIG="$2"; shift 2 ;;
    --mcp-name)   MCP_NAME="$2"; shift 2 ;;
    --skip-mcp)   SKIP_MCP="1"; shift ;;
    --skip-onboard-agents) SKIP_ONBOARD_AGENTS="1"; shift ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m[ok] %s\033[0m\n' "$1"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$1"; }

assert_prerequisites() {
  step "Verificando pre-requisitos (git, docker, docker compose)"
  command -v git >/dev/null 2>&1 || { echo "git nao encontrado. Instale: https://git-scm.com/downloads" >&2; exit 1; }
  command -v docker >/dev/null 2>&1 || { echo "docker nao encontrado. Instale o Docker: https://docs.docker.com/get-docker/" >&2; exit 1; }
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose (v2) indisponivel. Atualize o Docker para uma versao com Compose v2." >&2
    exit 1
  fi
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

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    date +%s | sha256sum | head -c 64
  fi
}

init_env() {
  local deploy_dir="$1"
  local env_path="${deploy_dir}/.env"
  local example_path="${deploy_dir}/.env.example"
  [ -f "${example_path}" ] || { echo "deploy/.env.example nao encontrado em ${deploy_dir}." >&2; exit 1; }
  [ -f "${env_path}" ] || { cp "${example_path}" "${env_path}"; ok "deploy/.env criado a partir do .env.example."; }

  local existing
  existing="$(grep -E '^OD_API_TOKEN=' "${env_path}" | head -n1 | cut -d= -f2- || true)"
  if [ -z "${existing}" ]; then
    TOKEN="$(gen_token)"
    if grep -qE '^OD_API_TOKEN=' "${env_path}"; then
      # edicao in-place portavel (BSD/GNU sed): reescreve via arquivo temporario.
      tmp="$(mktemp)"
      sed "s|^OD_API_TOKEN=.*$|OD_API_TOKEN=${TOKEN}|" "${env_path}" > "${tmp}" && mv "${tmp}" "${env_path}"
    else
      printf '\nOD_API_TOKEN=%s\n' "${TOKEN}" >> "${env_path}"
    fi
    ok "OD_API_TOKEN gerado e gravado em deploy/.env."
  else
    TOKEN="${existing}"
    ok "OD_API_TOKEN ja configurado em deploy/.env (preservado)."
  fi
}

start_daemon() {
  local deploy_dir="$1"
  step "Subindo o Open Design (docker compose up -d)"
  ( cd "${deploy_dir}" && docker compose up -d )
  ok "Container iniciado."
}

wait_daemon() {
  local url="http://localhost:${PORT}/api/health"
  local timeout=120
  step "Aguardando o daemon em ${url} (ate ${timeout}s)"
  local elapsed=0
  while [ "${elapsed}" -lt "${timeout}" ]; do
    if curl -fsS -m 5 "${url}" >/dev/null 2>&1; then
      ok "Daemon respondendo em http://localhost:${PORT}"
      return 0
    fi
    sleep 3; elapsed=$((elapsed + 3))
  done
  warn "Daemon nao respondeu em ${timeout}s. Verifique: (cd ${TARGET_DIR}/deploy && docker compose logs -f)"
  return 0
}

register_mcp() {
  [ "${SKIP_MCP}" = "1" ] && { warn "Registro de MCP pulado (--skip-mcp)."; return 0; }
  local daemon_url="http://localhost:${PORT}"

  # Caminho nativo: se `od` existir no host (instalacao pnpm), usa-o.
  if command -v od >/dev/null 2>&1; then
    step "Registrando o MCP do Open Design no agente '${AGENT}' (od mcp install)"
    if od mcp install "${AGENT}" --daemon-url "${daemon_url}"; then
      ok "MCP registrado no agente '${AGENT}'."
    else
      warn "od mcp install falhou. Registre manualmente pela UI (Settings -> MCP server)."
    fi
    return 0
  fi

  # Modo Docker (sem `od` no host): busca a spec do daemon (/api/mcp/install-info)
  # e escreve a entrada mcpServers.<nome> no .mcp.json via helper Node.
  if ! command -v node >/dev/null 2>&1; then
    warn "Sem 'od' e sem 'node' no host: nao foi possivel auto-configurar o MCP."
    echo  "    Conecte pela app (Settings -> MCP server) ou use o caminho pnpm e rode: od mcp install ${AGENT}"
    return 0
  fi
  step "Configurando o MCP via daemon (/api/mcp/install-info) em ${MCP_CONFIG}"
  local helper
  helper="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/od-mcp-config.mjs"
  if node "${helper}" --config "${MCP_CONFIG}" --name "${MCP_NAME}" --daemon-url "${daemon_url}" --token "${TOKEN}"; then
    ok "Entrada MCP '${MCP_NAME}' gravada em ${MCP_CONFIG}."
    warn "Modo Docker: o bridge stdio do MCP precisa do binario 'od' no host para subir."
    echo  "    Se o agente reportar falha ao iniciar o MCP 'open-design', use o caminho pnpm (fornece 'od')."
    echo  "    Enquanto isso, o Pensador le os design systems pela API: ${daemon_url}/api/design-systems"
  else
    warn "Falha ao configurar o MCP via daemon. A API REST em ${daemon_url} segue utilizavel."
  fi
}

onboard_agents() {
  [ "${SKIP_ONBOARD_AGENTS}" = "1" ] && { warn "Onboarding de agentes pulado (--skip-onboard-agents)."; return 0; }
  local script_dir onboarder
  script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  onboarder="${script_dir}/od-onboard-agents.mjs"
  if ! command -v node >/dev/null 2>&1 || [ ! -f "${onboarder}" ]; then
    warn "Onboarding de agentes pulado (node ou od-onboard-agents.mjs ausente)."
    return 0
  fi
  step "Detectando agentes do host (claude, codex, antigravity) e registrando no app-config local"
  node "${onboarder}" --clone-dir "${TARGET_DIR}" || true
  warn "O daemon Docker (container Linux) NAO executa binarios do host — os agentes acima"
  echo  "    so sao detectados por um daemon rodando NO HOST. Para subir esse daemon local:"
  echo  "      bash \"${script_dir}/onboard-open-design-agents.sh\" --launch --stop-docker"
}

# ---- Main ------------------------------------------------------------------
assert_prerequisites
sync_repo
DEPLOY_DIR="${TARGET_DIR}/deploy"
init_env "${DEPLOY_DIR}"
start_daemon "${DEPLOY_DIR}"
wait_daemon
register_mcp
onboard_agents

echo ""
echo "============================================================"
ok   "Open Design instalado via Docker."
echo "  App / UI:    http://localhost:${PORT}"
echo "  Repo local:  ${TARGET_DIR}"
echo "  API token:   ${TOKEN}"
echo "  API REST:    http://localhost:${PORT}/api/design-systems"
echo "  MCP config:  ${MCP_CONFIG} (server: ${MCP_NAME})"
echo ""
echo "  Comandos uteis:"
echo "    (cd ${DEPLOY_DIR} && docker compose logs -f)"
echo "    (cd ${DEPLOY_DIR} && docker compose down)"
echo "============================================================"
