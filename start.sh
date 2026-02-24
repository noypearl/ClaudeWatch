#!/usr/bin/env bash -x
# ──────────────────────────────────────────────────────────────────────────────
#  ClaudeWatch — One-Shot Startup Script
#  Starts the backend + frontend dev server in parallel.
#  Usage: ./start.sh [--prod]
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"
HOOKS_DIR="${SCRIPT_DIR}/hooks"
CLAUDE_HOOKS_DIR="${HOME}/.claude/hooks"
BACKEND_PORT=4821
FRONTEND_PORT=5173
MODE="${1:-}"

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}▶${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*"; exit 1; }

echo -e "${BOLD}"
echo "  ██████╗██╗      █████╗ ██╗   ██╗██████╗ "
echo " ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗"
echo " ██║     ██║     ███████║██║   ██║██║  ██║"
echo " ██║     ██║     ██╔══██║██║   ██║██║  ██║"
echo " ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝"
echo "  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ "
echo -e "       ${CYAN}Watch${NC}  ·  Claude Code Observability"
echo -e "${NC}"

# ── 1. Python venv + deps ──────────────────────────────────────────────────────
info "Setting up Python environment…"
if [ ! -d "${BACKEND_DIR}/.venv" ]; then
  python3 -m venv "${BACKEND_DIR}/.venv"
fi
source "${BACKEND_DIR}/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r "${BACKEND_DIR}/requirements.txt"
success "Python environment ready"

# ── 2. Node deps ───────────────────────────────────────────────────────────────
info "Installing frontend dependencies…"
cd "${FRONTEND_DIR}"
if [ ! -d node_modules ]; then
  npm install --verbose
fi
success "Frontend dependencies ready"
cd "${SCRIPT_DIR}"

# ── 3 & 4. Hooks — copy scripts + register in settings.json (optional) ─────────
ENABLE_HOOKS=true  # Set to true to install hooks and register them with Claude Code

if [ "$ENABLE_HOOKS" = true ]; then
  info "Installing Claude Code hooks to ${CLAUDE_HOOKS_DIR}…"
  mkdir -p "${CLAUDE_HOOKS_DIR}"
  cp "${HOOKS_DIR}/pre_tool_use.sh"  "${CLAUDE_HOOKS_DIR}/pre_tool_use.sh"
  cp "${HOOKS_DIR}/post_tool_use.sh" "${CLAUDE_HOOKS_DIR}/post_tool_use.sh"
  cp "${HOOKS_DIR}/stop.sh"          "${CLAUDE_HOOKS_DIR}/stop.sh"
  chmod +x "${CLAUDE_HOOKS_DIR}"/*.sh
  success "Hooks installed"

  CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
  info "Checking Claude Code settings…"
  if [ ! -f "${CLAUDE_SETTINGS}" ]; then
    cat > "${CLAUDE_SETTINGS}" <<EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOME}/.claude/hooks/pre_tool_use.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${HOME}/.claude/hooks/post_tool_use.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${HOME}/.claude/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
EOF
    success "Created ${CLAUDE_SETTINGS}"
  else
    warn "${CLAUDE_SETTINGS} already exists — hooks NOT auto-merged. Add them manually (see README)."
  fi
else
  info "Hooks skipped (ENABLE_HOOKS=false). See README for manual setup."
fi

# ── 5. Launch servers ──────────────────────────────────────────────────────────
if [ "${MODE}" = "--prod" ]; then
  info "Building frontend for production…"
  cd "${FRONTEND_DIR}" && npm run build
  cd "${SCRIPT_DIR}"
  success "Frontend built → ${FRONTEND_DIR}/dist/"
  info "Starting backend on :${BACKEND_PORT} (serving built UI)…"
  source "${BACKEND_DIR}/.venv/bin/activate"
  exec uvicorn server:app \
    --app-dir "${BACKEND_DIR}" \
    --host 0.0.0.0 \
    --port "${BACKEND_PORT}"
else
  # Dev mode: backend + vite in parallel
  source "${BACKEND_DIR}/.venv/bin/activate"
  echo ""
  info "Starting backend  → http://localhost:${BACKEND_PORT}"
  info "Starting frontend → http://localhost:${FRONTEND_PORT}"
  echo ""

  trap 'kill 0' SIGINT SIGTERM

  uvicorn server:app \
    --app-dir "${BACKEND_DIR}" \
    --host 127.0.0.1 \
    --port "${BACKEND_PORT}" \
    --reload \
    --log-level warning &

  cd "${FRONTEND_DIR}" && npm run dev &

  wait
fi
