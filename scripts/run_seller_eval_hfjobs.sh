#!/usr/bin/env bash
# Run the seller-quality eval as an HF Job on A10G.
#
# Wires up: clone repo → install deps → download CraigslistBargains →
# run eval/seller_quality.py → upload runs/ dir to HF dataset.
#
# Default hardware: a10g-small (~$1/hr, eval takes ~15-20 min, total ~$0.25).
#
# Usage:
#     bash scripts/run_seller_eval_hfjobs.sh                      # detached, prints job id
#     bash scripts/run_seller_eval_hfjobs.sh --foreground         # streams logs
#     FLAVOR=l4x1 bash scripts/run_seller_eval_hfjobs.sh          # cheaper / pick a different GPU
#     N_EPISODES=20 bash scripts/run_seller_eval_hfjobs.sh        # smoke run with fewer episodes

set -eo pipefail

FLAVOR="${FLAVOR:-a10g-small}"
N_EPISODES="${N_EPISODES:-50}"
SEED="${SEED:-42}"
SPLIT="${SPLIT:-dev}"
MODEL="${MODEL:-google/gemma-4-E4B}"
RESULTS_REPO="${RESULTS_REPO:-PayMyBills/seller-quality-runs}"
TIMEOUT="${TIMEOUT:-1h}"
IMAGE="${IMAGE:-python:3.11-slim}"

DETACH="-d"
if [ "${1:-}" = "--foreground" ]; then
    DETACH=""
fi

# This script body runs inside the container. Variables like $MODEL, $N_EPISODES,
# $SPLIT, $SEED, $RESULTS_REPO are passed in via `hf jobs run -e`. Container
# only — host shell never expands them in this string (single-quoted).
read -r -d '' JOB_SCRIPT <<'CONTAINER_SCRIPT' || true
set -eux

apt-get update -qq && apt-get install -y -qq git ca-certificates >/dev/null

pip install -q --no-cache-dir \
    "torch>=2.4" \
    "huggingface_hub>=0.30" \
    "transformers>=4.46" \
    "accelerate>=1.1" \
    "bitsandbytes>=0.44" \
    "datasets>=3.0" \
    "sentencepiece>=0.2" \
    "requests>=2.31" \
    "pydantic>=2.0"

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

PYTHONPATH=. python eval/seller_quality.py \
    --model "$MODEL" \
    --split "$SPLIT" \
    --n "$N_EPISODES" \
    --seed "$SEED"

LATEST_RUN=$(ls -1dt runs/*_seller_quality | head -1)
echo "Uploading $LATEST_RUN to $RESULTS_REPO ..."
RUN_NAME=$(basename "$LATEST_RUN")
RESULTS_REPO="$RESULTS_REPO" RUN_NAME="$RUN_NAME" LATEST_RUN="$LATEST_RUN" N_EPISODES="$N_EPISODES" python - <<PYEOF
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
    commit_message=f"seller_quality run from HF Jobs (n={os.environ['N_EPISODES']})",
)
print(f"Pushed to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting HF Job:"
echo "  flavor:    $FLAVOR"
echo "  image:     $IMAGE"
echo "  model:     $MODEL"
echo "  episodes:  $N_EPISODES"
echo "  timeout:   $TIMEOUT"
echo "  results →  $RESULTS_REPO"
echo

hf jobs run \
    $DETACH \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    -e MODEL="$MODEL" \
    -e N_EPISODES="$N_EPISODES" \
    -e SEED="$SEED" \
    -e SPLIT="$SPLIT" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs with: hf jobs logs <job_id>"
    echo "List jobs with:   hf jobs ps"
fi
