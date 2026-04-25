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

## 📌 PINNED: Public demo plan (Sauda site)

The eval numbers are great but no one outside the team can *use* the agent. This is the demo
that turns "trust the numbers" into "watch the agent think."

### Framing
Mirror the **Chicago HAI Kellogg study** UX. User gets a structured seller role brief
(asking price, reservation price, bonus structure) and negotiates against Sauda. **User
plays seller, Sauda plays buyer** — matches the training distribution and makes the tells
panel meaningful (we show what the buyer extracts from the *user's* messages).

### MVP (4 hours, demo-defensible)
- [ ] `/play` route in Sauda with one role brief (Chicago HAI house, copied from PDF)
- [ ] Plain chat UI: user is seller, Sauda is buyer, listing message opens
- [ ] After each user turn, render extracted tells in a static side panel (no live overlay)
- [ ] Pre-warm ministral + bestdealbot on page load to avoid 5s cold-start
- [ ] cloudflared tunnel exposes `POST /extract` + `POST /buyer-step` from local FastAPI
- [ ] **Buyer must respond in natural language** — see "Conversation realism" pin below

### Stretch goal 1 — Comparable listings panel (+3 hours)
- [ ] Pre-built `comparable_listings.json` for the demo items (no live scraping)
- [ ] Buyer's response includes "I checked OLX, similar phones at ₹28,500" with a card
- [ ] Inject comps into the buyer's prompt template before the action call
- [ ] Honest README note: comps are pre-cached, not live-fetched

### Stretch goal 2 — In-bubble tell highlighting (+5 hours)
- [ ] After user sends, wrap flagged spans in their chat bubble with `<mark>` tags
- [ ] Hover card shows tell type, score, and one-line explanation
- [ ] Skip Grammarly-style floating overlay — too much engineering for the win

### Explicitly out of scope for venue
- Live web scraping of OLX/Quikr (blocked + legal risk)
- Floating Grammarly-style overlay on a live textarea
- Multi-scenario role briefs (one is enough for demo)

---

## 📌 PINNED: Conversation realism

Current transcripts show Sauda responding with `offer at ₹4697.82` — pure structured action,
no natural language. That is fine for eval (the harness only scores price + outcome) but it
**breaks the demo** because real negotiations are conversation, not vending machines.

### Root cause
The buyer's prompt template asks for a JSON action only. The structured output is what the
Bayesian steerer reads. We never ask the model to write a *message*.

### Fix (2 hours)
- [ ] Extend buyer prompt to return `{action, price, message}` — message is one short Hinglish
      / English line that justifies the offer ("yaar 4700 bhi zyada hai, market mein 4200 mein
      mil raha hai")
- [ ] Bayesian steerer continues to read `action` + `price`; `message` is just rendered to UI
- [ ] If steerer overrides price, regenerate the message conditioned on the corrected price
      (one extra ministral call), or template it ("okay, ₹X is what I can do")
- [ ] Update transcripts in eval harness to capture the message field
- [ ] Re-run a small eval batch to confirm surplus didn't regress

### Why this matters
- Demo: turns the chat from machine vs human into human vs human
- Tells panel: gives the user something to read — they see *both* the price *and* the message
- DPO: the message becomes part of the chosen/rejected pair, so we can train on conversational
  quality, not just price discipline

### Templates mined from data
Don't hand-write the templated fallbacks. Mine them from the 500 Hinglish synthetic conversations
(`data/indian_negotiations.jsonl`). Each turn has a CaSiNo strategy label. For each
`(strategy × price-direction)` bucket, cluster real buyer messages and pick 3-5 templates per
bucket. When the steerer overrides, slot the corrected price into a randomly-picked template
from the matching bucket. Native-sounding, instant, free.

---

## 📌 PINNED: Logging convention

Every train/eval run writes a structured directory to `runs/{timestamp}_{name}/`:

- `config.json` — hyperparams, model id, dataset hash, git sha
- `metrics.jsonl` — one line per step / epoch / episode
- `summary.json` — final scores
- `stdout.log` — captured stdout/stderr

This applies to: SFT, GRPO, DPO, NLP extractor zero-shot eval, NLP extractor fine-tune,
full env eval, ablations. **No exceptions.** Reproducibility, blog post material, and
provenance for every claim in the README all depend on this.

A small helper module `utils/run_logger.py` provides a `RunLogger` context manager so
adding logging to a script is 3 lines.

---

## 📌 PINNED: "Who won" — symmetric scoring

Current eval reports buyer surplus only. That's asymmetric — doesn't say who outplayed whom.

Each episode has `seller_cost`, `seller_anchor`, `buyer_budget`, `agreed_price`. Compute:

```
zopa = buyer_budget - seller_cost
buyer_share  = (buyer_budget - agreed_price) / zopa
seller_share = (agreed_price - seller_cost) / zopa
```

Sum to 1.0 on a deal. `buyer_share = 0.5` is fair split; `0.7` means buyer captured 70% of
the bargaining surplus.

### Outcome classification

| condition | label |
|---|---|
| `buyer_share > 0.6` | buyer win |
| `seller_share > 0.6` | seller win |
| `0.4 ≤ buyer_share ≤ 0.6` | tie (fair split) |
| no deal AND `zopa > 0` | mutual loss (deal was possible, both fail) |
| no deal AND `zopa ≤ 0` | rational walk (no deal possible, neither lost) |

`mutual_loss_rate` is the alignment metric — **low is good**, it measures how often the
agent fails to close a winnable deal.

### Per-policy report card
- mean `buyer_share` (headline)
- win rate (% episodes where buyer_share > 0.6)
- mutual-loss rate
- mean rounds
- bootstrap 95% CI on each (n ≥ 200 episodes)

Implement in `eval/scoring.py` and retrofit existing `eval/out/*.jsonl` results.

---

## 📌 PINNED: Compute strategy (HF $30 credits)

A10G with 4-bit quant fits 30-32B param models. Default mental model shifts from "what fits in
my 7GB local VRAM" to "what fits in 24GB on HF compute, served via inference endpoint."

**Locked model choices for v2:**

- **Buyer (bestdealbot v2):** **Llama-3 family** — hybrid approach:
  - Iterate on **Llama-3.1-8B-Instruct** for the recipe (cheap, ~$1/hr A10G, fast turnaround)
  - Final headline run on **Llama-3.3-70B-Instruct** (A100, ~$4/hr, one shot at it)
  - QLoRA fine-tuned (SFT → GRPO → DPO)
- **Seller (LLM seller, teammate's work):** **Gemma-2-9B-it**, prompted, no fine-tune. Different
  family from buyer = good failure-mode diversity.
- **NLP extractor:** ministral-3:3b stays local. Latency-sensitive, fine-tune candidate if
  zero-shot eval shows gaps.

**Training cost estimate (hybrid 8B → 70B):**
- 8B QLoRA SFT iteration: ~$2-3
- 8B GRPO/DPO debugging: ~$3-5
- 70B QLoRA SFT, 1 epoch: ~$12-16
- 70B GRPO continuation: ~$5-8 (or skip if 8B GRPO recipe transfers cleanly)
- Eval runs: ~$3-5
- **Total: ~$25-30** of $30. Tight but doable.

**Serving:**
- Demo tunnels to HF inference endpoint (~$0.50-2/hr depending on model size)
- Push merged LoRA to HF Hub for reproducibility
- Local laptop only runs ministral + FastAPI orchestration during demo

**Latency tradeoff:** 70B inference is ~5-8s per turn. Mitigated by streaming the response
in the demo UI. If latency kills the demo, fall back to the 8B variant for the live tunneled
path and keep 70B as the "official" eval-numbers model.

**Why no Qwen / no 27B-32B:** Llama-3 family is most familiar, well-supported by HF infra,
and integrates cleanly with our existing SFT/GRPO notebook. No mid-size in Llama (8B → 70B
gap), so we either stay small and iterate or go big and commit. We do both.

---

## 📌 PINNED: Tells ablation — does the observation channel actually do work?

**Locked for venue.** This is the cleanest "what did our novel feature buy you"
claim. Code judges will reach for this question; we should answer it before
they ask.

### What

Run the same buyer (`bestdealbot-v2`) against the same seller (rule-based, all
4 personalities) on the same 50 episodes — once with `enable_nlp=True`, once
with `enable_nlp=False`. Report the delta on `buyer_share`, `mutual_loss_rate`,
and `mean_rounds`.

The `enable_nlp` flag already gates the NLP extractor in `bazaarbot_env`
(commit history shows it added when we wired ministral). When False, the
buyer falls back to rule-based tells synthesis (the v0 path) — same agent,
same env, just blindfolded on verbal signals.

### Expected outcome (hypothesis)

- `buyer_share` drops most on **`read_the_tells`** task (where deception cues
  matter) — possibly from 0.418 → ~0.30
- `mutual_loss_rate` *might* go up — without deception detection, the agent
  matches fake-urgency prices more often, then walks when ZOPA collapses
- `amazon_realistic` and `career_10` should be roughly unaffected (those tasks
  reward price discipline, not perception)

If the hypothesis holds, the headline is:
*"Tells channel adds ~10% buyer surplus on tells-heavy tasks; the env's novel
observation channel is doing real work."*

If it doesn't hold (numbers identical with/without tells) — that's *also* publishable,
and we drop the "tells matter" claim from the venue narrative honestly.

### Firing

```bash
# Two eval runs, same model, same seeds, different env config:
PYTHONPATH=. python eval/eval_harness.py --policy ollama --model bestdealbot \
    --tasks amazon_realistic read_the_tells career_10 --n 50 \
    --enable_nlp 1 --out eval/out/results_tells_on.jsonl

PYTHONPATH=. python eval/eval_harness.py --policy ollama --model bestdealbot \
    --tasks amazon_realistic read_the_tells career_10 --n 50 \
    --enable_nlp 0 --out eval/out/results_tells_off.jsonl

PYTHONPATH=. python eval/scoring.py  # produces the ablation table
```

Wall time: ~30-40 min total on local Ollama (2 × 60 episodes). $0 if local,
~$1 if HF Jobs.

### Eval harness work needed

Quick check: does `eval/eval_harness.py` already accept `--enable_nlp`?
If not, ~15 min to thread it through. Pin to verify tomorrow morning.

---

## 📌 PINNED: Locked decisions for venue (tonight's call)

| Decision | Choice |
|---|---|
| **Run DPO tomorrow** | ✅ Yes — pipeline scaffolded at `08e7c4d`, ~$2 to fire |
| **Reputation polish** | Lean light — README section + per-episode trajectory plot, ~30min. Skip prompt injection. |
| **Tells ablation** | ✅ Yes — see pin above |
| **Cross-product eval** | ✅ Yes — Sauda × Gemma seller, n=50 |
| **Vision / multimodal buyer** | ❌ Future work |
| **Live cloudflared tunnel** | Optional, low priority — judges read code |

### Tomorrow's order of operations (locked)

1. **8-9am** — Verify v2 buyer + seller landed cleanly overnight, smoke-test `/sell`
2. **9-10am** — Cross-product eval (Sauda v2 × Gemma seller × 50 ep)
3. **10-11am** — Tells ablation (with/without `enable_nlp`)
4. **11-12pm** — Build DPO pairs locally + fire DPO Colab notebook
5. **12-1pm** — Reputation polish: career_10 trajectory data + README section
6. **1-2pm** — README final pass: 4 new tables (symmetric scoring, cross-product,
   ablation, career trajectory) + 3 sample transcripts (one per persona)
7. **2-3pm** — Demo dry-run, fix any UI/server bugs
8. **3-5pm** — Buffer for things that broke, final commit, done

---

## 📌 PINNED: DPO pipeline (scaffolded, ready to fire)

Third training stage on top of v2 SFT+GRPO. Files committed at `08e7c4d`:

- `eval/judge.py` — Claude-as-judge (Anthropic API) picks `chosen` vs `rejected` from
  pairs of buyer rollouts on the same scenario. Heuristic fallback (compares
  `buyer_share`) if `ANTHROPIC_API_KEY` is missing — that's RLAIF, not RLHF, but
  the standard approach in current literature.
- `eval/build_dpo_pairs.py` — samples N scenarios, runs two rollouts per scenario
  (different rng seeds for behavioural divergence), runs the judge, writes
  `data/dpo_pairs.jsonl`.
- `training/dpo_colab.ipynb` — `trl.DPOTrainer` on top of v2 adapter
  (`PayMyBills/bestdealbot-v2`), pushes result to `PayMyBills/bestdealbot-v3-dpo`.

### Tomorrow firing sequence

```bash
# 1. Build pairs locally (~10 min, ~$2 of Anthropic credits if API key set)
ANTHROPIC_API_KEY=sk-... PYTHONPATH=. python eval/build_dpo_pairs.py --n 100

# 2. Upload data/dpo_pairs.jsonl to Colab (or have cell 3 pull via fresh repo clone)

# 3. Open training/dpo_colab.ipynb in Colab → Run All
#    ~15-20 min training, pushes to HF
```

Skip the Anthropic API entirely if you want — the heuristic fallback ranks pairs
on `buyer_share`, decent enough for a hackathon DPO demonstration.

### Why this matters for the venue

For code-judge audiences, having a working DPO stage is a real claim:
*"third training stage built on preference learning"*. Even a thin DPO run on
50-100 pairs gives a defensible "we used preference optimization" line in the
README, with concrete artifacts: judge transcripts, pair JSONL, training logs,
final adapter on HF.

### Honest framing

This is **RLAIF** (preferences from an LLM judge), not classical **RLHF**
(preferences from human labelers). Almost all open-source "RLHF" papers since
2023 are RLAIF. Document this in the README so judges who care about the
distinction don't think we're overclaiming.

---

## 📌 PINNED: Reputation / career mode (already built, undersold)

`bazaarbot_env` already implements reputation tracking — discovered while
auditing the codebase, not yet leaned into in the venue narrative.

### What's there

- `CareerHistory` dataclass: tracks past deals, computes `capitulation_rate`,
  `avg_normalized_surplus`, `avg_rounds_to_close` over a sliding window.
- Reward shaping: `rep_leak = -0.1 * capitulation_rate` once 3+ deals are done.
  Penalises the agent for being a soft touch repeatedly.
- Seller awareness: `seller.update_career_info(cap_rate)` is called between
  episodes — the rule-based seller actually adjusts strategy based on the
  buyer's history (anchors higher against capitulators).
- Task gating: only `career_10` (10-episode arc) enables this via
  `task.enable_career`.

### What's missing

- **No buyer-side awareness in the prompt.** The buyer LLM doesn't see its own
  capitulation rate. So the agent can't strategically vary behaviour to manage
  its reputation — it's purely a reward signal at the env level. Quick fix:
  inject `career_history` summary into `format_observation()` (already partially
  done — there's a `career_info` block in the prompt).
- **Only one task uses it.** `career_10` is the only suite. Adding `career_5` or
  using career mode in `amazon_realistic` would give the reputation feature
  more eval surface.
- **No headline number.** "Bestdealbot's mean surplus *increases* across a
  10-episode career" would be a real claim. Currently the eval reports per-task
  means without showing the within-career trajectory.

### Venue play

Cheap polish for the README: pull `career_10` per-episode trajectory data,
plot or table-ify `episode_n surplus`. If the agent improves over the arc, that's
a "learns from its reputation" claim. ~30 min of analysis on existing eval data.

If buyer-side awareness in the prompt is added (~1hr), claim becomes:
*"Buyer agent reads its own career history, adjusts negotiation aggressiveness
to manage reputation across episodes."*

### Out of scope for venue

- Building reputation tracking for the **seller** side
- Extending career mode to additional task suites
- Multi-agent reputation (only `arena` would need this, deferred)

---

## 📌 PINNED: Future work (not for venue)

Items that are good ideas but explicitly out of scope. Pin here so they don't get lost,
and so the README "future work" section writes itself.

- **Multi-item combo deals** ("MacBook + iPad bundle for ₹85k"). Requires new listing schema,
  per-item reservations, unbundle support in buyer prompts, new grader. Also requires
  artificially modeling buyer "need" for bundle items. ~5 hours, breaks single-item eval
  pipeline if rushed. Save for v2 blog post.
- **Vision on the buyer side** — read condition wear from listing photos. Real architectural
  shift (text-only → multimodal). Days of work, not hours.
- **True self-play** — both buyer and seller learning. Multi-week project. CICERO-tier.
- **Live web scraping** of OLX/Quikr for comparable listings. Legal + reliability risk. Pre-cached
  comps for the demo are fine.
- **Floating Grammarly-style overlay** for live tells highlighting. In-bubble post-send
  highlighting gets 90% of the demo win for 10% of the engineering.
- **Public agent submission leaderboard** — accept community agents via the OpenEnv API,
  rank against Sauda. Cool platform play, real moderation problem.

---

## 📌 PINNED: Team split

**Solo (paymybills):** site (BazaarBATNA UI overhaul + Sauda landing) + bestdealbot training +
NLP extractor + integration.

**Teammate(s):** Gemma seller + listings integration + seller-quality eval.

The seller is independent: clean interface, no overlap with model code or UI work. Handoff
package lives at [`docs/SELLER_HANDOFF.md`](docs/SELLER_HANDOFF.md) — interface contract,
dataset paths, role-brief template, acceptance criteria, eval requirements.

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
