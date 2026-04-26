#!/usr/bin/env bash
# Run the BazaarBot scaling-ladder eval for a single adapter on HF Jobs.
#
# Why this exists:
#   We have three Sauda adapters to compare against the hardened Gemma-4-E4B
#   seller — v2 (canonical), v2-tells (Ankur's tells-in-loop run), and v3
#   (DPO on top of v2). Each one needs a 90-episode eval against the same
#   task suite. Running them as parallel HF Jobs is faster, cheaper, and
#   reproducible vs running on a laptop.
#
# Usage:
#     # Eval v2 (canonical)
#     MODEL_REPO=PayMyBills/bestdealbot-v2 bash scripts/run_eval_hfjobs.sh
#
#     # Eval v2-tells (Ankur's run) on his account
#     HF_USER=ankur-1232 MODEL_REPO=ankur-1232/bestdealbot-v2-tells \
#         bash scripts/run_eval_hfjobs.sh
#
#     # Eval v3 (DPO)
#     MODEL_REPO=PayMyBills/bestdealbot-v3 bash scripts/run_eval_hfjobs.sh
#
#     # Smoke (10 ep per task, 3 tasks = 30 episodes)
#     N_PER_TASK=10 MODEL_REPO=PayMyBills/bestdealbot-v2 \
#         bash scripts/run_eval_hfjobs.sh
#
# Env-vars:
#     MODEL_REPO          — adapter repo to evaluate (REQUIRED)
#     BASE_MODEL          — base model (default unsloth/Meta-Llama-3.1-8B-Instruct)
#     N_PER_TASK          — episodes per task (default 30 → 90 total across 3 tasks)
#     TASKS               — space-separated task ids (default 3 standard tasks)
#     RESULTS_REPO        — dataset repo for results dump (default <user>/sauda-eval-runs)
#     HF_USER             — HF username (auto-detected from cached login if unset)
#     FLAVOR              — HF Jobs flavor (default a10g-large — eval is single-policy, 1xA10G is plenty)
#     TIMEOUT             — job timeout (default 2h)

set -eo pipefail

if [ -z "${MODEL_REPO:-}" ]; then
    echo "ERROR: MODEL_REPO is required. Example:" >&2
    echo "    MODEL_REPO=PayMyBills/bestdealbot-v2 bash scripts/run_eval_hfjobs.sh" >&2
    exit 1
fi

FLAVOR="${FLAVOR:-a10g-large}"
N_PER_TASK="${N_PER_TASK:-30}"
TASKS="${TASKS:-single_deal asymmetric_pressure amazon_realistic}"
SEED_BASE="${SEED_BASE:-1000}"
BASE_MODEL="${BASE_MODEL:-unsloth/Meta-Llama-3.1-8B-Instruct}"
TIMEOUT="${TIMEOUT:-2h}"
IMAGE="${IMAGE:-python:3.11-slim}"

# Resolve HF_USER for default RESULTS_REPO
HF_USER="${HF_USER:-}"
if [ -z "$HF_USER" ] && [ -z "${RESULTS_REPO:-}" ]; then
    if [ -n "${HF_TOKEN:-}" ]; then
        HF_USER=$(curl -sf -H "Authorization: Bearer $HF_TOKEN" \
            https://huggingface.co/api/whoami-v2 2>/dev/null | \
            python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
    fi
    if [ -z "$HF_USER" ]; then
        HF_USER=$(timeout 5 hf auth whoami 2>/dev/null | sed -n 's/^user=//p' | head -1)
    fi
    if [ -z "$HF_USER" ]; then
        echo "ERROR: could not resolve HF username." >&2
        echo "       Set HF_USER=<your-hf-username> or pass RESULTS_REPO explicitly." >&2
        exit 1
    fi
fi

RESULTS_REPO="${RESULTS_REPO:-${HF_USER}/sauda-eval-runs}"

# Sanitize MODEL_REPO into a safe tag for the run dir and output filename.
# slashes → dashes; lowercase the result.
SAFE_TAG=$(echo "$MODEL_REPO" | tr '/' '-' | tr '[:upper:]' '[:lower:]')

DETACH="-d"
if [ "${1:-}" = "--foreground" ]; then
    DETACH=""
fi

read -r -d '' JOB_SCRIPT <<'CONTAINER_SCRIPT' || true
set -eux

apt-get update -qq && apt-get install -y -qq git ca-certificates >/dev/null

pip install -q --no-cache-dir \
    "torch>=2.4" \
    "huggingface_hub>=0.30" \
    "transformers>=4.46" \
    "accelerate>=1.1" \
    "bitsandbytes>=0.44" \
    "peft>=0.13" \
    "datasets>=3.0" \
    "sentencepiece>=0.2" \
    "requests>=2.31" \
    "pydantic>=2.0"

git clone --depth 1 https://github.com/paymybills/BazaarBATNA.git /workspace/repo
cd /workspace/repo

mkdir -p eval/out

# Run the harness with the HF policy, applying the LoRA adapter on top of base.
# `--hf_steer 1` keeps Bayesian post-hoc steering on (matches v2's 0.799 setup).
PYTHONPATH=. python -u eval/eval_harness.py \
    --policy hf \
    --hf_base "$BASE_MODEL" \
    --hf_adapter "$MODEL_REPO" \
    --hf_steer 1 \
    --n "$N_PER_TASK" \
    --tasks $TASKS \
    --seed_base "$SEED_BASE" \
    --tag "$SAFE_TAG" \
    --out_dir eval/out

LATEST_FILE=$(ls -1t eval/out/results_*${SAFE_TAG}*.jsonl 2>/dev/null | head -1 || true)
SUMMARY_FILE=$(ls -1t eval/out/summary_*${SAFE_TAG}*.json 2>/dev/null | head -1 || true)

# Push results dir to a dataset repo for collation
RUN_TS=$(date -u +%Y%m%d_%H%M%S)
RUN_NAME="${RUN_TS}_${SAFE_TAG}"

RESULTS_REPO="$RESULTS_REPO" RUN_NAME="$RUN_NAME" python - <<PYEOF
import os, glob, json
from huggingface_hub import HfApi
api = HfApi()
repo_id = os.environ["RESULTS_REPO"]
api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True)
api.upload_folder(
    folder_path="eval/out",
    path_in_repo=os.environ["RUN_NAME"],
    repo_id=repo_id,
    repo_type="dataset",
    commit_message=f"eval results: {os.environ['RUN_NAME']}",
)
print(f"Pushed eval results to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting eval HF Job:"
echo "  flavor:         $FLAVOR"
echo "  base model:     $BASE_MODEL"
echo "  adapter:        $MODEL_REPO"
echo "  n_per_task:     $N_PER_TASK   tasks: $TASKS"
echo "  results dump:   $RESULTS_REPO/${RUN_TS:-<run_ts>}_${SAFE_TAG}"
echo "  timeout:        $TIMEOUT"
if [ -n "${HF_TOKEN:-}" ]; then
    echo "  identity:       via inline HF_TOKEN (NOT cached login)"
else
    echo "  identity:       cached `hf auth login`"
fi
echo

hf jobs run \
    $DETACH \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    -e BASE_MODEL="$BASE_MODEL" \
    -e MODEL_REPO="$MODEL_REPO" \
    -e SAFE_TAG="$SAFE_TAG" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    -e N_PER_TASK="$N_PER_TASK" \
    -e TASKS="$TASKS" \
    -e SEED_BASE="$SEED_BASE" \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs: hf jobs logs <job_id>"
fi
