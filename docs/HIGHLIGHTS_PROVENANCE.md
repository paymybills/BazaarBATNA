# UI numbers — provenance

Every benchmark number rendered on the BazaarBATNA site is sourced from a real evaluation run uploaded to a public HF dataset. This doc maps where each number lives in the UI to its source on HF.

## Landing page (`/`) — "State of the playground"

A two-tab section: **Sauda v2** (default) and **Sauda v1** (clickable, kept for transparency).

### Sauda v2 tab

90 episodes per policy, derived from the per-episode `results_*.jsonl` files at:

- https://huggingface.co/datasets/PayMyBills/scaling-eval-runs

Specifically:

| Policy | Source run | tag |
|---|---|---|
| `llama-3.2-3b base` | `20260425_170653_scaling_eval/` | `llama_3b_base_tells_on` |
| `llama-3.1-8b base` | `20260425_172940_scaling_eval/` | `llama_8b_base_tells_on` |
| `sauda v2 (8b sft+grpo)` | `20260425_170703_scaling_eval/` | `sauda_8b_v2_ablation_tells_off` |

Numbers are derived from per-episode rows: `buyer_share = (buyer_budget - agreed_price) / (buyer_budget - seller_cost)` averaged over closed deals; `mutual_loss = (walks + expired) / n`; `win_rate = fraction of episodes with buyer_share > 0.55`. n=90 per policy across `single_deal`, `asymmetric_pressure`, `amazon_realistic` (30 each).

The "best Sauda" config shown on the product page is **tells off**, which beats tells on by 0.033 mean surplus across the three tasks. We reproduce both in `docs/BLOG.md`.

### Sauda v1 tab

60 episodes per policy from the older eval at:

- `eval/out/summary_*.json` in this repo

Same field names, but ran against an earlier version of `LLMSeller` (pre-`ef753a6`) that didn't auto-accept at reservation. The seller leaked surplus, so the numbers look better than v2's. We keep them under a clearly-labeled tab with a caveat note.

## Replay highlights (`/replay`)

Three curated highlight cards. Each links to a `/replay/<id>` page with the full transcript and chart.

| Card | Real episode source |
|---|---|
| Amazon best haggle | best `amazon_realistic` close in `sauda_8b_v2_ablation_tells_off` (Sennheiser CX 80S, ₹1,990 → ₹1,095, 94.5% surplus) |
| Single-deal grind | best `single_deal` close in same run (silk scarf, ₹60 → ₹32, 97.9% surplus) |
| Asymmetric-pressure win | best `asymmetric_pressure` close in same run (silk scarf, ₹60 → ₹32, 97.9% surplus) |

Transcripts on `/replay/<id>` are byte-for-byte the buyer/seller messages from those episodes. No editorial smoothing, no rephrasing.

## Reproducing

```bash
# Pull the eval datasets locally
hf download PayMyBills/scaling-eval-runs --repo-type dataset --local-dir /tmp/scaling

# Pretty-print all summaries
python3 -c "
import json, glob
for f in sorted(glob.glob('/tmp/scaling/*/summary_*.json')):
    d = json.load(open(f))
    print(f, d.get('_meta', {}))
    for k, v in d.items():
        if k == '_meta': continue
        print(' ', k, v)
"
```

The exact HF Job invocations that produced these runs are in `scripts/run_scaling_eval_hfjobs.sh` (env-var driven, fully reproducible from the committed git SHA `ca199a0` onwards).

## Why no `read_the_tells` or `career_10` numbers on the v2 tab?

The v2 scaling ladder evaluates three tasks: `single_deal`, `asymmetric_pressure`, `amazon_realistic`. We didn't re-run `read_the_tells` and `career_10` against the hardened seller in time. Those tasks remain valid (graders are in `bazaarbot_env/tasks.py`, source code unchanged) but their numbers on the v1 tab are not directly comparable to v2.

`read_the_tells` specifically expects a "tells channel" the buyer can read; the v2 tells ablation found that the channel adds noise to inference-time steering — explored in `docs/BLOG.md`.

## Known not-rendered metrics

These are computed and uploaded but not currently on the site. They're in the README and blog instead:

- Tells ablation comparison (Sauda v2 with tells on vs off)
- Seller-quality eval (5 of 6 acceptance criteria pass)
- Per-task surplus breakdowns

These exist in:

- `PayMyBills/scaling-eval-runs/20260426_025930_scaling_eval/` (tells_on)
- `PayMyBills/seller-quality-runs/20260425_140513_seller_quality/`
