# BazaarBot

**An OpenEnv task environment simulating real-world customer-vendor price negotiation with asymmetric information, career dynamics, and Rubinstein bargaining theory.**

BazaarBot drops an LLM agent into the role of a buyer at an Indian bazaar — haggling over handwoven scarves, brass lamps, and ceramic tea sets against a rule-based seller who anchors high, concedes strategically, and remembers your patterns across deals.

This is not a toy game. This is the negotiation problem that billions of people navigate daily in informal markets worldwide.

---

## Motivation

### Why Negotiation?

Price negotiation is one of the most common real-world tasks that remains unsolved by AI agents. In kirana stores, vendor stalls, auto-rickshaw fare disputes, and real estate dealings across India and the developing world, **negotiation is the default transaction mode** — not the exception.

Existing benchmarks test agents on games, code, or QA. BazaarBot tests something harder: **strategic interaction under incomplete information against an adaptive opponent who is watching your history**.

### Why Not Just a Single Deal?

A single negotiation is a solved problem. The [Nash Bargaining Solution](https://en.wikipedia.org/wiki/Nash_bargaining_game) gives the optimal split under complete information, and [Rubinstein's alternating-offers model](https://en.wikipedia.org/wiki/Rubinstein_bargaining_model) extends it to sequential play.

The hard problem is the **career**: 10 deals against the same vendor, where your reputation carries forward. The Folk theorem from repeated game theory tells us that cooperation (and exploitation) become rational strategies when the game repeats. BazaarBot tests whether an agent can manage information leakage across episodes — the same skill a seasoned bazaar buyer uses instinctively.

---

## Theoretical Foundations

### Rubinstein Alternating-Offers Model

The core negotiation follows Rubinstein's framework: buyer and seller take turns making offers, with a time cost for delay. The key insight is that **patience determines bargaining power**.

In BazaarBot, patience is asymmetric and private:
- The **buyer** has a hidden deadline the seller cannot observe
- The **seller** has hidden inventory spoilage costs the buyer cannot observe

Neither side can default to folding because they cannot infer the other's urgency.

### Time Discount Function

We use a non-linear time discount that is flat early and steep late:

$$\delta(t) = \exp\!\bigl(-\alpha \cdot \exp(\beta \cdot t / T)\bigr)$$

where $\alpha = 0.3$, $\beta = 2.5$, $t$ is the current round, and $T$ is the maximum rounds.

**Why non-linear?** A flat per-round discount $\delta^t$ collapses the game:
- $\delta$ too high → seller anchors forever (no cost to waiting)
- $\delta$ too low → buyer folds round 1 (waiting is too expensive)

The double-exponential creates a "probing is free early, stalling is punished late" dynamic that mirrors real negotiation.

### Reward Function

**Terminal reward (deal reached):**

$$R_{\text{terminal}} = \frac{\text{budget} - p_{\text{agreed}}}{\text{budget} - \text{cost}} \cdot \delta(t) - \lambda \cdot \text{reputation\_leak}$$

where the first term is the normalized surplus (how much value the buyer captured) discounted by time, and the reputation leak penalty discourages predictable offer trajectories in career mode.

**Partial progress signal (per-round):**

$$R_{\text{step}} = 0.05 \cdot \frac{\Delta_{\text{gap}}}{\text{gap}_0}$$

Each round where the offer gap narrows gives a small positive signal proportional to the fraction of the initial gap closed. This ensures the reward covers the full trajectory, not just the terminal outcome.

**Penalties:**
| Behavior | Penalty |
|---|---|
| Stalling (same offer 3+ rounds) | $-0.1$ per repeat |
| Out-of-range offer ($p > \text{budget}$ or $p < 0$) | $-0.2$ (offer clipped) |
| Walk away | $-0.3$ |
| Expired (max rounds exceeded) | $-0.15$ |

All terminal rewards are normalized to $[0, 1]$.

### Three Fundamental Tensions

BazaarBot is designed around three failure modes that naive environments collapse into:

| Tension | Problem | BazaarBot Fix |
|---|---|---|
| **House doesn't need you** | Seller has costless outside options → buyer gets no learning signal | BATNA is stochastic and costly. Outside option arrives with probability $p$ per round, but waiting has time cost. Rejecting is no longer free. |
| **Folding is trivially optimal** | Binary deal/no-deal reward → buyer accepts first offer | Reward is deal *quality*, not deal *existence*. Surplus score explicitly punishes caving. |
| **Seller too rigid** | No cost to anchoring high → seller never concedes | Non-linear time discount. Cheap to wait early, exponentially expensive near deadline. |

### Career Dynamics and the Folk Theorem

In career mode (10 episodes against the same seller), three quantities carry across deals:

- **Reputation**: Rolling capitulation rate over last $K$ deals. The seller observes and exploits patterns — if you've been caving, the seller concedes less.
- **Bankroll**: Finite total budget across sessions. Overpaying in episode 1 constrains episode 2.
- **Seller inventory**: $N$ units to move. High stock → early desperation. Low stock → rigidity.

The [Folk theorem](https://en.wikipedia.org/wiki/Folk_theorem_(game_theory)) applies: with repeated interaction against the same counterparty, cooperative strategies (and reputation management) become Nash equilibria. A career agent must learn to manage information leakage — don't reveal urgency patterns because the opponent is watching.

### Seller Opponent

The seller is **rule-based, not trained**. It anchors at $2\times\text{cost}$ and concedes by a fixed percentage per round, scaled by inventory pressure:

$$\text{counteroffer}_t = \text{anchor} \cdot (1 - r_{\text{eff}} \cdot t)$$

where the effective concession rate $r_{\text{eff}}$ adjusts based on:

$$r_{\text{eff}} = r_{\text{base}} \cdot (1 + 0.5 \cdot I_{\text{pressure}}) \cdot (1 - 0.3 \cdot c_{\text{buyer}})$$

- $I_{\text{pressure}}$: inventory pressure (high stock → concede faster)
- $c_{\text{buyer}}$: buyer's historical capitulation rate (exploitable buyers face a tougher seller)

The seller doesn't need to be an LLM. It needs to be a **credible counterparty** that creates genuine tension and is exploitable by a smart buyer.

---

## Architecture

```
BazaarBot/
├── server/
│   ├── models.py          # Pydantic: BazaarObservation, BazaarAction, BazaarReward
│   ├── seller.py           # Rule-based seller with BATNA, inventory, career adaptation
│   ├── environment.py      # Core env: step/reset/state, reward computation
│   ├── tasks.py            # 3 task configs + deterministic graders
│   └── main.py             # FastAPI server (/reset, /step, /state, /score)
├── inference.py            # LLM buyer agent (OpenAI client)
├── dashboard.py            # Streamlit GUI: trajectories, rewards, career history
├── openenv.yaml            # OpenEnv spec metadata
├── Dockerfile              # Containerized deployment
├── startup.sh              # One-command launcher
└── requirements.txt
```

### Agent Architecture

```
env.reset() → serialize observation as text → LLM → parse JSON action → env.step(action) → repeat
```

- **Type**: LLM-as-agent (frozen model, no training)
- **Input**: Text observation with negotiation state, career history table
- **Output**: Structured JSON — `{"action": "offer"|"accept"|"walk", "price": <float>}`
- **Client**: OpenAI-compatible API (reads `API_BASE_URL`, `MODEL_NAME`, `HF_TOKEN`)

---

## Tasks

| Task | Difficulty | Episodes | Description | Grader | Threshold |
|---|---|---|---|---|---|
| `single_deal` | Easy | 1 | One negotiation, symmetric info, moderate seller | $\frac{\text{budget} - p}{\text{budget} - \text{cost}}$ | 0.3 |
| `asymmetric_pressure` | Medium | 1 | Hidden deadline at round 5, seller has inventory pressure | surplus $\times$ deadline\_bonus | 0.4 |
| `career_10` | Hard | 10 | 10 deals, same seller, career history active, seller adapts | mean weighted surplus | 0.5 |

### Observation Space

Each step, the buyer receives:

| Field | Type | Description |
|---|---|---|
| `current_round` | int | Current negotiation round |
| `max_rounds` | int | Maximum rounds this episode |
| `own_last_offer` | float? | Buyer's previous offer |
| `opponent_last_offer` | float? | Seller's current ask |
| `own_private_budget` | float | Buyer's budget (hidden from seller) |
| `own_private_deadline` | int? | Hard deadline round (hidden from seller) |
| `rounds_remaining` | int | Rounds left |
| `seller_last_move_delta` | float? | How much the seller conceded last round |
| `seller_asking_price` | float | Seller's opening anchor |
| `career_history` | object? | Past deal outcomes, capitulation rate, avg surplus |

### Action Space

```json
{"action": "offer", "price": 42.0}
{"action": "accept", "price": null}
{"action": "walk", "price": null}
```

---

## Quickstart

### One-Command Launch

```bash
git clone https://github.com/paymybills/BazaarBATNA.git
cd BazaarBATNA
chmod +x startup.sh
./startup.sh
```

This creates a virtualenv, installs dependencies, and launches both the **API server** (port 8000) and **Streamlit dashboard** (port 8501).

### Individual Components

```bash
./startup.sh --server      # API server only
./startup.sh --dashboard   # Dashboard only
./startup.sh --inference   # Run LLM agent against server
```

### Manual Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Terminal 1: Server
.venv/bin/uvicorn server.main:app --reload

# Terminal 2: Dashboard
.venv/bin/streamlit run dashboard.py

# Terminal 3: Inference (needs LLM API)
API_BASE_URL="https://router.huggingface.co/v1" \
MODEL_NAME="Qwen/Qwen2.5-72B-Instruct" \
HF_TOKEN="your-token" \
ENV_URL="http://localhost:8000" \
.venv/bin/python inference.py
```

### Docker

```bash
docker build -t bazaarbot .
docker run -p 8000:8000 bazaarbot
```

---

## Dashboard

The Streamlit dashboard provides:

- **Offer trajectory charts** — buyer vs seller offers over rounds, with reference lines for budget, cost, Nash midpoint, and deal price
- **Reward decomposition** — cumulative and per-step reward charts with component breakdown
- **State space analysis** — offer gap convergence and time discount curves
- **Career history** — episode-by-episode outcomes, capitulation rate tracking
- **Manual play mode** — negotiate yourself against the rule-based seller
- **Strategy comparison** — run naive, aggressive, or smart buyer agents side by side

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/reset` | POST | Start new episode. Body: `{"task": "single_deal", "seed": 42}` |
| `/step` | POST | Take action. Body: `{"action": "offer", "price": 35.0}` |
| `/state` | GET | Full environment state |
| `/score` | GET | Graded score for current task |
| `/tasks` | GET | List available tasks |
| `/health` | GET | Health check |

Interactive API docs at `http://localhost:8000/docs`.

---

## Baseline Scores

Rule-based buyer agents on default parameters (seed=42):

| Strategy | single_deal | asymmetric_pressure | career_10 |
|---|---|---|---|
| Naive (capitulates) | 0.743 | 0.726 | 0.667 |
| Aggressive (lowballs) | 0.914 | 0.880 | 0.757 |
| Smart (strategic) | 0.657 | 0.649 | 0.618 |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `API_BASE_URL` | Yes | LLM API endpoint |
| `MODEL_NAME` | Yes | Model identifier |
| `HF_TOKEN` | Yes | HuggingFace / API key |
| `ENV_URL` | No | Environment server URL (default: `http://localhost:8000`) |

---

## Academic References

- Rubinstein, A. (1982). *Perfect equilibrium in a bargaining model.* Econometrica, 50(1), 97-109.
- Nash, J. (1950). *The bargaining problem.* Econometrica, 18(2), 155-162.
- He, H., et al. (2018). *Decoupling Strategy and Generation in Negotiation Dialogues.* EMNLP.
- Aumann, R. & Shapley, L. (1994). *Long-term competition — A game-theoretic analysis.* Essays in Game Theory, Springer.

---

## License

MIT
