---
title: BazaarBATNA
emoji: 🪬
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

# BazaarBATNA

BazaarBATNA is an OpenEnv-compliant negotiation environment with two LLM agents that improve through self-play:

- **Sauda** on the buy side — Llama-3.1-8B + QLoRA, trained through **SFT → GRPO → RLAIF/DPO** on this env.
- **Gemma-4-E4B** on the sell side — prompted with persona + four hardened rules baked into code (never accept below reservation, never leak it, counter monotonically, etc).

Both sides infer through asymmetric information. The buyer never sees the seller's reservation. The seller never sees the buyer's budget. **Strategy comes from training, not rules.** The site is for playing against Sauda, watching the arena, or scrubbing replays. The repo is for training your own.

## Submission links

- **HF Space (runnable environment)**: [`PayMyBills/BazaarBATNA`](https://huggingface.co/spaces/PayMyBills/BazaarBATNA)
- **Trained adapter (Sauda v2)**: [`PayMyBills/bestdealbot-v2`](https://huggingface.co/PayMyBills/bestdealbot-v2)
- **Eval datasets**: [`PayMyBills/scaling-eval-runs`](https://huggingface.co/datasets/PayMyBills/scaling-eval-runs) · [`PayMyBills/seller-quality-runs`](https://huggingface.co/datasets/PayMyBills/seller-quality-runs)
- **Training notebooks**: [`training/train_colab.ipynb`](training/train_colab.ipynb) (SFT+GRPO) · [`training/dpo_colab.ipynb`](training/dpo_colab.ipynb) (DPO/RLAIF)
- **Mini-blog**: [`docs/BLOG.md`](docs/BLOG.md) — unfiltered hackathon log, bugs, the ablation that disproved our own hypothesis, goldfish-theater transcript, all receipts.

**Stack:**

- Training: SFT → GRPO → **RLAIF/DPO** (Claude judges preference pairs, buyer learns from the wins)
- Inference: HF Inference Endpoint primary, Ollama fallback, dual-backend with `/sauda/health`
- 12-signal seller-tells observation channel + Bayesian steering — kept as substrate for future in-loop training (current ablation: net-negative at inference time, see below)
- OpenEnv-compliant FastAPI server (`/reset`, `/step`, `/state`, `/score`, `/tasks`)

## Headline results

### Scaling ladder — Sauda v2 vs base models

A clean controlled comparison: same seller (Gemma-4-E4B), same seeds, same tasks, three different buyer policies. n=30 episodes per task.

| Buyer | single_deal | asymmetric | amazon | **Mean** | Deal rate | Rounds |
|---|---:|---:|---:|---:|---:|---:|
| Llama-3.2-3B base | 0.722 | 0.731 | 0.258 | **0.570** | 1.00 | 2.2 |
| Llama-3.1-8B base | 0.818 | 0.787 | 0.430 | **0.678** | 0.99 | 3.1 |
| **Sauda v2** (8B SFT+GRPO) | **0.835** | **0.827** | **0.521** | **0.728** | 0.91 | 6.0 |
| **Sauda v3** (v2 + DPO/RLAIF, n=10*) | 0.820 | 0.807 | 0.457 | 0.695 | **1.00** | 3.5 |

\* v3 was trained on **6 Claude-judged preference pairs** in the final hour and evaluated at smaller n=10 due to the time budget. Smoke eval, directional only.

**Reading this:**
- Scaling 3B → 8B base buys you +19% mean surplus.
- Training on top of 8B (SFT+GRPO) buys you another +7% AND ~2× longer negotiations. Base models capitulate fast (2-3 rounds); Sauda actually plays the game.
- Sauda's deal rate (0.91) is a feature, not a bug — Sauda walks when offers are bad. Base models close any deal regardless of value.
- **v3 trade-off:** 6 preference pairs nudge the policy toward closing — deal rate 0.91 → 1.00 and rounds 6.0 → 3.5, at slight surplus cost. With more pairs (target was 30) we'd expect surplus to recover or surpass v2 while keeping the closing behavior. **The pipeline works end-to-end** — pairs durable on [`ankur-1232/dpo-pairs`](https://huggingface.co/datasets/ankur-1232/dpo-pairs), adapter at [`ankur-1232/bestdealbot-v3`](https://huggingface.co/ankur-1232/bestdealbot-v3).

Datasets: [`PayMyBills/scaling-eval-runs`](https://huggingface.co/datasets/PayMyBills/scaling-eval-runs) (v2 ladder) · [`ankur-1232/sauda-eval-runs`](https://huggingface.co/datasets/ankur-1232/sauda-eval-runs) (v3 smoke)

### Seller quality — 5 of 6 acceptance criteria pass

50-episode `seller_quality` eval against the rule-based buyer:

| Criterion | Result | Target | |
|---|---:|---|---|
| anchored_listing | **100%** | ≥ 0.90 | ✅ |
| never_below_reservation | **0** violations | 0 | ✅ |
| never_leak_reservation | **0** violations | 0 | ✅ |
| mean_rounds | **6.62** | ≥ 4 | ✅ |
| zero_round_capitulation | **0%** | ≤ 0.10 | ✅ |
| persona_consistency | 38% | ≥ 0.70 | ❌ |

The persona_consistency miss is an LLM-self-judge artifact — Gemma classifying its own persona from a 12-turn transcript over 4 overlapping classes. Reported for transparency rather than gamed. Full details in [`docs/BLOG.md`](docs/BLOG.md).

Dataset: [`PayMyBills/seller-quality-runs`](https://huggingface.co/datasets/PayMyBills/seller-quality-runs)

### What Sauda actually says

Real transcript from the eval (single_deal task, listing was a $60 silk scarf):

```
seller: Seller opens: "60 rupees for this handwoven silk scarf. Very fair."
buyer:  thoda kam karo, 39 pe finalize?
seller: Seller: "54 rupees. That's my best offer."
buyer:  35 sahi rate lagta hai mujhe
seller: Seller: "Okay, 48. But that's the limit."
buyer:  31 chalega bhai?
seller: Seller: "I can do 42. Not lower."
buyer:  honestly, 30 is what comparable listings go for
seller: Seller: "I can do 32. Not lower. Someone else was looking at this earlier..."
buyer:  32 mein de dijiye?
seller: Seller: "I can do 32. Not lower."
buyer:  okay 27 — bas yahi ceiling hai
```

Hinglish, register-mixed, references market context, applies pressure. The "32 mein de dijiye" → "okay 27" turn is a real bug we're tracking (multi-turn coherence — buyer doesn't carry memory of its own prior agreement). Documented in the blog.

See [`SAMPLE_NEGOTIATIONS.md`](SAMPLE_NEGOTIATIONS.md) for more. Sister landing-page repo: [paymybills/Sauda](https://github.com/paymybills/Sauda).

---

## Training evidence

Sauda v2 was trained through SFT → GRPO. Both stages logged via the TRL `Trainer` class; full `trainer_state.json` + checkpoints live on the HF model repo at [`PayMyBills/bestdealbot-v2`](https://huggingface.co/PayMyBills/bestdealbot-v2/tree/main/last-checkpoint).

### GRPO (latest stage, n=30 optimization steps)

Pulled live from [`last-checkpoint/trainer_state.json`](https://huggingface.co/PayMyBills/bestdealbot-v2/blob/main/last-checkpoint/trainer_state.json):

| Metric | Step 1 | Step 30 | Notes |
|---|---:|---:|---|
| GRPO loss | 0.0108 | 0.0220 | low magnitude is expected — GRPO loss is the policy-update term, not a likelihood |
| Reward (env score) | 0.9663 | **0.9695** | reward held near ceiling, mean over run = 0.9362 |
| Entropy | 0.510 | 0.420 | policy concentrated as training progressed |
| Total tokens | — | 57.6k | |
| Wall time | — | 43m | a10g-largex2 |

The full per-step log is in `trainer_state.json` (30 entries, each with loss / reward / entropy / grad_norm / clip_ratio / step_time). Reward held above 0.93 every step — the model was already near optimal for this reward formulation by the time GRPO started, so the gain is in the *consistency* and the *strategy shape* visible in the scaling-ladder + seller-quality results above, not in headline reward number movement.

### SFT (warmup stage)

LoRA SFT on supervised pairs from rule-based behavior. Adapter shipped on the same repo. Training notebook reproducible at [`training/train_colab.ipynb`](training/train_colab.ipynb).

### DPO (final stage, in flight)

The DPO run is live as we submit. Two parallel HF Jobs (smoke `a100-large` validating the per-pair-checkpoint upload logic + real `l40sx1` producing the v3 adapter) are training against Claude-judged preference pairs. Run logs upload to [`PayMyBills/dpo-runs`](https://huggingface.co/datasets/PayMyBills/dpo-runs) (and `ankur-1232/dpo-runs` for the in-flight smoke). Reproducible via `bash scripts/run_dpo_hfjobs.sh` — the script builds pairs with `eval/build_dpo_pairs.py` (Claude-as-judge), trains via `training/v2/dpo.py` (TRL `DPOTrainer`), and pushes the adapter automatically. The full setback story (`$BUYER_MODEL` typo eating 4hr of rollouts, monotonicity-guard regression, etc.) is in the blog under "the four-hour rollout that bash ate."

### Independent verification

Anyone can pull the trainer state directly:

```bash
curl -sL "https://huggingface.co/PayMyBills/bestdealbot-v2/raw/main/last-checkpoint/trainer_state.json" | jq '.log_history[0,15,29]'
```

---

## Ablations & negative results

We ran the ablations we promised. One of them came back negative. We're keeping it.

### Inference-time tells channel: doesn't help (yet)

We built a seller-tells channel (12 signals, rule-based pattern matcher, Bayesian steering, optional Ministral extractor) and bolted it on at *inference time* — Sauda was not trained against it. The ablation:

| Setting | Mean surplus | Deal rate | Mean rounds |
|---|---:|---:|---:|
| Sauda v2 / **tells OFF** | **0.728** | 0.91 | 6.0 |
| Sauda v2 / tells ON | 0.695 | 0.88 | 6.0 |

Tells ON underperforms on every task by 1-6%. The diagnosis is that bolt-on signals at inference don't help a buyer that never trained against them — the steering moves prices in directions Sauda didn't learn to compensate for. **The channel and infrastructure remain in the codebase as a substrate for future work** (`enable_nlp` flag, `nlp/keyword_patterns.py`, Ministral extractor). The natural next step is in-loop training: include tells observations during GRPO/DPO so the buyer learns to use them. Full discussion in [`docs/BLOG.md`](docs/BLOG.md).

This is a deliberate choice to report rather than bury. The negative result is the kind of thing that gets quietly dropped from most submissions; we'd rather show the work.

---

## BazaarBATNA Platform

### What it is

The platform simulates buyer-vs-seller bargaining under incomplete information:

- Seller has hidden cost, BATNA pressure, and personality.
- Buyer sees noisy behavioral tells and conversation history.
- Tasks include single-deal, deadline pressure, career-mode reputation, tells-heavy play, and multi-buyer arena.

### Key capabilities

- **OpenEnv API**: `/reset`, `/step`, `/state`, `/score`, `/tasks`, `/health`
- **Advanced endpoints**: WebSocket streaming, counterfactual replay, leaderboard, arena
- **Seller personalities**: default, deceptive, impatient, collaborative
- **Real listings**: Amazon-backed price scales via `data/amazon.csv` (filtered usable listings)
- **UI**: Next.js pages for negotiate/sell/spectate/replay/arena/leaderboard

### Core layout

```text
BazaarBATNA/
├── bazaarbot_env/          # standalone environment package (training + eval import path)
├── server/                 # FastAPI/OpenEnv server
├── ui/                     # Next.js UI
├── training/               # notebook pipeline (SFT -> GRPO)
├── eval/                   # evaluation harness + outputs
├── data/                   # listings data
└── openenv.yaml            # OpenEnv spec metadata
```

---

## Sauda Agent

### Current strategy shape

The buyer is **Sauda v2** — a Llama-3.1-8B QLoRA adapter (SFT + GRPO) plus runtime steering:

- **LLM policy** proposes JSON action (`offer` / `accept` / `walk`) with a Hinglish/English `message` field.
- **Bayesian persuasion steering** estimates seller urgency/flexibility from tells + concession behavior, then gates the raw model action with a Nash-style target offer and adaptive close threshold near deadline.
- **Live serving** via two interchangeable backends — HF Inference Endpoint (primary) or local Ollama (fallback). See `server/sauda_buyer.py` and the `/sauda/health` route.

In code:

- `bazaarbot_env/gym_wrapper.py`: `parse_action(...)`, `steer_bayesian_action(...)`
- `server/sauda_buyer.py`: HF + Ollama backends, env-var driven selection
- `eval/eval_harness.py`: `--policy hf --hf_base ... --hf_adapter ...` for the scaling ladder

### Live serving (the `/sell` page)

The `/sell` page calls `/seller-mode/step` with `strategy="sauda"`, which routes through `server/sauda_buyer.py` to one of two live backends:

| Backend | Selection | Use case |
|---|---|---|
| HF Inference Endpoint | `SAUDA_BACKEND=hf` (default), set `SAUDA_HF_URL` + `SAUDA_HF_TOKEN` | Production / demo |
| Local Ollama | `SAUDA_BACKEND=ollama`, set `SAUDA_OLLAMA_URL` + `SAUDA_OLLAMA_MODEL` | Dev / fallback |
| Rule-based | `SAUDA_BACKEND=rule` | No-LLM testing |

Probe both backends at `/sauda/health`. List available strategies at `/sauda/backends`. If the active backend fails, the server falls back to a rule-based offer with a Hinglish template message — degraded but never broken.

```bash
# Production: HF endpoint
export SAUDA_HF_URL="https://...endpoints.huggingface.cloud"
export SAUDA_HF_TOKEN="hf_..."
python -m server.app

# Dev: local Ollama (assumes `ollama pull bestdealbot` already done)
export SAUDA_BACKEND=ollama
python -m server.app
```

### Reproducing the headline numbers

```bash
# Scaling ladder (3 rows × 30 ep × 3 tasks) on a10g-large, ~$2
FLAVOR=a10g-large N_EPISODES=30 ENABLE_NLP=1 TAG_SUFFIX=tells_on \
  bash scripts/run_scaling_eval_hfjobs.sh

# Tells ablation (Sauda v2, tells off)
FLAVOR=a10g-large N_EPISODES=30 ENABLE_NLP=0 TAG_SUFFIX=tells_off \
  LADDER="sauda_8b_v2|unsloth/Meta-Llama-3.1-8B-Instruct|PayMyBills/bestdealbot-v2|1" \
  bash scripts/run_scaling_eval_hfjobs.sh

# Seller quality eval (50 episodes against rule-based buyer)
N_EPISODES=50 bash scripts/run_seller_eval_hfjobs.sh
```

Results upload to `PayMyBills/scaling-eval-runs` and `PayMyBills/seller-quality-runs`.

### DPO pipeline (scaffolded)

The full RLAIF pipeline is in the repo and runnable end-to-end:

- `eval/build_dpo_pairs.py` — samples two rollouts at different temperatures, asks Claude (or a heuristic fallback) which negotiated better.
- `eval/judge.py` — Claude-as-judge with a heuristic fallback that recognises either-side accepts and a soft tiebreak on stalled negotiations.
- `training/v2/dpo.py` — `trl.DPOTrainer` on top of the v2 SFT+GRPO adapter.
- `scripts/run_dpo_hfjobs.sh` — one-shot HF Job: build pairs → train → push `bestdealbot-v3-dpo`.

Reproduce with one command:

```bash
BUYER_BASE=unsloth/Meta-Llama-3.1-8B-Instruct \
BUYER_ADAPTER=PayMyBills/bestdealbot-v2 \
BUYER_DTYPE=bf16 SELLER_DTYPE=bf16 \
N_PAIRS=100 MAX_ROUNDS=8 \
bash scripts/run_dpo_hfjobs.sh
```

The smoke validates each stage. v3-dpo adapter is gravy on v2; v2 is the canonical buyer.

### Agent creation history

#### 1) SFT warmup

- Built supervised pairs from rule-based behavior.
- Trained QLoRA adapter on `unsloth/Meta-Llama-3.1-8B-Instruct`.
- Goal: reliable strict JSON output with a Hinglish/English `message` field.

#### 2) GRPO stage

- Ran environment-reward GRPO on negotiation prompts/tasks.
- Pushed adapter artifacts to HF repo: [`PayMyBills/bestdealbot-v2`](https://huggingface.co/PayMyBills/bestdealbot-v2)
- Training journal: see [`docs/BLOG.md`](docs/BLOG.md) for the full sequence of bugs (gradient checkpointing during inference produced Korean tokens, EOS token mismatch made every generate run to `max_new_tokens`, the seven dependency-pinning commits, etc.)

#### 3) Local Ollama bring-up (v1 path — kept for reference)

The Sauda v1 adapter (`PayMyBills/bestdealbot`, Llama-3.2-3B base) was packaged for local Ollama serving. This is one of two supported live-serving paths — the other is HF Inference Endpoints, used by the `/sell` page in production. See `server/sauda_buyer.py` for the dual-backend wiring.

Adapter -> merged model -> GGUF -> Ollama registration:

```bash
# adapter download
hf download PayMyBills/bestdealbot --repo-type model --local-dir ~/models/bdb

# merge base + LoRA (PEFT API)
# output: ~/models/bdb-merged-sharded

# convert merged model to GGUF
python llama.cpp/convert_hf_to_gguf.py ~/models/bdb-merged-sharded \
  --outfile ~/models/bdb-q8_0.gguf --outtype q8_0

# register in Ollama
cat > ~/models/bdb-q8.Modelfile <<'EOF'
FROM ~/models/bdb-q8_0.gguf
SYSTEM """You are a skilled buyer negotiating at an Indian bazaar."""
EOF
ollama create bestdealbot -f ~/models/bdb-q8.Modelfile
```

Notes:

- This machine path used **Q8_0 GGUF** due to unavailable local quantizer toolchain (`cmake` not installed with sudo access).
- Model is live as `bestdealbot:latest` in Ollama.

#### 4) Evaluation harness runs

`eval/eval_harness.py` supports four policy types:

- `--policy rule_based` — heuristic baseline
- `--policy baseline --baseline_model llama3.2:3b` — prompted-base via Ollama
- `--policy ollama --model bestdealbot` — Sauda via local Ollama
- `--policy hf --hf_base <hf_repo> [--hf_adapter <peft_adapter>]` — Sauda via HF transformers (used in the scaling ladder)

Examples:

```bash
# Local Ollama eval
PYTHONPATH=. python eval/eval_harness.py --policy ollama --model bestdealbot \
  --tasks amazon_realistic --n 10

# HF transformers eval (the scaling-ladder path)
PYTHONPATH=. python eval/eval_harness.py --policy hf \
  --hf_base unsloth/Meta-Llama-3.1-8B-Instruct \
  --hf_adapter PayMyBills/bestdealbot-v2 --hf_steer 1 \
  --tasks amazon_realistic asymmetric_pressure single_deal --n 30 \
  --enable_nlp 1 --tag sauda_8b_v2_tells_on
```

Outputs: `eval/out/results_*.jsonl`, `eval/out/summary_*.json`. The HF Jobs runners (`scripts/run_*_hfjobs.sh`) wrap the same harness for cloud runs.

---

## Older benchmark snapshot (Sauda v1, leaky seller)

> ⚠️ **Read this caveat before quoting these numbers.** The 0.91 amazon_realistic figure below was measured against an earlier seller (pre-`ef753a6`) that didn't auto-accept at reservation. After hardening the seller, Sauda v2's number on the same task is 0.521. The buyer didn't regress — the seller stopped leaking surplus. The lower number is the more honest benchmark. We keep both for transparency. Full diff in [`docs/BLOG.md`](docs/BLOG.md) → "sauda v1 and the seller that was secretly garbage".

Tasks: `amazon_realistic`, `read_the_tells`, `career_10`. Policies: `rule_based`, `baseline:llama3.2:3b`, `ollama:bestdealbot` (Sauda v1, with Bayesian steering + adaptive fallback). n=20 per task.

| Policy | Task | Mean normalized surplus | Deal rate | Mean rounds |
|---|---|---:|---:|---:|
| rule_based | amazon_realistic | 0.3957 | 0.95 | 3.8 |
| baseline:llama3.2:3b | amazon_realistic | 0.2341 | 1.00 | 2.05 |
| ollama:bestdealbot (v1) | amazon_realistic | **0.9132** | 1.00 | 7.5 |
| rule_based | read_the_tells | 0.0411 | 0.05 | 2.0 |
| baseline:llama3.2:3b | read_the_tells | 0.3079 | 0.65 | 1.9 |
| ollama:bestdealbot (v1) | read_the_tells | **0.4176** | 1.00 | 2.0 |
| rule_based | career_10 | 0.8045 | 1.00 | 3.9 |
| baseline:llama3.2:3b | career_10 | 0.7050 | 1.00 | 1.95 |
| ollama:bestdealbot (v1) | career_10 | **0.9717** | 1.00 | 7.8 |

Source files: `eval/out/summary_*.json`. The headline scaling-ladder numbers above (Sauda v2 vs base models) are the canonical comparison.

---

## Quickstart

### Local

```bash
git clone https://github.com/paymybills/BazaarBATNA.git
cd BazaarBATNA
chmod +x startup.sh
./startup.sh
```

### Manual server

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server.main:app --reload
```

### UI

```bash
cd ui
npm install
npm run dev
```

---

## Theory references used in design

- Nash bargaining for target settlement framing.
- Rubinstein alternating-offers for time-discounted concession dynamics.
- Folk theorem framing for career-mode reputation and repeated-game adaptation.

---

## License

MIT
