#!/usr/bin/env bash
# Chain Track A (SFT) → Track B (GRPO) on HF compute.
# Run on an A10G machine after installing deps.
#
# Setup:
#   pip install -q "trl>=0.12" "peft>=0.13" "transformers>=4.46" \
#       "accelerate>=1.1" "bitsandbytes>=0.44" "datasets>=3.0" huggingface_hub
#   huggingface-cli login --token $HF_TOKEN
#
# Run:
#   bash training/v2/run_pipeline.sh
#
# Optional env:
#   HF_PUSH=1            push adapters to HF Hub
#   BASE_MODEL=...       override (default Llama-3.1-8B-Instruct)
#   REPO_ID=...          override HF repo for push (default PayMyBills/bestdealbot-v2)
#   N_TRAIN=512          SFT training rows
#   N_PROMPTS=256        GRPO prompts
#   MAX_STEPS=100        GRPO max training steps

set -euo pipefail

cd "$(dirname "$0")/../.."

echo "=== Track A: SFT ==="
PYTHONPATH=. python training/v2/sft.py

# Find the most recent SFT adapter dir
SFT_DIR=$(ls -1dt runs/*sft_8b 2>/dev/null | head -1)
if [ -z "$SFT_DIR" ]; then
    echo "ERROR: no SFT run dir found in runs/" >&2
    exit 1
fi
SFT_ADAPTER="$SFT_DIR/adapter"

if [ ! -d "$SFT_ADAPTER" ]; then
    echo "ERROR: SFT adapter not at $SFT_ADAPTER" >&2
    exit 1
fi

echo
echo "=== Track B: GRPO (using $SFT_ADAPTER) ==="
SFT_ADAPTER_DIR="$SFT_ADAPTER" PYTHONPATH=. python training/v2/grpo.py

echo
echo "=== PIPELINE DONE ==="
echo "SFT run:  $SFT_DIR"
echo "GRPO run: $(ls -1dt runs/*grpo_8b | head -1)"
