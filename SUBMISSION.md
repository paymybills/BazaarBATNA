# BazaarBot: An Autonomous Negotiation Agent

**OpenEnv Hackathon — Round 2 Submission**
Team: PayMyBills

---

## Problem Statement

**The product is the agent.** BazaarBot is a deal-hunter that negotiates on a
user's behalf — it sees a listing, estimates a fair price, opens with a
calibrated lowball, and either closes the gap or walks away, all without the
user having to haggle themselves. Think "autopilot for r/IndianMarketplace
replies" or a procurement bot that doesn't take the first quote.

The agent is only useful if it's genuinely good at negotiating, which is a
hard problem for three reasons, each mapping to a hackathon theme:

1. **Asymmetric information (world modeling).** The seller knows their cost,
   BATNA, and urgency; the buyer doesn't. An expert human buyer *infers* these
   from behavior — concession speed, phrasing, hesitation. An agent must do
   the same, learning to read noisy observable "tells" as evidence of hidden
   seller state. This is a partially-observable Markov game with hidden types.

2. **Adversarial counterparties (multi-agent).** Sellers actively bluff,
   manipulate, and stage fake walk-aways. A naive agent that takes verbal
   claims at face value gets fleeced. The agent must treat negotiation as a
   game, not an instruction-following task.

3. **Reputation and deadlines (long-horizon).** Real marketplaces have memory
   — if you always capitulate, the next seller opens higher. Real purchases
   have deadlines — if you grind forever, the inventory gets bought by
   someone else. The agent must plan across both dimensions.

The training pipeline — environment-reward RL on a realistic price
distribution, plus a self-improvement loop that uses an LLM judge to
attribute failure modes and generate corrective DPO pairs — is *how* we build
the agent. The environment, tasks, and reward graders are designed to
stress-test exactly the capabilities a deployed negotiation bot needs.

**BazaarBot is an OpenEnv-compliant environment** where a buyer LLM purchases
real items (1,417 Amazon listings with MRP and street-price anchors) from an
adversarial rule-based seller. Four seller personalities (default, deceptive,
impatient, collaborative) each leak hidden state through a distinct
distribution of behavioral tells. Eight graded tasks span single-deal
baselines, hidden-deadline pressure, multi-episode reputation, personality-
specific stress tests, multi-buyer arenas, and the `read_the_tells` task
where verbal claims are deliberately uncorrelated with behavior.

## Theme Alignment

| Theme | How BazaarBot hits it |
|---|---|
| **Multi-Agent Interactions** | Buyer vs. seller with asymmetric private info; `marketplace_arena` task puts multiple buyers in contention for a single item, with coalition-signaling primitives |
| **Long-Horizon Planning & Instruction Following** | `career_10` task runs 10 sequential negotiations with reputation persistence; the seller adapts concession rate based on the buyer's cumulative capitulation. `asymmetric_pressure` gives the buyer a hidden hard deadline, requiring multi-turn planning under time pressure. Action space is strict JSON, testing instruction adherence |
| **World Modeling** | Seller hidden state: cost, BATNA-probability, inventory, personality. Observable "tells" (fidget, posture, eye contact, verbal urgency) are noisy correlates of hidden state. Optimal play requires the buyer to maintain and update a belief over seller type from leaked signals |
| **Self-Improving agent systems** | On-site plan: LLM-judge-in-the-loop DPO. Frozen 4B local model reads rollout transcripts, tags failure modes (capitulated_early, over_anchored, walked_winnable, etc.), generates "repaired" counterfactual actions. Tagged (bad, good) pairs become DPO training data for the next checkpoint. Fully automated after taxonomy definition — no human labels |

## Environment

Open-source, Pydantic-typed, FastAPI-served. Fully OpenEnv-compliant endpoints:

```
POST /reset          → start episode
POST /step           → submit buyer action
GET  /state          → full env state
GET  /score          → graded final score
GET  /tasks          → list available tasks
GET  /health         → server health
```

Additional endpoints for arena/multi-buyer mode, counterfactual replay
(snapshot-based "what if" analysis from any prior round), and WebSocket
streaming for real-time negotiation visualization.

**Repo:** https://github.com/paymybills/BazaarBATNA
**Live demo:** https://metathon.vercel.app (calls HF Inference Endpoint serving Sauda v2)
**HF Space:** https://huggingface.co/spaces/PayMyBills/BazaarBATNA
**Trained models:**
- Sauda v2 (canonical, 8B SFT+GRPO) — https://huggingface.co/PayMyBills/bestdealbot-v2
- Sauda v3 (v2 + DPO/RLAIF) — https://huggingface.co/PayMyBills/bestdealbot-v3
- Sauda v2-tells (GRPO-only, tells in loop) — https://huggingface.co/ankur-1232/bestdealbot-v2-tells
- Sauda v1 (3B SFT+GRPO, baseline) — https://huggingface.co/PayMyBills/bestdealbot

## Agent Capabilities

Action space (strict JSON):
```json
{"action": "offer",  "price": 35.0}
{"action": "accept", "price": null}
{"action": "walk",   "price": null}
```

Observation schema exposes:
- Current round, rounds remaining, max_rounds
- Seller's opening ask, current ask, last concession delta
- Buyer's private budget (hidden from seller)
- Buyer's private deadline (hidden, where applicable)
- Item description (real product name + category from Amazon dataset)
- Seller personality tag (default / deceptive / impatient / collaborative)
- Tell observations (12 noisy signals derived from seller hidden state)
- Career history (prior deal outcomes for multi-episode tasks)

## Tasks

| Name | Difficulty | What it tests |
|---|---|---|
| `single_deal` | easy | Basic negotiation, symmetric info, validates action format + concession reading |
| `asymmetric_pressure` | medium | Hidden buyer deadline + hidden seller inventory pressure. Tests inference from offer velocity |
| `career_10` | hard | 10 sequential deals with reputation carry-over. Tests long-horizon strategy: overly aggressive early moves hurt later |
| `deceptive_seller` | medium | Seller bluffs about demand/urgency; buyer must discount verbal claims against behavioral tells |
| `impatient_seller` | medium | Seller flips time pressure onto buyer but walks fast; buyer must read when "final offer" is real vs. posturing |
| `collaborative_seller` | easy | Fair-dealing seller; tests that agent doesn't leave surplus on the table when the counterparty is cooperative |
| `read_the_tells` | hard | Tells are the primary signal; verbal claims are deliberately uncorrelated with behavior |
| `marketplace_arena` | hard | Multi-buyer competition for limited inventory; coalition signaling |
| `amazon_realistic` | medium | Item + MRP + street price sampled per-episode from 1,417-product Amazon dataset. Tests price-magnitude generalization |

## Reward Model

Per-episode terminal reward combines surplus capture and time discount:

```
surplus       = (buyer_budget - agreed_price) / (buyer_budget - seller_cost)
time_discount = exp(-α · exp(β · t_frac))       α=0.3, β=2.5
reward        = clip(surplus · time_discount + rep_leak + penalties, 0, 1)
```

Where `rep_leak = -0.1 · capitulation_rate` in career mode (reputation
penalty for historically weak buyers), and penalties cover stalling
(repeated identical offers), walking away, and out-of-range actions.

Training-time reward (for GRPO on single-turn opening strategy) uses a
bell-curve shape around price/ask = 0.25 — strong anchors rewarded, but
absurdly low offers that would cause seller walk are penalized:

```
shape(ratio) = exp(-(ratio - 0.25)² / 0.08)
```

Per-task graders in `bazaarbot_env/tasks.py` compose episode rewards
across multi-episode tasks (mean normalized surplus, with reputation
adjustments for career_10).

## Post-Training / Self-Improvement Strategy

Four-stage ladder, all stages shipped and evaluated. The buyer ships as
**Sauda v2** (8B SFT+GRPO); v3 (DPO/RLAIF on top of v2) and v2-tells
(GRPO-only with tells in the loop) are available as comparison adapters.

### Stage 0 — Sauda v1 baseline (✓ shipped)

Llama-3.2-3B-Instruct + LoRA, SFT (256 pairs, loss 3.0 → 0.21) → GRPO
(256 prompts, 30 steps). Validates the pipeline and produces a 3B
baseline for the scaling ladder. Repo: `PayMyBills/bestdealbot`.

### Stage 1 — Sauda v2 SFT warmup (✓ shipped)

Scaled to **Llama-3.1-8B-Instruct** (QLoRA, 4-bit). 1024
(observation, rule-based-buyer-action) pairs. Teaches strict JSON output
and sensible opening behavior. Trains in ~25 min on a10g-large.

### Stage 2 — Sauda v2 GRPO (✓ shipped, this is the canonical model)

Environment-reward GRPO with shaped first-step reward. 256 prompts
across `amazon_realistic` + `single_deal` + `asymmetric_pressure`.
`num_generations=2`, `max_steps=30`. Per-step `trainer_state.json`
published live on the model repo. Result: **mean normalized surplus
0.728** across the 3-task suite (vs 0.570 for the 3B baseline,
0.678 for the 8B base — clean scaling signal). Repo:
`PayMyBills/bestdealbot-v2`.

### Stage 2-tells — GRPO with tells in the loop (✓ shipped, ablation)

Same GRPO recipe but `ENABLE_TELLS_IN_LOOP=1` injects seller-tell
signals into multi-turn rollouts so the buyer trains *against* tell
information instead of seeing it for the first time at inference.
Result: deal rate 1.00, rounds 3.0, mean surplus 0.653. The
direct comparison vs vanilla v2 is unfair (v2-tells skipped the SFT
warmup), so we read this as evidence that tells-in-loop trains
stably, not as evidence that tells help or hurt. A proper
SFT-with-tells → GRPO-with-tells run was queued late in the
hackathon window and is included in the model lineup.
Repo: `ankur-1232/bestdealbot-v2-tells`.

### Stage 3 — DPO/RLAIF on top of v2 (✓ shipped as Sauda v3)

This is the self-improvement loop. The judge tags failure modes on
rollouts, generates "repaired" actions, and the (bad, good) pairs
become DPO training data. Fully automated after the failure taxonomy
is fixed once.

```
for round in unsupervised_loop:
    # 1. Rollout: current policy negotiates N episodes
    transcripts = [rollout(policy, sample_task()) for _ in range(N)]

    # 2. Judge: classifies failure modes per transcript
    #    Taxonomy: {capitulated_early, over_anchored, walked_winnable,
    #               ignored_tells, missed_accept, invalid_json, other}
    tagged = [(t, judge.classify(t)) for t in transcripts]

    # 3. Repair: judge rewrites the bad turn
    pairs = []
    for transcript, tag in tagged:
        if tag in FAILURE_TAXONOMY:
            bad_turn = transcript[tag.turn_idx]
            good_turn = judge.repair(transcript, tag)
            pairs.append(DPOPair(prompt=transcript[:tag.turn_idx],
                                 chosen=good_turn,
                                 rejected=bad_turn))

    # 4. DPO update on (chosen, rejected) pairs
    policy = dpo_trainer.step(policy, pairs)
```

**Shipped result (Sauda v3):** DPO on Claude-judged pairs. n=10
preference pairs (small, by design — proves the loop works
end-to-end), pushed deal rate to 1.00 and reduced rounds from 6.0
→ 3.5, at the cost of ~0.03 in mean surplus (0.728 → 0.695).
This is the legible trade-off DPO is supposed to give: closer-
biased buyer that walks less. The full setback story (a `$BUYER_MODEL`
typo eating 4hr of rollouts; per-pair-checkpoint upload to recover)
is documented in the blog. Repo: `PayMyBills/bestdealbot-v3`.

Why this is credible self-improvement:
- **No human labels** after the taxonomy is fixed once
- **Frontier-judge or local-judge interchangeable** — Claude here, a
  4B local model is the natural next step (cost & sovereignty)
- **Failure-mode-targeted gradient** — DPO shifts probability mass away
  from specific, legible mistakes, unlike generic GRPO reward
- **Closed loop** — v3 becomes the policy for the next iteration's
  rollouts, with a fresh judge pass producing the next pair set

## What's Shipped

| Component | Status |
|---|---|
| FastAPI env server (OpenEnv-compliant) | ✓ shipped |
| 8 tasks + graders | ✓ shipped |
| Tells system + personality-conditioned sellers | ✓ shipped |
| Amazon listings integration (1,417 products) | ✓ shipped |
| Next.js observer UI (human play, AI spectate, replay, arena) | ✓ shipped |
| Live HF Inference Endpoint serving Sauda v2 (Nvidia L4) | ✓ shipped |
| SFT+GRPO training pipeline (HF Jobs + Colab, reproducible) | ✓ shipped |
| Sauda v1 (3B baseline) | ✓ shipped |
| Sauda v2 (8B SFT+GRPO, canonical) | ✓ shipped |
| Sauda v2-tells (GRPO-only, tells-in-loop ablation) | ✓ shipped |
| Sauda v3 (DPO/RLAIF self-improvement) | ✓ shipped |
| Scaling-ladder eval (3 tasks × 30 ep × 4 buyers) | ✓ shipped |
| Tells ablation (off / inference-injected / in-loop) | ✓ shipped |

**Headline numbers (mean normalized surplus, 3-task suite):**
- 3B baseline: 0.570  ·  8B base: 0.678  ·  **Sauda v2: 0.728**  ·  v3: 0.695  ·  v2-tells: 0.653

Clean 3B → 8B base → 8B-trained scaling signal. v3 trades surplus for
closing rate (deal rate 1.00, rounds 3.5). v2-tells is honest about
the missing-control issue (skipped SFT warmup).

## Evaluation Logic

`eval/eval_harness.py` runs N episodes per task per policy, writes
per-episode JSONL + aggregated summary. Supports:

- `--policy rule_based` — scripted heuristic (training target)
- `--policy ollama --model bestdealbot` — our trained model
- `--policy baseline --baseline_model llama3.2:3b` — untuned base model

Headline metrics per (policy, task):
- `mean_normalized_surplus` (primary)
- `deal_rate` (fraction of episodes closing vs. walking/expiring)
- `mean_rounds` (efficiency)
- `mean_surplus_on_deal` (quality conditional on closing)

Success criterion for v2: beat v1 by ≥10% mean normalized surplus on
`amazon_realistic` and `read_the_tells`. Beat untuned-Llama baseline by
≥20% on any task to demonstrate training was necessary (not just prompt
engineering).

## Repo Structure

```
BazaarBATNA/
├── server/                 FastAPI + arena + leaderboard + LLM-bridge
├── bazaarbot_env/          Standalone env package (Kaggle-importable)
│   ├── environment.py      Core env, step/reset/state
│   ├── seller.py           Rule-based seller with 4 personalities
│   ├── tasks.py            Task configs + graders
│   ├── listings.py         Amazon dataset loader
│   └── gym_wrapper.py      Training-friendly gym API
├── training/
│   └── train.ipynb         Kaggle SFT→GRPO pipeline (reproducible Run-All)
├── eval/
│   └── eval_harness.py     Baseline vs. trained vs. rule-based comparison
├── ui/                     Next.js observer (play/spectate/replay/arena)
├── data/amazon.csv         1,417 products
└── openenv.yaml            OpenEnv env spec
```
