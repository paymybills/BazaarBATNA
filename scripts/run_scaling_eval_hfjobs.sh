#!/usr/bin/env bash
# Scaling-ladder buyer eval on HF Jobs A10G.
#
# Runs eval/eval_harness.py for each (base, adapter) pair in the LADDER below
# against the same Gemma seller, n=N_EPISODES per task, then uploads every
# results_*.jsonl + summary_*.json under one run dir to RESULTS_REPO.
#
# Story this produces: SFT 3B vs base 3B vs SFT 8B vs base 8B vs (optionally) 70B
# on the same harness, same seeds, same seller. Tomorrow afternoon artifact.
#
# Usage:
#     bash scripts/run_scaling_eval_hfjobs.sh                  # detached
#     bash scripts/run_scaling_eval_hfjobs.sh --foreground     # streams logs
#     N_EPISODES=20 bash scripts/run_scaling_eval_hfjobs.sh    # smoke
#     LADDER=custom bash scripts/run_scaling_eval_hfjobs.sh    # edit LADDER inline first

set -eo pipefail

FLAVOR="${FLAVOR:-a10g-small}"
N_EPISODES="${N_EPISODES:-50}"
SEED_BASE="${SEED_BASE:-1000}"
TASKS="${TASKS:-single_deal asymmetric_pressure amazon_realistic}"
RESULTS_REPO="${RESULTS_REPO:-PayMyBills/scaling-eval-runs}"
TIMEOUT="${TIMEOUT:-3h}"
IMAGE="${IMAGE:-python:3.11-slim}"
# Buyer policy must call into the seller env. The env spawns LLMSeller using
# SELLER_MODEL when the task is configured; we set that env-var inside the
# container. Default = the same Gemma we ran in seller_quality.
SELLER_MODEL="${SELLER_MODEL:-google/gemma-4-E4B}"
# Ablation knobs (forwarded to eval/eval_harness.py)
ENABLE_NLP="${ENABLE_NLP:-0}"          # 1 = route seller msgs through ministral NLP extractor
TAG_SUFFIX="${TAG_SUFFIX:-}"           # extra filename suffix, e.g. tells_on / tells_off

# LADDER format, one row per line: LABEL|BASE|ADAPTER|STEER
# - LABEL:   short tag for filenames/summary
# - BASE:    HF repo id of the base model
# - ADAPTER: HF repo id of a PEFT adapter, or "-" for none
# - STEER:   1 = enable Bayesian seller-tell steering, 0 = off
#
# Order matters: cheapest first so a partial run still gives a story.
LADDER="${LADDER:-llama_3b_base|meta-llama/Llama-3.2-3B-Instruct|-|0
sauda_3b_sft|meta-llama/Llama-3.2-3B-Instruct|PayMyBills/bestdealbot-3b-sft|1
llama_8b_base|meta-llama/Llama-3.1-8B-Instruct|-|0
sauda_8b_v2_sft|meta-llama/Llama-3.1-8B-Instruct|PayMyBills/bestdealbot-v2|1
sauda_8b_v3_dpo|meta-llama/Llama-3.1-8B-Instruct|PayMyBills/bestdealbot-v3-dpo|1}"

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

OUT_DIR="runs/$(date +%Y%m%d_%H%M%S)_scaling_eval"
mkdir -p "$OUT_DIR"

echo "$LADDER" | while IFS='|' read -r LABEL BASE ADAPTER STEER; do
    [ -z "$LABEL" ] && continue
    echo
    echo "════════════════════════════════════════════════════"
    echo "  $LABEL  base=$BASE  adapter=$ADAPTER  steer=$STEER"
    echo "════════════════════════════════════════════════════"

    ADAPTER_FLAG=""
    if [ "$ADAPTER" != "-" ] && [ -n "$ADAPTER" ]; then
        ADAPTER_FLAG="--hf_adapter $ADAPTER"
    fi

    PYTHONPATH=. python eval/eval_harness.py \
        --policy hf \
        --hf_base "$BASE" \
        $ADAPTER_FLAG \
        --hf_steer "$STEER" \
        --n "$N_EPISODES" \
        --tasks $TASKS \
        --seed_base "$SEED_BASE" \
        --out_dir "$OUT_DIR" \
        --enable_nlp "$ENABLE_NLP" \
        --tag "${LABEL}${TAG_SUFFIX:+_$TAG_SUFFIX}" || echo "  ! $LABEL FAILED — continuing ladder"
done

# Build a one-shot scaling summary that flattens every per-policy summary
python - <<PYEOF
import json, glob, os
out_dir = os.environ.get("OUT_DIR", "$OUT_DIR")
combined = {"rows": [], "tasks": "$TASKS".split()}
for path in sorted(glob.glob(f"{out_dir}/summary_*.json")):
    label = os.path.basename(path).replace("summary_", "").replace(".json","")
    with open(path) as f:
        data = json.load(f)
    meta = data.pop("_meta", {})
    for key, stats in data.items():
        policy, _, task = key.partition("/")
        combined["rows"].append({
            "label": label,
            "policy": policy,
            "task": task,
            **stats,
        })
with open(f"{out_dir}/scaling_summary.json", "w") as f:
    json.dump(combined, f, indent=2)
print(f"Wrote {out_dir}/scaling_summary.json with {len(combined['rows'])} rows")
PYEOF

# Markdown table for the README
python - <<PYEOF
import json, os
out_dir = os.environ.get("OUT_DIR", "$OUT_DIR")
with open(f"{out_dir}/scaling_summary.json") as f:
    data = json.load(f)
# pivot: one row per label, mean across tasks
by_label = {}
for r in data["rows"]:
    by_label.setdefault(r["label"], []).append(r)
lines = ["| Buyer | Mean surplus | Deal rate | Mean rounds | n |", "|---|---|---|---|---|"]
for label, rows in by_label.items():
    n = sum(r["n"] for r in rows)
    surplus = sum(r["mean_normalized_surplus"]*r["n"] for r in rows) / n
    deal = sum(r["deal_rate"]*r["n"] for r in rows) / n
    rounds = sum(r["mean_rounds"]*r["n"] for r in rows) / n
    lines.append(f"| {label} | {surplus:.3f} | {deal:.2f} | {rounds:.1f} | {n} |")
md = "\n".join(lines)
with open(f"{out_dir}/scaling_table.md", "w") as f:
    f.write(md + "\n")
print(md)
PYEOF

echo "Uploading $OUT_DIR to $RESULTS_REPO ..."
RUN_NAME=$(basename "$OUT_DIR")
RESULTS_REPO="$RESULTS_REPO" RUN_NAME="$RUN_NAME" OUT_DIR="$OUT_DIR" python - <<PYEOF
import os
from huggingface_hub import HfApi
api = HfApi()
repo_id = os.environ["RESULTS_REPO"]
api.create_repo(repo_id=repo_id, repo_type="dataset", exist_ok=True)
api.upload_folder(
    folder_path=os.environ["OUT_DIR"],
    path_in_repo=os.environ["RUN_NAME"],
    repo_id=repo_id,
    repo_type="dataset",
    commit_message=f"scaling eval run from HF Jobs",
)
print(f"Pushed to https://huggingface.co/datasets/{repo_id}/tree/main/{os.environ['RUN_NAME']}")
PYEOF

echo "DONE"
CONTAINER_SCRIPT

echo "Submitting scaling-ladder eval job:"
echo "  flavor:     $FLAVOR"
echo "  image:      $IMAGE"
echo "  episodes:   $N_EPISODES per task per row"
echo "  tasks:      $TASKS"
echo "  seller:     $SELLER_MODEL"
echo "  timeout:    $TIMEOUT"
echo "  results →   $RESULTS_REPO"
echo "  ladder:"
echo "$LADDER" | sed 's/^/      /'
echo

hf jobs run \
    $DETACH \
    --flavor "$FLAVOR" \
    --timeout "$TIMEOUT" \
    --secrets HF_TOKEN \
    -e LADDER="$LADDER" \
    -e N_EPISODES="$N_EPISODES" \
    -e SEED_BASE="$SEED_BASE" \
    -e TASKS="$TASKS" \
    -e SELLER_MODEL="$SELLER_MODEL" \
    -e ENABLE_NLP="$ENABLE_NLP" \
    -e TAG_SUFFIX="$TAG_SUFFIX" \
    -e RESULTS_REPO="$RESULTS_REPO" \
    "$IMAGE" \
    bash -c "$JOB_SCRIPT"

if [ -n "$DETACH" ]; then
    echo
    echo "Stream logs with: hf jobs logs <job_id>"
    echo "List jobs with:   hf jobs ps"
fi
