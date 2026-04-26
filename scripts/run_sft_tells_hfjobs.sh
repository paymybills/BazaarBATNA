#!/usr/bin/env bash
# Train Sauda v2 SFT with seller-tells *in the prompt*, end-to-end on HF Jobs.
#
# Why this exists:
#   The current Sauda v2 was trained without tells in the obs. Bolting tells on
#   at inference time was a net-negative (see docs/BLOG.md "tells ablation").
#   This run trains a fresh SFT adapter with the tells block visible in every
#   prompt the buyer sees — the natural fix the ablation pointed at.
#
# Designed to run on a teammate's HF token in parallel with the main DPO
# pipeline. Read HF_TOKEN from env (NOT from the cached `hf auth login`)
# so you can prefix the command with HF_TOKEN=hf_xxx and not affect your
# default login.
#
# Usage:
#     # On teammate's account (the inline-prefix path)
#     HF_TOKEN=hf_teammate_xxx bash scripts/run_sft_tells_hfjobs.sh
#
#     # On your account (uses default cached login)
#     bash scripts/run_sft_tells_hfjobs.sh
#
#     # Smoke first
#     N_TRAIN=64 bash scripts/run_sft_tells_hfjobs.sh
#
# Env-vars:
#     HF_TOKEN            — token used for both job submission and HF push
#     N_TRAIN             — number of SFT examples (default 1024)
#     REPO_ID             — push target (default <username>/bestdealbot-v2-tells)
#     BASE_MODEL          — base model (default unsloth/Meta-Llama-3.1-8B-Instruct)
#     FLAVOR              — HF Jobs flavor (default a10g-large)
#     TIMEOUT             — job timeout (default 3h)
#     IMAGE               — container image (default python:3.11-slim)
#     RESULTS_REPO        — dataset repo for run dir upload (default <username>/sft-tells-runs)

set -eo pipefail

FLAVOR="${FLAVOR:-a10g-large}"
N_TRAIN="${N_TRAIN:-1024}"
SEED="${SEED:-42}"
BASE_MODEL="${BASE_MODEL:-unsloth/Meta-Llama-3.1-8B-Instruct}"
TIMEOUT="${TIMEOUT:-3h}"
IMAGE="${IMAGE:-python:3.11-slim}"

# If HF_TOKEN isn't passed inline and isn't in env, fall back to whoever's logged in
if [ -z "${HF_TOKEN:-}" ]; then
    echo "WARNING: HF_TOKEN not set. Using cached `hf auth login` identity." >&2
    echo "         To run on a teammate's account, prefix:" >&2
    echo "             HF_TOKEN=hf_xxx bash scripts/run_sft_tells_hfjobs.sh" >&2
fi

# Default REPO_ID and RESULTS_REPO to the token-owner's namespace if not set
if [ -z "${REPO_ID:-}" ] || [ -z "${RESULTS_REPO:-}" ]; then
    USERNAME=""
    if [ -n "${HF_TOKEN:-}" ]; then
        USERNAME=$(curl -sf -H "Authorization: Bearer $HF_TOKEN" \
            https://huggingface.co/api/whoami-v2 2>/dev/null | \
            python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
    fi
    if [ -z "$USERNAME" ]; then
        USERNAME="PayMyBills"  # fallback
    fi
    REPO_ID="${REPO_ID:-${USERNAME}/bestdealbot-v2-tells}"
    RESULTS_REPO="${RESULTS_REPO:-${USERNAME}/sft-tells-runs}"
fi

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

# Train with tells in the loop. The SFT script reads ENABLE_TELLS_IN_LOOP
# to switch from single-turn-from-reset rollouts (legacy) to multi-turn
# rollouts where prompts at turn>=1 carry seller-tell signals.
HF_PUSH=1 \
ENABLE_TELLS_IN_LOOP=1 \
BASE_MODEL="$BASE_MODEL" \
REPO_ID="$REPO_ID" \
N_TRAIN="$N_TRAIN" \
SEED="$SEED" \
PYTHONPATH=. python -u training/v2/sft.py

LATEST_RUN=$(ls -1dt runs/*_sft_8b 2>/dev/null | head -1 || true)
if [ -n "$LATEST_RUN" ]; then
    echo "Uploading $LATEST_RUN to $RESULTS_REPO ..."
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
    commit_message=f"sft-tells-in-loop run from HF Jobs",
)
print(f"Pushed run dir to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF
fi

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting SFT-tells-in-loop HF Job:"
echo "  flavor:        $FLAVOR"
echo "  image:         $IMAGE"
echo "  base model:    $BASE_MODEL"
echo "  push to:       $REPO_ID"
echo "  results dump:  $RESULTS_REPO"
echo "  N_TRAIN:       $N_TRAIN"
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
    -e REPO_ID="$REPO_ID" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    -e N_TRAIN="$N_TRAIN" \
    -e SEED="$SEED" \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs: hf jobs logs <job_id>"
    echo "  (if running on a teammate's account, prefix the command with HF_TOKEN=hf_xxx)"
fi
