#!/usr/bin/env bash
# Wait for extractor eval to finish, then re-run bestdealbot eval with conversation
# realism. Logs to runs/{ts}_post_pipeline/ so artifacts persist past reboot.
#
# Run:  bash scripts/run_after_extractor.sh &

set -u
PROJECT_ROOT="/home/meow/Documents/Projects/MetaThon"
cd "$PROJECT_ROOT"

TS=$(date '+%Y%m%d_%H%M%S')
RUN_DIR="runs/${TS}_post_pipeline"
mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/stdout.log"
EVAL_DIR="${1:-}"

if [ -z "$EVAL_DIR" ]; then
    EVAL_DIR=$(ls -1dt runs/*extractor_eval 2>/dev/null | head -1)
fi

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "Watching extractor eval: $EVAL_DIR"
log "Will auto-run bestdealbot eval re-run when summary.json appears."

# Phase 1: wait for extractor eval to finish
while true; do
    if [ -f "$EVAL_DIR/summary.json" ]; then
        log "Extractor eval done. Summary:"
        cat "$EVAL_DIR/summary.json" | tee -a "$LOG"
        break
    fi
    if [ -f "$EVAL_DIR/metrics.jsonl" ]; then
        n=$(wc -l < "$EVAL_DIR/metrics.jsonl")
        log "Progress: $n metric rows logged"
    else
        log "Metrics file not found yet"
    fi
    sleep 60
done

# Phase 2: stop ministral to free VRAM for bestdealbot
log "Stopping ministral to free VRAM ..."
ollama stop ministral-3:3b 2>&1 | tee -a "$LOG" || true
sleep 3

# Phase 3: pre-warm bestdealbot
log "Pre-warming bestdealbot ..."
curl -s http://localhost:11434/api/generate \
    -d '{"model": "bestdealbot", "prompt": "warmup", "stream": false}' \
    > /dev/null 2>&1 || log "warmup call failed (continuing)"
sleep 2

# Phase 4: re-run bestdealbot eval (n=20 per task, 3 tasks = 60 episodes)
log "Starting bestdealbot eval re-run with conversation realism ..."
EVAL_OUT_DIR="$RUN_DIR/eval_out"
mkdir -p "$EVAL_OUT_DIR"
PYTHONPATH=. .venv/bin/python eval/eval_harness.py \
    --policy ollama --model bestdealbot \
    --tasks amazon_realistic read_the_tells career_10 \
    --n 20 \
    --out_dir "$EVAL_OUT_DIR" 2>&1 | tee -a "$LOG"

# Mirror to canonical eval/out/ alongside v1 results (don't overwrite — keep diff)
log "Mirroring results to eval/out_v2/ ..."
mkdir -p eval/out_v2
cp -r "$EVAL_OUT_DIR/." eval/out_v2/ 2>&1 | tee -a "$LOG" || true

# Phase 5: re-run scoring with new transcripts (now reads both v1 and v2 if mirrored)
log "Recomputing symmetric scores ..."
PYTHONPATH=. .venv/bin/python eval/scoring.py 2>&1 | tee -a "$LOG"

# Phase 6: write a config.json + summary.json for this whole pipeline run
cat > "$RUN_DIR/config.json" <<EOF
{
  "pipeline": "post_extractor_pipeline",
  "timestamp": "$TS",
  "watched_extractor_eval": "$EVAL_DIR",
  "git_sha": "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)",
  "phases": ["wait_extractor", "stop_ministral", "warm_bestdealbot", "eval_v2", "scoring"]
}
EOF

cat > "$RUN_DIR/summary.json" <<EOF
{
  "status": "complete",
  "extractor_eval_summary": "$(cat $EVAL_DIR/summary.json 2>/dev/null | tr '\n' ' ' | head -c 4000)",
  "v2_eval_dir": "$EVAL_OUT_DIR",
  "log": "$LOG"
}
EOF

log "All done. Run dir: $RUN_DIR"
log "Logs: $LOG"
log "v2 eval results: $EVAL_OUT_DIR"
