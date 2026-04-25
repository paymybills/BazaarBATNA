# BazaarBot Implementation Plan
*Last updated: 2026-04-24. Supersedes all prior plan versions.*

---

## What's already shipped

| Component | Status | Notes |
|---|---|---|
| OpenEnv-compliant FastAPI server | ✓ | `/reset`, `/step`, `/state`, `/score`, `/tasks`, `/health` |
| 8 tasks + graders | ✓ | `single_deal`, `amazon_realistic`, `career_10`, `read_the_tells`, etc. |
| Rule-based seller (4 personalities) | ✓ | Default, deceptive, impatient, collaborative |
| Tells system (12 signals) | ✓ | **Synthetic only** — rule-based floats from hidden state + noise |
| Amazon listings integration | ✓ | 1,417 products, MRP + street price |
| Next.js UI | ✓ | Play / spectate / replay / arena / leaderboard |
| SFT → GRPO training pipeline | ✓ | Kaggle notebook, reproducible Run-All |
| v1 adapter on HF | ✓ | `PayMyBills/bestdealbot`, Llama-3.2-3B-Instruct |
| Bayesian steering + adaptive fallback | ✓ | Post-hoc filter over raw LLM action |
| Eval harness (3 policy types) | ✓ | `rule_based`, `baseline:llama3.2:3b`, `ollama:bestdealbot` |
| Benchmark numbers (n=20, 3 tasks) | ✓ | bestdealbot dominates on surplus, `read_the_tells` still weak |

---

## What we're building next

The plan has three pillars, ordered by dependency. Pillar 1 can start immediately.
Pillars 2 and 3 run in parallel once the NLP extractor (Pillar 1 Step 1) is done.

---

## Pillar 1 — NLP Tell Extractor + Condition/Depreciation Block

**The problem:** `verbal_urgency=0.6` is a float synthesized from hidden seller state.
In a real conversation — OLX DM, WhatsApp bargain, eBay listing — it's free text:

> *"bhai last price hai, kal se price badhega"* → high urgency, possibly deceptive  
> *"minor scratches on back, fully functional"* → condition signal  
> *"MIB, never opened"* → eBay lingo for mint-in-box, condition grade: New  
> *"screen replaced once, battery 81%"* → depreciation signal

The NLP extractor reads a seller utterance and outputs the **same `TellObservation`
schema** the Bayesian steering already consumes. The schema doesn't change — only
how it's populated.

### Step 1.1 — Extend `TellObservation` with condition fields

File: `bazaarbot_env/models.py`

Add to `TellObservation`:
```python
condition_score: float = 1.0        # 0=junk, 1=mint (from eBay condition vocab)
depreciation_score: float = 0.0     # 0=no depreciation, 1=heavily worn
condition_label: str = "unknown"    # "new", "like_new", "very_good", "good", "acceptable", "junk"
```

Condition grades map from eBay's standardized vocabulary:

| eBay label | condition_score | depreciation_score |
|---|---|---|
| New / MIB / Sealed | 1.0 | 0.0 |
| Like New / Open Box | 0.85 | 0.10 |
| Very Good / VGC | 0.70 | 0.25 |
| Good / GUC | 0.55 | 0.40 |
| Acceptable / Acceptable+ | 0.35 | 0.60 |
| For Parts / Junk | 0.10 | 0.90 |

Hinglish equivalents to recognize:
- "box band", "sealed pack" → New
- "thoda use hua" (slightly used), "3 months only" → Like New / Very Good
- "ek chhota sa scratch" (one small scratch) → Good
- "battery thodi kam hai" (battery a bit low) → Acceptable

### Step 1.2 — Write `bazaarbot_env/nlp_extractor.py`

Ollama-backed extractor. Input: seller utterance + conversation history.
Output: `TellObservation` dict (all 12 original fields + 3 new condition fields).

Architecture: single prompted LLM call to a local Gemma model (or any Ollama model).
Prompt includes:
- CaSiNo strategy taxonomy labels as few-shot examples (submission, no-deal pressure,
  misrepresentation, empathy) to anchor the urgency/deception dimensions
- eBay condition vocabulary + Hinglish equivalents for the condition block
- Strict JSON output schema matching `TellObservation`

Zero-shot first. Fine-tune later on Deal-or-No-Deal annotations if extraction quality
is weak on the benchmark tasks.

```python
# Interface
def extract_tells(
    message: str,
    history: list[str],
    model: str = "gemma3:4b",  # or whatever is available in Ollama
) -> dict:  # TellObservation-compatible dict
    ...
```

### Step 1.3 — Wire extractor into `seller.py`

After the seller generates a `message`, run `extract_tells(message, history)` and
merge the result into the returned `SellerTell`. This makes the system self-consistent:
the tells the buyer sees reflect what the seller actually *said*, not a separate
synthetic computation.

For the rule-based seller this is a cross-check. For the LLM seller (Pillar 2) it's
the primary tell source.

### Step 1.4 — Update Bayesian steering to use condition signals

File: `bazaarbot_env/gym_wrapper.py`, `steer_bayesian_action()`

Add to the signal computation:
```python
condition_score = float(tells.get("condition_score") or 1.0)
depreciation = float(tells.get("depreciation_score") or 0.0)

# Seller claiming new-condition price on a worn item = over-anchoring signal
anchor_inflation = max(0.0, depreciation - (1.0 - condition_score) * 0.5)
estimated_cost *= (1.0 - 0.20 * depreciation)  # worn item → lower real cost
posterior_flex += 0.15 * anchor_inflation        # over-anchored seller = more flexible
```

---

## Pillar 2 — LLM Seller (Sim Opponent)

**The goal:** Replace (or augment) the rule-based template seller with an LLM that
generates free-text responses in character. This enables:
- Realistic Hinglish C2C conversation style
- Personality expressed through language, not just float adjustments
- The NLP extractor's outputs become the ground truth tells (not cross-check)
- DPO training data reflects real negotiation language

### Step 2.1 — Write `bazaarbot_env/llm_seller.py`

Drop-in replacement for `SellerState.respond()`. Same signature:
```python
def respond(buyer_offer, round_t) -> tuple[str, float, SellerTell, str]:
    # returns (action, price, tell, message)
```

Internal flow:
1. Build seller prompt from hidden state + personality + conversation history
2. Call Ollama (Gemma or similar) to generate free-text response
3. Parse action + price from the response (same `parse_action()` logic)
4. Run `extract_tells(message, history)` → `SellerTell`
5. Return `(action, price, tell, message)`

Seller system prompt encodes:
- Personality type in natural language ("You are a deceptive seller. Act confident
  when desperate. Use social proof bluffs.")
- Hidden state (cost, inventory pressure, urgency) as private context the seller
  knows but should not reveal directly
- CaSiNo-style strategy instructions (when to use no-deal pressure, misrepresentation,
  empathy anchoring)
- Indian marketplace register: Hinglish, rupee amounts, realistic item lingo

### Step 2.2 — Add `llm` as a seller type in task configs

File: `bazaarbot_env/tasks.py`

```python
seller_type: str = "rule_based"  # or "llm"
```

The environment switches between `SellerState` and `LLMSeller` based on this field.
Eval harness gets a `--seller_type` flag.

### Step 2.3 — Eval: buyer vs. LLM seller

Run the eval harness with `--seller_type llm`. Compare:
- `bestdealbot` vs. LLM seller (same tasks)
- Rule-based policy vs. LLM seller
- LLM buyer vs. LLM seller (both sides Gemma/Ollama)

The LLM seller benchmark is harder than rule-based because the seller can improvise
bluffs not in any template. This is the realistic eval.

---

## Pillar 3 — Synthetic Training Data Pipeline

**The goal:** Generate a labeled Indian C2C negotiation dataset that fills the
Hinglish/OLX-style gap, grounded in real negotiation datasets, used for:
- Fine-tuning the NLP extractor on Indian code-switching patterns
- SFT warmup data for v2 buyer policy
- DPO pair generation (Pillar 4 uses these transcripts as rollout input)

### Step 3.1 — Dataset sources + what each contributes

| Dataset | Load | Contribution |
|---|---|---|
| `stanfordnlp/craigslist_bargains` | `load_dataset(...)` | Negotiation turn structure, offer/counter/walk labels, price anchoring patterns |
| Facebook Deal or No Deal | Download from ParlAI | Per-utterance urgency + deception annotations → NLP extractor supervision |
| CaSiNo (Campsite Negotiation) | `load_dataset("casino")` | Multi-issue strategy annotations (submission, no-deal pressure, misrepresentation, empathy) — teaches extractor to detect *strategy type* |
| eBay listings (Kaggle) | `kaggle datasets download promptcloud/ebay-product-listing-dataset` | 1.29M condition descriptions with standardized grades → condition/depreciation supervision |

### Step 3.2 — Synthetic Indian conversation generator

Refine the generation script (skeleton already written):

File: `data/generate_indian_negotiations.py`

Key changes from the initial draft:
- Add CaSiNo strategy taxonomy to `SYSTEM_PROMPT` as few-shot examples
- Add condition field generation (maps to eBay grades)
- Add `strategy_labels` field per turn (for NLP extractor supervision)
- Output both the conversation JSON and per-turn tell annotations
- Incremental save every 50 items (already in draft, keep it)

Target: 1,000–2,000 conversations. 500 for extractor fine-tune, 1,000+ for
buyer SFT.

Extended item list for Indian context:
```python
ITEMS = [
    "iPhone 13 128GB", "Honda Activa 2019", "Samsung 43 inch TV",
    "Wooden study table", "PS4 with 2 controllers", "Canon DSLR 1300D",
    "Dell laptop i5", "Godrej almirah", "Cycle Trek MTB",
    # Add:
    "Redmi Note 12", "Hero Splendor bike", "OnePlus Buds", 
    "Bajaj mixer grinder", "Titan watch", "Allen Solly kurta",
    "JBL speaker", "Kent RO water purifier", "Prestige pressure cooker",
]
```

Condition descriptions in Hinglish to train on:
```python
CONDITIONS = [
    "minor scratches on back, fully functional",
    "one small dent, works perfectly",
    "screen replaced once, battery health 81%",
    "like new, used for 3 months only",
    # Add:
    "thoda use hua hai, bilkul sahi kaam karta hai",     # slightly used, works perfectly
    "box band hai, seal packed",                          # box sealed, sealed packed
    "ek chhota sa scratch hai screen pe",                 # one small scratch on screen
    "battery thodi kam hai, baaki sab theek",            # battery a bit low, rest fine
    "2 saal purana hai, magar condition ekdum mast hai",  # 2 years old, condition great
]
```

### Step 3.3 — Push dataset to HF

Push to `PayMyBills/indian-c2c-negotiations` as a HF dataset. Makes it importable
in the Kaggle training notebook via `load_dataset(...)`. Enables v2 SFT to train
on Indian-register conversations, not just the English Amazon dataset.

---

## Pillar 4 — DPO Self-Improvement Loop

**The goal:** Closed unsupervised loop. No human labels after the failure taxonomy
is defined. Judge LLM reads rollout transcripts, tags failure modes, repairs bad
turns, generates DPO pairs, trains next checkpoint.

This is the Theme #4 (Self-Improvement) deliverable. Everything else is table stakes.

### Failure taxonomy

```python
FAILURE_TAXONOMY = {
    "capitulated_early": "Accepted or stopped countering while significant surplus remained",
    "over_anchored":     "Opening offer so low the seller walked immediately",
    "walked_winnable":   "Walked away when seller's ask was within budget",
    "ignored_tells":     "Took verbal claim at face value despite contradicting tell signals",
    "missed_accept":     "Missed a below-budget ask that should have been accepted",
    "stalled":           "Made the same offer 2+ consecutive rounds",
    "invalid_json":      "Emitted unparseable output (parse_error flag set)",
}
```

### Step 4.1 — Write `eval/judge.py`

```python
class NegotiationJudge:
    def classify(transcript: list[dict]) -> FailureMode
        # transcript = list of {prompt, completion, action, reward, obs}
        # returns {tag: str, turn_idx: int, explanation: str}

    def repair(transcript: list[dict], failure: FailureMode) -> str
        # returns corrected completion for transcript[failure.turn_idx]
```

Judge is a prompted Ollama call (frozen model, not the training model). Prompt includes:
- Failure taxonomy definitions
- Full transcript
- Task context (budget, seller personality, tells)
- For `repair`: the bad turn + what a good turn would look like

### Step 4.2 — Write `eval/dpo_loop.py`

```python
def run_dpo_iteration(
    policy_model_path: str,
    n_rollouts: int = 50,
    tasks: list[str] = ["amazon_realistic", "read_the_tells", "career_10"],
    judge_model: str = "gemma3:4b",
    output_dir: str = "dpo_pairs/",
) -> str:  # returns path to new checkpoint
    # 1. Rollout: current policy × n_rollouts episodes
    # 2. Judge: classify failure mode per transcript
    # 3. Repair: generate corrected turn per failed transcript
    # 4. Build DPO dataset: (prompt, chosen=repair, rejected=bad_completion)
    # 5. Run trl.DPOTrainer for 1 epoch on pairs
    # 6. Save checkpoint, return path
```

One iteration = one call to this function. Loop externally:
```python
checkpoint = "PayMyBills/bestdealbot"
for i in range(5):
    checkpoint = run_dpo_iteration(checkpoint, n_rollouts=50)
    eval_and_log(checkpoint, tag=f"dpo_v{i+1}")
```

### Step 4.3 — Eval gate between iterations

After each DPO iteration, run the eval harness on the new checkpoint.
Only continue to next iteration if `mean_normalized_surplus` on `amazon_realistic`
improved by ≥2%. Prevents reward hacking and divergence.

Success criterion for v2:
- Beat v1 by ≥10% mean normalized surplus on `amazon_realistic`
- Beat v1 by ≥10% on `read_the_tells` (currently 0.42 — biggest gap)
- Beat untuned Llama baseline by ≥20% on any task

---

## Dependency graph

```
Pillar 1 (NLP Extractor)
  Step 1.1 extend TellObservation
  Step 1.2 nlp_extractor.py          ──→  Pillar 2 Step 2.1 (LLM seller uses extractor)
  Step 1.3 wire into seller.py        ──→  Pillar 4 Step 4.1 (judge reads NLP-populated tells)
  Step 1.4 update Bayesian steering

Pillar 3 (Synthetic Data)            ──→  NLP extractor fine-tune (Step 1.2, optional)
  Step 3.1 load real datasets         ──→  v2 SFT warmup before DPO (Pillar 4)
  Step 3.2 generate Indian convos
  Step 3.3 push to HF

Pillar 2 (LLM Seller)
  Step 2.1 llm_seller.py             ──→  Pillar 4 rollouts (harder, more realistic)
  Step 2.2 task config flag
  Step 2.3 eval buyer vs LLM seller

Pillar 4 (DPO Loop)                  ← needs Pillar 1 done, Pillars 2+3 recommended
  Step 4.1 judge.py
  Step 4.2 dpo_loop.py
  Step 4.3 eval gate
```

**Minimum viable DPO:** Pillar 1 Steps 1.1–1.2, then Pillar 4. Can run DPO against
the rule-based seller before the LLM seller is ready. Pillars 2 and 3 make
the training data richer and the eval harder, but don't block the DPO loop.

---

## On-site priority order

| Priority | Task | Time estimate | Unlocks |
|---|---|---|---|
| 1 | Step 1.1: extend TellObservation | 30 min | everything |
| 2 | Step 1.2: nlp_extractor.py (zero-shot) | 2 hr | LLM seller, richer tells |
| 3 | Step 4.1: judge.py | 2 hr | DPO loop |
| 4 | Step 4.2: dpo_loop.py + one iteration | 3 hr | v2 checkpoint |
| 5 | Step 2.1: llm_seller.py | 2 hr | realistic sim eval |
| 6 | Step 3.2: synthetic data generation (500 convos) | 1 hr compute | v2 SFT |
| 7 | Re-run eval harness on v2 checkpoint | 1 hr | benchmark numbers |
| 8 | Step 3.2 fine-tune extractor on CaSiNo + DoND | on-site compute | extractor accuracy |

Steps 1–4 in one session gets you a v2 checkpoint. Steps 5–8 are the "impress us"
layer that puts real Indian-register conversations and a working LLM opponent behind
the agent.

---

## Files to create

```
bazaarbot_env/
  nlp_extractor.py        # Pillar 1 — Ollama-backed tell extractor
  llm_seller.py           # Pillar 2 — LLM seller opponent

eval/
  judge.py                # Pillar 4 — failure classifier + repair
  dpo_loop.py             # Pillar 4 — full DPO iteration pipeline

data/
  generate_indian_negotiations.py   # Pillar 3 — synthetic data generator
  indian_negotiations.jsonl         # output (gitignore if large)
```

Files to modify:
```
bazaarbot_env/models.py       # add condition_score, depreciation_score, condition_label to TellObservation
bazaarbot_env/seller.py       # wire nlp_extractor into respond() output
bazaarbot_env/gym_wrapper.py  # update steer_bayesian_action() for condition signals
bazaarbot_env/tasks.py        # add seller_type field
training/train.ipynb          # v2 SFT cell using Indian dataset, v2 DPO cell
AGENT_CHANGELOG_RULES.md      # log this update
```
