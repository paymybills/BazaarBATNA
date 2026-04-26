#!/usr/bin/env bash
# Run DPO training as an HF Job on A10G.
#
# Pipeline inside container:
#   1. clone repo
#   2. install deps
#   3. build dpo_pairs.jsonl via eval/build_dpo_pairs.py (Claude-as-judge)
#      OR pull pre-built pairs from PAIRS_HF_REPO
#   4. run training/v2/dpo.py — pushes adapter to REPO_ID
#   5. upload run dir to RESULTS_REPO
#
# Usage:
#     bash scripts/run_dpo_hfjobs.sh                          # detached
#     bash scripts/run_dpo_hfjobs.sh --foreground             # streams logs
#     N_PAIRS=30 bash scripts/run_dpo_hfjobs.sh               # smoke
#     SKIP_PAIR_BUILD=1 PAIRS_HF_REPO=PayMyBills/dpo-pairs bash scripts/run_dpo_hfjobs.sh

set -eo pipefail

FLAVOR="${FLAVOR:-a10g-large}"
N_PAIRS="${N_PAIRS:-100}"
MAX_ROUNDS="${MAX_ROUNDS:-6}"
# Pair-build buyer is throwaway sampling — use 3B for ~3x faster generates.
# DPO target adapter (REPO_ID) can still be 8B since the trainer reads pair
# *text*, not whoever generated it.
BUYER_BASE="${BUYER_BASE:-unsloth/Llama-3.2-3B-Instruct}"
BUYER_ADAPTER="${BUYER_ADAPTER:--}"
# DTYPE: "4bit" (low VRAM, slow), "bf16" (more VRAM, ~5x faster), "fp16"
BUYER_DTYPE="${BUYER_DTYPE:-bf16}"
SELLER_DTYPE="${SELLER_DTYPE:-bf16}"
TEMP_A="${TEMP_A:-0.5}"
TEMP_B="${TEMP_B:-0.9}"
SELLER_MODEL="${SELLER_MODEL:-google/gemma-4-E4B}"
SFT_HF_REPO="${SFT_HF_REPO:-PayMyBills/bestdealbot-v2}"
REPO_ID="${REPO_ID:-PayMyBills/bestdealbot-v3-dpo}"
RESULTS_REPO="${RESULTS_REPO:-PayMyBills/dpo-runs}"
PAIRS_HF_REPO="${PAIRS_HF_REPO:-PayMyBills/dpo-pairs}"
SKIP_PAIR_BUILD="${SKIP_PAIR_BUILD:-0}"
BETA="${BETA:-0.1}"
LR="${LR:-5e-6}"
EPOCHS="${EPOCHS:-1}"
TIMEOUT="${TIMEOUT:-3h}"
IMAGE="${IMAGE:-python:3.11-slim}"

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
    "pydantic>=2.0" \
    "anthropic>=0.40"

git clone --depth 1 https://github.com/paymybills/BazaarBATNA.git /workspace/repo
cd /workspace/repo

mkdir -p data
python - <<PYEOF
import json, requests
URLS = {
    "train": "https://worksheets.codalab.org/rest/bundles/0xd34bbbc5fb3b4fccbd19e10756ca8dd7/contents/blob/parsed.json",
    "dev":   "https://worksheets.codalab.org/rest/bundles/0x15c4160b43d44ee3a8386cca98da138c/contents/blob/parsed.json",
}
def to_float(x):
    if x is None: return None
    try: return float(str(x).replace("$","").replace(",",""))
    except: return None
def flatten(ex):
    sc = ex.get("scenario") or {}
    kbs = sc.get("kbs") or []
    seller = next((kb for kb in kbs if (kb.get("personal") or {}).get("Role","").lower()=="seller"), kbs[0] if kbs else None)
    if not seller: return None
    item = seller.get("item") or {}
    desc = item.get("Description")
    if isinstance(desc, list): desc = " ".join(str(x) for x in desc)
    price = to_float(item.get("Price") or (seller.get("personal") or {}).get("Target"))
    if price is None: return None
    return {"category": sc.get("category","unknown"), "title": str(item.get("Title") or "untitled"),
            "description": str(desc or ""), "price": price}
for split, name in [("train","train"), ("dev","dev")]:
    raw = requests.get(URLS[split], timeout=120).json()
    rows = [r for ex in raw if (r := flatten(ex))]
    with open(f"data/{name}.json","w") as f: json.dump(rows, f)
    print(f"  data/{name}.json: {len(rows)} listings")
PYEOF

if [ "$SKIP_PAIR_BUILD" = "1" ]; then
    echo "Pulling pre-built pairs from $PAIRS_HF_REPO"
    python - <<PYEOF
from huggingface_hub import hf_hub_download
import shutil, os
p = hf_hub_download(repo_id=os.environ["PAIRS_HF_REPO"], filename="dpo_pairs.jsonl", repo_type="dataset")
os.makedirs("data", exist_ok=True)
shutil.copy(p, "data/dpo_pairs.jsonl")
print("Copied to data/dpo_pairs.jsonl")
PYEOF
else
    echo "Building $N_PAIRS DPO pairs (judge: Claude-as-judge if ANTHROPIC_API_KEY set, else heuristic)"
    # Pass PAIRS_HF_REPO into the python step so each accepted pair is checkpoint-uploaded
    # to the dataset repo right after it's produced. Then if the script crashes after
    # the rollout loop, we still have every pair we paid for on HF.
    PAIRS_HF_REPO="$PAIRS_HF_REPO" \
    PYTHONPATH=. python -u eval/build_dpo_pairs.py \
        --buyer-base "$BUYER_BASE" \
        --buyer-adapter "$BUYER_ADAPTER" \
        --seller-model "$SELLER_MODEL" \
        --temp-a "$TEMP_A" \
        --temp-b "$TEMP_B" \
        --max-rounds "$MAX_ROUNDS" \
        --n "$N_PAIRS" \
        --out data/dpo_pairs.jsonl
    # Mirror the pairs to a dataset repo so future runs can SKIP_PAIR_BUILD=1.
    # Use a quoted heredoc + os.environ so unbound shell vars don't kill the
    # upload (we lost a 4hr rollout once when an unset $BUYER_MODEL bombed
    # this step under `set -u` *after* the pairs file was already written).
    PAIRS_COMMIT_MSG="pairs built from ${BUYER_ADAPTER} vs ${SELLER_MODEL}, n=${N_PAIRS}" \
    PAIRS_HF_REPO="$PAIRS_HF_REPO" \
    python - <<'PYEOF'
import os
from huggingface_hub import HfApi
api = HfApi()
repo = os.environ["PAIRS_HF_REPO"]
api.create_repo(repo_id=repo, repo_type="dataset", exist_ok=True)
api.upload_file(
    path_or_fileobj="data/dpo_pairs.jsonl",
    path_in_repo="dpo_pairs.jsonl",
    repo_id=repo,
    repo_type="dataset",
    commit_message=os.environ.get("PAIRS_COMMIT_MSG", "dpo pairs upload"),
)
print(f"Mirrored pairs to https://huggingface.co/datasets/{repo}")
PYEOF
fi

# Train
HF_PUSH=1 \
BASE_MODEL="$BUYER_BASE" \
PAIRS_PATH=data/dpo_pairs.jsonl \
SFT_HF_REPO="$SFT_HF_REPO" \
REPO_ID="$REPO_ID" \
BETA="$BETA" LR="$LR" EPOCHS="$EPOCHS" \
PYTHONPATH=. python -u training/v2/dpo.py

LATEST_RUN=$(ls -1dt runs/*_dpo_8b | head -1)
echo "Uploading $LATEST_RUN to $RESULTS_REPO ..."
RUN_NAME=$(basename "$LATEST_RUN")
RESULTS_REPO="$RESULTS_REPO" RUN_NAME="$RUN_NAME" LATEST_RUN="$LATEST_RUN" python - <<PYEOF
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
    commit_message=f"dpo run from HF Jobs",
)
print(f"Pushed to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting DPO HF Job:"
echo "  flavor:           $FLAVOR"
echo "  image:            $IMAGE"
echo "  buyer base:       $BUYER_BASE  ($BUYER_DTYPE)"
echo "  buyer adapter:    $BUYER_ADAPTER"
echo "  buyer temps:      $TEMP_A vs $TEMP_B"
echo "  seller:           $SELLER_MODEL  ($SELLER_DTYPE)"
echo "  start adapter:    $SFT_HF_REPO"
echo "  push to:          $REPO_ID"
echo "  pairs target:     $N_PAIRS  (max_rounds=$MAX_ROUNDS, skip_build=$SKIP_PAIR_BUILD)"
echo "  beta=$BETA  lr=$LR  epochs=$EPOCHS"
echo

# Pass ANTHROPIC_API_KEY through if set (so Claude-as-judge works inside container)
ANTHROPIC_FLAG=""
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    ANTHROPIC_FLAG="-e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
fi

hf jobs run \
    $DETACH \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    -e BUYER_BASE="$BUYER_BASE" \
    -e BUYER_ADAPTER="$BUYER_ADAPTER" \
    -e BUYER_DTYPE="$BUYER_DTYPE" \
    -e SELLER_DTYPE="$SELLER_DTYPE" \
    -e TEMP_A="$TEMP_A" \
    -e TEMP_B="$TEMP_B" \
    -e MAX_ROUNDS="$MAX_ROUNDS" \
    -e SELLER_MODEL="$SELLER_MODEL" \
    -e SFT_HF_REPO="$SFT_HF_REPO" \
    -e REPO_ID="$REPO_ID" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    -e PAIRS_HF_REPO="$PAIRS_HF_REPO" \
    -e SKIP_PAIR_BUILD="$SKIP_PAIR_BUILD" \
    -e N_PAIRS="$N_PAIRS" \
    -e BETA="$BETA" \
    -e LR="$LR" \
    -e EPOCHS="$EPOCHS" \
    $ANTHROPIC_FLAG \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs: hf jobs logs <job_id>"
fi
