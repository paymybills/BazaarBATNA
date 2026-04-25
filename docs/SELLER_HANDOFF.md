# Teammate Handoff — LLM Seller

> **For: BazaarBATNA teammate building the seller.**
> **From: paymybills (working on buyer + NLP + site).**
> **Deadline: 5pm tomorrow (venue presentation).**
> **Branch: `seller/llm-impl` off `main`.**
> **PR back to main when acceptance numbers pass.**

You're building the **LLM-backed seller** for BazaarBATNA. The buyer (MolBhav) is already
trained and working. Right now the seller is a rule-based stub that says "5109 rupees. Not
lower." in a loop. Your job: replace it with a Gemma-based LLM seller that **negotiates like
a real human grounded in a real listing**.

This doc is self-contained. You shouldn't need to read other code unless you want to. If
something is unclear, ping me on Slack/WhatsApp before guessing — small misalignment now
saves hours of rework.

**TL;DR:** Implement `LLMSeller` per the interface in `bazaarbot_env/llm_seller.py`, finalize
`data/craigslist_loader.py`, write `eval/seller_quality.py`, log everything to `runs/`,
open a PR with 3 sample transcripts and passing acceptance numbers.

---

## Getting started in 5 minutes

```bash
git clone https://github.com/paymybills/BazaarBATNA.git
cd BazaarBATNA
git checkout -b seller/llm-impl

# install deps (uv recommended, or pip)
uv sync   # or: pip install -e .

# pull the seller model
ollama pull gemma2:9b

# verify the stub runs
PYTHONPATH=. python -c "
from bazaarbot_env.llm_seller import LLMSeller
s = LLMSeller({'title': 'iPhone 13'}, {'asking_price': 40000, 'reservation_price': 32000, 'persona': 'firm'})
print(s.open())
print(s.respond([], 'I will give you 25000', 25000))
"
```

If that runs, you're set. Open `bazaarbot_env/llm_seller.py` and start filling in the body
of `respond()` to call Gemma instead of returning canned strings.

---

## Why this matters

The buyer is winning against vending machines. We need a worthy opponent so:
1. The eval numbers stop being trivially good
2. The NLP tell extractor faces real text (not scripted output)
3. The demo at the venue looks like a real conversation, not a robot exchange

Without your work, the submission is "we beat scripted sellers" — which is weak.
With your work, it's "we beat a Gemma-9B seller anchored on real Craigslist listings."

---

## What you're building

A class with this exact interface:

```python
# bazaarbot_env/llm_seller.py

class LLMSeller:
    def __init__(
        self,
        listing: dict,            # one row from data/train.json (CraigslistBargains)
        role_brief: dict,         # {asking_price, reservation_price, bonus_structure, persona}
        model: str = "gemma2:9b", # or whatever you pick
    ): ...

    def open(self) -> str:
        """Return the seller's opening message. One short paragraph, in character."""

    def respond(
        self,
        history: list[dict],       # [{role: 'seller'|'buyer', message: str, price: float|None}, ...]
        buyer_message: str,        # what the buyer just said
        buyer_offer: float | None, # parsed price from buyer's message, if any
    ) -> dict:
        """Return {'message': str, 'action': 'counter'|'accept'|'walk', 'price': float|None}."""
```

The buyer code calls `seller.open()` once at start, then `seller.respond(...)` every turn.
You don't touch the buyer. You don't touch the env API. You just implement this class.

A stub version exists at `bazaarbot_env/llm_seller.py` — fake implementation that returns
canned strings. You replace the body. Keep the signatures identical.

---

## What "good" looks like

The seller must:

1. **Stay anchored on the listing** — if the listing is a 2008 Honda Civic with 130k miles
   listed at $4500, the seller must reference *that car*, not invent a different one. Use the
   listing's title + description in the system prompt.

2. **Respect its hidden reservation price** — the role brief says "your minimum is $X." The
   seller must never sell below it, must never reveal it, must walk if the buyer's offer is
   below it after negotiation.

3. **Negotiate, not capitulate** — a seller that says "okay, your price" on turn 2 is broken.
   It should hold ground, justify the price ("I just put new tires on it"), counter at
   meaningful increments, walk on lowballs.

4. **Stay in character (persona)** — supports at minimum:
   - `default` — balanced, moderate concessions
   - `firm` — slow to concede, defends the price
   - `flexible` — open to deals, more conciliatory
   - `deceptive` — bluffs about other buyers, fake urgency, social proof
   
   Persona comes from the role brief. The system prompt switches based on it.

5. **Output structured action even when message is freeform** — your `respond()` returns
   both natural language *and* a parsed action/price. Use a JSON-output prompt or post-parse
   the message yourself.

6. **Handle buyer accept / walk gracefully** — if the buyer accepts, your seller closes the
   deal. If the buyer walks, your seller responds appropriately (one last counter, or
   farewell).

---

## Inputs you have

### Dataset
- `data/train.json` — CraigslistBargains, 17.2 MB gzipped JSON. Each row has:
  - `category` (housing, car, electronics, …)
  - `title` (listing title)
  - `description` (free-text seller description, can be long)
  - `price` (listed price)
  - `agent_info` (buyer/seller targets — useful as a sanity reference for reservation prices)

There's also `data/dev.json` and `data/test.json` you can use for held-out eval.

A loader stub lives at `data/craigslist_loader.py`:

```python
def load_listings(split="train", min_price=100, max_price=50000) -> list[dict]:
    """Yield filtered listings."""

def sample_listing(seed=None) -> dict:
    """Return one random listing."""
```

Wire your seller to consume these.

### Role brief template
The role brief is a dict the env passes in. Format mirrors the Chicago HAI Kellogg study.
You define the exact schema, but it should at minimum contain:

```python
{
    "asking_price": 4500,        # what seller lists at
    "reservation_price": 3800,   # secret minimum, never reveal
    "bonus_structure": "...",    # optional, $1 per $100 above reservation
    "persona": "default",        # one of {default, firm, flexible, deceptive}
    "context": "You inherited..." # optional backstory for richer roleplay
}
```

Generate role briefs from listings: reservation = 0.78 × asking is a reasonable default,
match the persona randomly per episode for eval diversity.

---

## Model choice

**Recommended:** `gemma2:9b-instruct-q4_K_M` via Ollama for local dev, then switch to
HF inference endpoint with `google/gemma-2-9b-it` for the venue demo. Gemma-2-9B is good at
roleplay and stays in character better than smaller models.

**Backup:** `qwen2.5:14b` if Gemma struggles with roleplay.

**Avoid:** llama3.2:3b (the buyer baseline) — too small for this, and we want differentiation
between buyer and seller models.

---

## Acceptance criteria — your work is done when

Your eval `eval/seller_quality.py` reports the following on **50 episodes** against a *fixed
buyer policy* (use the rule-based buyer to make this fast and deterministic):

| criterion | target |
|---|---:|
| stays anchored to listing (manual spot-check 20 episodes, listing referenced verbatim) | ≥ 18/20 |
| never sells below reservation price | 100% |
| never leaks reservation price in message text (regex check) | 100% |
| mean rounds per episode | ≥ 4 |
| zero-round capitulation rate (accepts on first buyer offer) | ≤ 10% |
| persona consistency (LLM-judge classifies persona from transcript correctly) | ≥ 70% |

Write the eval script. Numbers go in `runs/{timestamp}_seller_quality/summary.json` (see
logging convention below).

---

## Logging convention

Every eval run writes to `runs/{timestamp}_{name}/`:

```
runs/20260425_1430_seller_quality/
├── config.json       # model, n_episodes, listing seeds, git sha
├── metrics.jsonl     # one line per episode
├── summary.json      # aggregate scores
└── stdout.log        # captured output
```

Use the helper at `utils/run_logger.py`:

```python
from utils.run_logger import RunLogger

with RunLogger("seller_quality") as log:
    log.config({"model": "gemma2:9b", "n": 50})
    for ep in episodes:
        result = run_episode(ep)
        log.metric(result)
    log.summary({"mean_rounds": 5.2, "capitulation_rate": 0.04})
```

---

## Out of scope (don't do these)

- Don't fine-tune the seller. Prompted Gemma-2-9B is enough.
- Don't add new env API routes. Work through `LLMSeller` only.
- Don't touch the buyer code, the NLP extractor, or the eval harness.
- Don't build a UI for the seller. The site team handles all UX.
- Don't scrape new listings — `data/train.json` has 6k+ already.

---

## How to test as you build

```python
# scratch/seller_smoke.py
from data.craigslist_loader import sample_listing
from bazaarbot_env.llm_seller import LLMSeller

listing = sample_listing(seed=42)
brief = {"asking_price": listing["price"], "reservation_price": listing["price"] * 0.78,
         "persona": "firm"}

seller = LLMSeller(listing, brief)
print("OPEN:", seller.open())

reply = seller.respond(
    history=[{"role": "seller", "message": seller.open(), "price": listing["price"]}],
    buyer_message="I'll give you 60% of asking, take it or leave it.",
    buyer_offer=listing["price"] * 0.6,
)
print("REPLY:", reply)
```

Iterate on the prompt until smoke runs feel like real negotiations.

---

## Hand-back

When you're done, push to a branch like `seller/llm-impl`. Open a PR with:
- The `LLMSeller` implementation
- `data/craigslist_loader.py` finalized
- `eval/seller_quality.py` with passing acceptance numbers
- A `runs/` directory committed with at least one full eval run
- Three sample transcripts pasted in the PR description (one per persona) so we can see
  the seller in action

I'll integrate it into the env config (`personality="llm"` swaps your seller in) and run the
big buyer-vs-LLM-seller eval. Then we're at the venue.

---

## Time estimate

- Prompt engineering + roleplay tuning: 3-4 hours
- Loader + role-brief generation: 1 hour
- Eval script + acceptance check: 1.5 hours
- Iteration: 1-2 hours

**~7 hours total.** If you hit 10 hours, ping me — something's off and we'll cut scope.

---

## If you use Gemini / Claude / GPT to help

Feed it this whole document. It's self-contained. Tell it:

> Implement `LLMSeller` per this spec. The interface, dataset paths, acceptance criteria, and
> eval format are all here. Use Gemma-2-9B-it via Ollama for local dev. Make the seller
> negotiate like a real human anchored on the provided listing. Don't capitulate, don't leak
> the reservation price, support 4 personas.

The LLM should be able to scaffold most of this from this doc alone.
