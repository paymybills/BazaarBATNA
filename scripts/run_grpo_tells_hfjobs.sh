#!/usr/bin/env bash
# Continue Sauda v2-tells SFT with GRPO, end-to-end on HF Jobs.
#
# Picks up where run_sft_tells_hfjobs.sh left off: loads the SFT-with-tells
# adapter and runs GRPO with the shaped first-step reward, prompts split
# 50/50 between reset() and one-step-ahead (so mid-rollout tells distribution
# is also covered).
#
# Designed to chain immediately after the SFT run finishes:
#   1. SFT job → pushes <user>/bestdealbot-v2-tells
#   2. GRPO job → loads <user>/bestdealbot-v2-tells, trains on top,
#      pushes back to the same repo (so the final adapter is SFT+GRPO).
#
# Usage:
#     # Same identity as the SFT run
#     HF_TOKEN=hf_teammate_xxx bash scripts/run_grpo_tells_hfjobs.sh
#
#     # Smoke (very small)
#     N_PROMPTS=32 MAX_STEPS=10 HF_TOKEN=hf_teammate_xxx \
#         bash scripts/run_grpo_tells_hfjobs.sh

set -eo pipefail

FLAVOR="${FLAVOR:-a10g-large}"
N_PROMPTS="${N_PROMPTS:-128}"
MAX_STEPS="${MAX_STEPS:-30}"
SEED="${SEED:-0}"
BASE_MODEL="${BASE_MODEL:-unsloth/Meta-Llama-3.1-8B-Instruct}"
TIMEOUT="${TIMEOUT:-3h}"
IMAGE="${IMAGE:-python:3.11-slim}"

if [ -z "${HF_TOKEN:-}" ]; then
    echo "WARNING: HF_TOKEN not set. Using cached `hf auth login` identity." >&2
fi

# Default REPO_ID and SFT_HF_REPO to the token-owner's namespace
USERNAME=""
if [ -n "${HF_TOKEN:-}" ]; then
    USERNAME=$(curl -sf -H "Authorization: Bearer $HF_TOKEN" \
        https://huggingface.co/api/whoami-v2 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
fi
if [ -z "$USERNAME" ]; then
    USERNAME="PayMyBills"
fi
SFT_HF_REPO="${SFT_HF_REPO:-${USERNAME}/bestdealbot-v2-tells}"
REPO_ID="${REPO_ID:-${USERNAME}/bestdealbot-v2-tells}"
RESULTS_REPO="${RESULTS_REPO:-${USERNAME}/grpo-tells-runs}"

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
    "trl>=0.12" \
    "datasets>=3.0" \
    "sentencepiece>=0.2" \
    "requests>=2.31" \
    "pydantic>=2.0"

git clone --depth 1 https://github.com/paymybills/BazaarBATNA.git /workspace/repo
cd /workspace/repo

HF_PUSH=1 \
ENABLE_TELLS_IN_LOOP=1 \
BASE_MODEL="$BASE_MODEL" \
SFT_HF_REPO="$SFT_HF_REPO" \
REPO_ID="$REPO_ID" \
N_PROMPTS="$N_PROMPTS" \
MAX_STEPS="$MAX_STEPS" \
SEED="$SEED" \
PYTHONPATH=. python -u training/v2/grpo.py

LATEST_RUN=$(ls -1dt runs/*_grpo_8b 2>/dev/null | head -1 || true)
if [ -n "$LATEST_RUN" ]; then
    RUN_NAME=$(basename "$LATEST_RUN")
    RESULTS_REPO="$RESULTS_REPO" RUN_NAME="$RUN_NAME" LATEST_RUN="$LATEST_RUN" \
    python - <<PYEOF
import os
from huggingface_hub import HfApi
api = HfApi()
repo_id = os.environ["RESULTS_REPO"]
api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True)
api.upload_folder(
    folder_path=os.environ["LATEST_RUN"],
    path_in_repo=os.environ["RUN_NAME"],
    repo_id=repo_id,
    repo_type="dataset",
    commit_message=f"grpo-tells-in-loop run from HF Jobs",
)
print(f"Pushed run dir to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF
fi

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting GRPO-tells-in-loop HF Job:"
echo "  flavor:        $FLAVOR"
echo "  base model:    $BASE_MODEL"
echo "  start adapter: $SFT_HF_REPO"
echo "  push to:       $REPO_ID"
echo "  N_PROMPTS:     $N_PROMPTS  MAX_STEPS: $MAX_STEPS"
echo "  timeout:       $TIMEOUT"
if [ -n "${HF_TOKEN:-}" ]; then
    echo "  identity:      via inline HF_TOKEN (NOT cached login)"
else
    echo "  identity:      cached `hf auth login`"
fi
echo

hf jobs run \
    $DETACH \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    -e BASE_MODEL="$BASE_MODEL" \
    -e SFT_HF_REPO="$SFT_HF_REPO" \
    -e REPO_ID="$REPO_ID" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    -e N_PROMPTS="$N_PROMPTS" \
    -e MAX_STEPS="$MAX_STEPS" \
    -e SEED="$SEED" \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs: hf jobs logs <job_id>"
fi
