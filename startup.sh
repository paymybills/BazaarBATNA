#!/usr/bin/env bash
#
# startup.sh — BazaarBot quick-start
#
# Usage:
#   chmod +x startup.sh
#   ./startup.sh              # install deps + launch server + dashboard
#   ./startup.sh --server     # server only (port 8000)
#   ./startup.sh --dashboard  # dashboard only (port 8501)
#   ./startup.sh --inference  # run LLM inference against running server
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"

log() { printf "${CYAN}[BazaarBot]${NC} %s\n" "$*"; }
ok()  { printf "${GREEN}[BazaarBot]${NC} %s\n" "$*"; }
err() { printf "${RED}[BazaarBot]${NC} %s\n" "$*" >&2; }

# ── Ensure venv ───────────────────────────────────────────────────

setup_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        log "Creating virtual environment..."
        python3 -m venv "$VENV_DIR"
    fi

    log "Installing dependencies..."
    "$VENV_DIR/bin/pip" install -q -r "$PROJECT_DIR/requirements.txt"
    ok "Dependencies installed."
}

# ── Commands ──────────────────────────────────────────────────────

start_server() {
    log "Starting FastAPI server on http://localhost:8000 ..."
    cd "$PROJECT_DIR"
    "$VENV_DIR/bin/uvicorn" server.main:app --host 0.0.0.0 --port 8000 --reload
}

start_dashboard() {
    log "Starting Streamlit dashboard on http://localhost:8501 ..."
    cd "$PROJECT_DIR"
    "$VENV_DIR/bin/streamlit" run dashboard.py --server.port 8501 --server.headless true
}

start_both() {
    log "Launching server + dashboard..."
    cd "$PROJECT_DIR"
    "$VENV_DIR/bin/uvicorn" server.main:app --host 0.0.0.0 --port 8000 --reload &
    SERVER_PID=$!
    sleep 2
    ok "Server running (PID $SERVER_PID)"

    "$VENV_DIR/bin/streamlit" run dashboard.py --server.port 8501 --server.headless true &
    DASH_PID=$!
    ok "Dashboard running (PID $DASH_PID)"

    printf "\n"
    ok "========================================="
    ok "  Server:    http://localhost:8000"
    ok "  Dashboard: http://localhost:8501"
    ok "  API docs:  http://localhost:8000/docs"
    ok "========================================="
    printf "\n"
    log "Press Ctrl+C to stop both."

    trap "kill $SERVER_PID $DASH_PID 2>/dev/null; exit 0" INT TERM
    wait
}

run_inference() {
    log "Running inference script against http://localhost:8000 ..."
    cd "$PROJECT_DIR"
    ENV_URL="http://localhost:8000" "$VENV_DIR/bin/python" inference.py
}

# ── Main ──────────────────────────────────────────────────────────

setup_venv

case "${1:-}" in
    --server)     start_server ;;
    --dashboard)  start_dashboard ;;
    --inference)  run_inference ;;
    *)            start_both ;;
esac
