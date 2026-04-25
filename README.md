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

BazaarBATNA is an OpenEnv-compliant negotiation project with two deliverables:

1. **BazaarBATNA Platform**: the environment, API server, tasks, UI, replay/arena systems.
2. **BazaarBot Agent**: the trained buyer model and its inference/evaluation pipeline.

## Headline results

| Policy | amazon_realistic | read_the_tells | career_10 | deal rate |
|---|---:|---:|---:|---:|
| `rule_based` | 0.396 | 0.041 | 0.805 | 95 / 5 / 100 |
| `baseline:llama3.2:3b` | 0.234 | 0.308 | 0.705 | 100 / 65 / 100 |
| **`ollama:bestdealbot`** | **0.913** | **0.418** | **0.972** | **100 / 100 / 100** |

n=20 per task. Mean normalized surplus on [0, 1]. Bestdealbot wins every task and closes 100% of deals.

- **+131%** vs rule-based on `amazon_realistic`
- **+916%** vs rule-based on `read_the_tells` (the tells-heavy suite)
- Stack runs in ~7 GB VRAM (RTX 2050 class)

See [`SAMPLE_NEGOTIATIONS.md`](SAMPLE_NEGOTIATIONS.md) for full transcripts. Sister landing-page repo: [paymybills/Sauda](https://github.com/paymybills/Sauda).

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

## BazaarBot Agent

### Current strategy shape

The buyer is a trained Llama-3.2-3B adapter plus runtime steering:

- **LLM policy** proposes JSON action (`offer` / `accept` / `walk`).
- **Bayesian persuasion steering** estimates seller urgency/flexibility from tells and concession behavior.
- **Adaptive fallback** raises close-threshold near deadline to reduce premature walks and low deal-rate behavior.

In code:

- `bazaarbot_env/gym_wrapper.py`: `parse_action(...)`, `steer_bayesian_action(...)`
- `eval/eval_harness.py`: steering enabled for `--policy ollama`, baseline kept unsteered

### Agent creation walkthrough (what we did)

#### 1) SFT warmup in Kaggle

- Built supervised pairs from rule-based behavior.
- Trained LoRA adapter on `unsloth/Llama-3.2-3B-Instruct`.
- Goal: reliable strict JSON output.

#### 2) GRPO stage

- Ran environment-reward GRPO on negotiation prompts/tasks.
- Pushed adapter artifacts to HF repo:
  - `PayMyBills/bestdealbot`

#### 3) Local Ollama bring-up

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

`eval/eval_harness.py` supports:

- `--policy rule_based`
- `--policy baseline --baseline_model llama3.2:3b`
- `--policy ollama --model bestdealbot`

Example:

```bash
PYTHONPATH=. python eval/eval_harness.py --policy ollama --model bestdealbot --tasks amazon_realistic --n 10
```

Outputs:

- `eval/out/results_*.jsonl`
- `eval/out/summary_*.json`

---

## Latest benchmark snapshot (n=20)

Tasks: `amazon_realistic`, `read_the_tells`, `career_10`  
Policies: `rule_based`, `baseline:llama3.2:3b`, `ollama:bestdealbot` (with Bayesian steering + adaptive fallback)

| Policy | Task | Mean normalized surplus | Deal rate | Mean rounds |
|---|---|---:|---:|---:|
| rule_based | amazon_realistic | 0.3957 | 0.95 | 3.8 |
| baseline:llama3.2:3b | amazon_realistic | 0.2341 | 1.00 | 2.05 |
| ollama:bestdealbot | amazon_realistic | **0.9132** | 1.00 | 7.5 |
| rule_based | read_the_tells | 0.0411 | 0.05 | 2.0 |
| baseline:llama3.2:3b | read_the_tells | 0.3079 | 0.65 | 1.9 |
| ollama:bestdealbot | read_the_tells | **0.4176** | 1.00 | 2.0 |
| rule_based | career_10 | 0.8045 | 1.00 | 3.9 |
| baseline:llama3.2:3b | career_10 | 0.7050 | 1.00 | 1.95 |
| ollama:bestdealbot | career_10 | **0.9717** | 1.00 | 7.8 |

Source files:

- `eval/out/summary_rule_based.json`
- `eval/out/summary_baseline_llama3.2_3b.json`
- `eval/out/summary_ollama_bestdealbot.json`

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
