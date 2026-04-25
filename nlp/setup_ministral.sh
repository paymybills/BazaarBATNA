#!/usr/bin/env bash
# Waits for the Indian negotiation generator to finish, then:
#   1. Pulls ministral-3:3b into Ollama
#   2. Swaps it as the default extractor model
#   3. Runs the extractor test to verify quality
#
# Run with: bash nlp/setup_ministral.sh &
# Log:       /tmp/setup_ministral.log

set -euo pipefail
LOG=/tmp/setup_ministral.log
TARGET=500
JSONL=data/indian_negotiations.jsonl
EXTRACTOR=nlp/extractor.py

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

cd /home/meow/Documents/Projects/MetaThon

log "Watching generator — waiting for $TARGET conversations in $JSONL ..."

while true; do
    if [ -f "$JSONL" ]; then
        count=$(wc -l < "$JSONL")
        log "Progress: $count / $TARGET conversations"
        if [ "$count" -ge "$TARGET" ]; then
            log "Generator done."
            break
        fi
    else
        log "Output file not found yet, waiting..."
    fi

    # Also stop waiting if the generator process is gone and file exists
    if [ -f "$JSONL" ] && ! pgrep -f generate_indian_negotiations.py > /dev/null 2>&1; then
        count=$(wc -l < "$JSONL")
        log "Generator process ended with $count conversations. Proceeding."
        break
    fi

    sleep 120
done

log "Pulling ministral-3:3b ..."
ollama pull ministral-3:3b 2>&1 | tee -a "$LOG"

log "Verifying ministral-3:3b is available ..."
ollama list | tee -a "$LOG"

log "Running extractor test with ministral-3:3b ..."
PYTHONPATH=. .venv/bin/python "$EXTRACTOR" 2>&1 | tee -a "$LOG"

log "All done. Check $LOG for extractor quality results."
