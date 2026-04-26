"""FastAPI server for BazaarBot environment."""

from __future__ import annotations

import copy
import json
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .arena import MultiBuyerArena
from .environment import BazaarEnvironment
from .leaderboard import get_best_scores, get_leaderboard, record_score
from .models import (
    ActionType,
    ArenaAction,
    ArenaState,
    BazaarAction,
    BazaarObservation,
    BazaarReward,
    CounterfactualRequest,
    CounterfactualResult,
    DealOutcome,
    EnvironmentState,
    LeaderboardEntry,
    LeaderboardResponse,
    SellerPersonalityType,
)
from .tasks import GRADERS, TASKS


# ── Request / Response models ─────────────────────────────────────

class ResetRequest(BaseModel):
    task: str = "single_deal"
    seed: Optional[int] = None
    seller_personality: Optional[str] = None  # override task default


class ResetResponse(BaseModel):
    observation: BazaarObservation
    done: bool = False
    reward: float = 0.0


class StepRequest(BaseModel):
    action: str  # "offer", "accept", "walk"
    price: Optional[float] = None


class StepResponse(BaseModel):
    observation: BazaarObservation
    reward: float
    done: bool
    info: dict = {}


class ScoreResponse(BaseModel):
    task: str
    score: float
    episodes_completed: int
    total_episodes: int
    success: bool


class RecordScoreRequest(BaseModel):
    agent_name: str
    metadata: dict = {}


# Arena models
class ArenaCreateRequest(BaseModel):
    task: str = "marketplace_arena"
    seed: Optional[int] = None
    num_buyers: int = 3


class ArenaJoinRequest(BaseModel):
    buyer_id: str
    name: str = "Buyer"
    is_human: bool = False


class ArenaStepRequest(BaseModel):
    actions: dict[str, dict]  # buyer_id -> {action, price, signal}


# ── App state ─────────────────────────────────────────────────────

def _client_ip(request: Request) -> Optional[str]:
    """Best-effort client IP for rate-limiting. Honors X-Forwarded-For when
    deployed behind a proxy/CDN; falls back to direct socket peer.

    Note: in untrusted environments XFF can be spoofed. Hosting plan today
    is direct uvicorn or behind a single-hop reverse proxy we control, so
    trusting the leftmost XFF entry is acceptable.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip() or None
    return request.client.host if request.client else None


_envs: dict[str, BazaarEnvironment] = {}
_arenas: dict[str, MultiBuyerArena] = {}
_ws_connections: dict[str, list[WebSocket]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    _envs.clear()
    _arenas.clear()


app = FastAPI(
    title="BazaarBot",
    description="OpenEnv negotiation environment with game-theory mechanics, seller personalities, tells, and multi-buyer arenas",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_env(session_id: str = "default") -> BazaarEnvironment:
    if session_id not in _envs:
        raise HTTPException(status_code=400, detail="No active session. Call /reset first.")
    return _envs[session_id]


# ── WebSocket broadcasting ───────────────────────────────────────

async def _broadcast(session_id: str, event: str, data: dict):
    """Broadcast event to all WebSocket clients watching a session."""
    conns = _ws_connections.get(session_id, [])
    dead = []
    for ws in conns:
        try:
            await ws.send_json({"event": event, **data})
        except Exception:
            dead.append(ws)
    for ws in dead:
        conns.remove(ws)


# ── Endpoints ─────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    task_rows = "".join(
        f'<tr><td><code class="kbd">{name}</code></td><td class="diff">{t.difficulty.capitalize()}</td>'
        f'<td><code class="kbd muted">{t.seller_personality.value}</code></td><td class="desc">{t.description}</td></tr>'
        for name, t in TASKS.items()
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BazaarBATNA — OpenEnv negotiation environment</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg: #0a0a0b;
      --bg2: #111114;
      --surface: #16161a;
      --surface2: #1c1c22;
      --border: #2a2a32;
      --fg: #f5f5f7;
      --fg2: #a1a1aa;
      --fg3: #71717a;
      --accent: #d9ff00;
      --accent2: #00f5d4;
      --warn: #f59e0b;
      --bad: #ef4444;
      --good: #10b981;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; background: var(--bg); color: var(--fg); }}
    body {{ font-family: 'Inter', system-ui, -apple-system, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; }}
    code, .mono {{ font-family: 'JetBrains Mono', 'Menlo', monospace; }}
    .container {{ max-width: 1100px; margin: 0 auto; padding: 0 28px; }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}

    /* Top nav */
    nav {{ border-bottom: 1px solid var(--border); padding: 18px 28px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: rgba(10,10,11,0.85); backdrop-filter: blur(8px); z-index: 10; }}
    nav .brand {{ font-weight: 700; letter-spacing: -.02em; font-size: 0.95rem; }}
    nav .brand .dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 8px; box-shadow: 0 0 8px var(--good); animation: pulse 2s infinite; }}
    @keyframes pulse {{ 0%, 100% {{ opacity: 1; }} 50% {{ opacity: 0.4; }} }}
    nav .links {{ display: flex; gap: 22px; font-size: 0.85rem; color: var(--fg2); }}
    nav .links a {{ color: var(--fg2); }}
    nav .links a:hover {{ color: var(--fg); text-decoration: none; }}

    /* Hero */
    .hero {{ position: relative; padding: 96px 0 80px; overflow: hidden; }}
    .hero::before {{
      content: ""; position: absolute; inset: 0;
      background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 56px 56px;
      mask-image: radial-gradient(ellipse at 30% 10%, black 30%, transparent 70%);
      opacity: 0.18; pointer-events: none;
    }}
    .eyebrow {{ font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.16em; color: var(--fg3); margin-bottom: 22px; }}
    .hero h1 {{ font-size: clamp(2.6rem, 6vw, 4.8rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.02; margin: 0 0 28px; max-width: 900px; }}
    .accent-rule {{ height: 2px; width: 280px; background: var(--accent); margin: 18px 0 30px; }}
    .hero p.lead {{ font-size: 1.1rem; color: var(--fg2); max-width: 680px; margin: 0 0 24px; line-height: 1.6; }}
    .badges {{ display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 36px; }}
    .badge {{ display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; border: 1px solid var(--border); color: var(--fg2); background: rgba(255,255,255,0.02); }}
    .badge.accent {{ border-color: rgba(217,255,0,0.4); background: rgba(217,255,0,0.08); color: var(--accent); }}
    .badge.accent .dot {{ width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }}
    .ctas {{ display: flex; flex-wrap: wrap; gap: 12px; }}
    .btn {{ display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 8px; font-size: 0.9rem; font-weight: 500; border: 1px solid var(--border); transition: all .15s; }}
    .btn.primary {{ background: var(--accent); color: var(--bg); border-color: var(--accent); }}
    .btn.primary:hover {{ opacity: 0.9; text-decoration: none; }}
    .btn.ghost {{ background: transparent; color: var(--fg); }}
    .btn.ghost:hover {{ background: var(--surface); text-decoration: none; }}

    /* Sections */
    section {{ padding: 72px 0; border-top: 1px solid var(--border); }}
    section.alt {{ background: var(--bg2); }}
    h2 {{ font-size: 1.9rem; font-weight: 600; letter-spacing: -.02em; margin: 0 0 14px; }}
    .section-eyebrow {{ font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.16em; color: var(--fg3); margin-bottom: 14px; }}
    p.section-lead {{ color: var(--fg2); max-width: 720px; margin: 0 0 32px; line-height: 1.65; font-size: 0.98rem; }}

    /* Tables */
    table.dat {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 8px 0 20px; }}
    table.dat th {{ text-align: left; padding: 12px 14px; background: var(--surface); border-bottom: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--fg3); font-weight: 500; }}
    table.dat td {{ padding: 14px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--fg); }}
    table.dat td.num {{ font-family: 'JetBrains Mono', monospace; text-align: right; font-variant-numeric: tabular-nums; }}
    table.dat td.diff {{ font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--fg2); }}
    table.dat td.desc {{ color: var(--fg2); font-size: 0.88rem; }}
    table.dat tr.win td {{ color: var(--accent); font-weight: 500; }}
    table.dat tr.win td.label {{ color: var(--accent); }}
    .kbd {{ background: var(--surface2); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; font-size: 0.82rem; color: var(--fg); }}
    .kbd.muted {{ color: var(--fg2); }}

    /* Endpoints */
    .endpoints {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }}
    .ep {{ padding: 16px 18px; background: var(--surface); display: flex; align-items: center; gap: 12px; }}
    .method {{ font-family: 'JetBrains Mono', monospace; font-size: 0.66rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; flex-shrink: 0; }}
    .method.get {{ background: rgba(0,245,212,0.15); color: var(--accent2); }}
    .method.post {{ background: rgba(245,158,11,0.15); color: var(--warn); }}
    .method.ws {{ background: rgba(217,255,0,0.15); color: var(--accent); }}
    .ep .path {{ font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--fg); flex-shrink: 0; }}
    .ep .desc {{ color: var(--fg3); font-size: 0.78rem; margin-left: auto; text-align: right; }}

    /* Cards */
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 24px 0; }}
    .card {{ background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; }}
    .card .label {{ font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--fg3); margin-bottom: 10px; }}
    .card h3 {{ font-size: 1.1rem; margin: 0 0 6px; font-weight: 600; }}
    .card p {{ color: var(--fg2); font-size: 0.88rem; margin: 0; line-height: 1.55; }}
    .card .stat {{ font-family: 'JetBrains Mono', monospace; font-size: 2rem; font-weight: 700; color: var(--accent); letter-spacing: -.02em; line-height: 1; margin: 8px 0 12px; }}
    .card .stat .delta {{ font-size: 1rem; color: var(--good); margin-left: 6px; }}
    .card a {{ font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--fg2); }}
    .card a:hover {{ color: var(--accent); }}

    /* Footer */
    footer {{ padding: 40px 0 60px; border-top: 1px solid var(--border); color: var(--fg3); font-size: 0.82rem; }}
    footer .row {{ display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; }}
    footer a {{ color: var(--fg2); }}
    footer .links a {{ margin-right: 18px; }}
    .small {{ font-size: 0.78rem; color: var(--fg3); }}
    @media (max-width: 720px) {{
      nav .links {{ display: none; }}
      .hero {{ padding: 64px 0 56px; }}
      section {{ padding: 56px 0; }}
      table.dat th, table.dat td {{ padding: 10px 8px; font-size: 0.82rem; }}
    }}
  </style>
</head>
<body>

  <nav>
    <div class="brand"><span class="dot"></span>BazaarBATNA</div>
    <div class="links">
      <a href="#results">Results</a>
      <a href="#environment">Environment</a>
      <a href="#api">API</a>
      <a href="https://github.com/paymybills/BazaarBATNA" target="_blank">GitHub →</a>
    </div>
  </nav>

  <section class="hero">
    <div class="container">
      <div class="eyebrow">OpenEnv · Negotiation Playground</div>
      <h1>Watch agents haggle.<br/>Step in yourself.</h1>
      <div class="accent-rule"></div>
      <p class="lead">A negotiation environment with observable tells and hidden reservation prices. Buyer and seller are both LLMs — <strong style="color:var(--fg)">Sauda</strong> on the buy side (Llama-3.1-8B + QLoRA, trained SFT → GRPO → DPO/RLAIF), <strong style="color:var(--fg)">Gemma-4-E4B</strong> on the sell side. Strategy improves through self-play. Drop in as a seller, watch the arena, or scrub a replay.</p>
      <div class="badges">
        <span class="badge accent"><span class="dot"></span>Powered by RLAIF</span>
        <span class="badge">OpenEnv-compliant</span>
        <span class="badge">8B · QLoRA</span>
        <span class="badge">8 tasks · 4 personas</span>
      </div>
      <div class="ctas">
        <a class="btn primary" href="https://github.com/paymybills/BazaarBATNA" target="_blank">GitHub repo →</a>
        <a class="btn ghost" href="https://huggingface.co/PayMyBills/bestdealbot-v2" target="_blank">Sauda v2 adapter</a>
        <a class="btn ghost" href="https://github.com/paymybills/BazaarBATNA/blob/main/docs/BLOG.md" target="_blank">Hackathon journal</a>
        <a class="btn ghost" href="/docs">Interactive API docs</a>
      </div>
    </div>
  </section>

  <section id="results">
    <div class="container">
      <div class="section-eyebrow">Headline result</div>
      <h2>Sauda v2 beats the 8B base by 7.4% mean surplus</h2>
      <p class="section-lead">Same seller (Gemma-4-E4B), same seeds, same tasks. n=30 episodes per task. Sauda was trained on top of Llama-3.1-8B-Instruct with SFT + GRPO; the table below shows it outperforms the base model on every task it was trained against, and survives the seller-quality eval (5 of 6 acceptance criteria pass).</p>
      <table class="dat">
        <thead><tr><th>Buyer</th><th>Tells</th><th>single_deal</th><th>asymmetric</th><th>amazon</th><th>Mean</th><th>Deals</th><th>Rounds</th></tr></thead>
        <tbody>
          <tr><td>Llama-3.2-3B base</td><td class="diff">ON</td><td class="num">0.722</td><td class="num">0.731</td><td class="num">0.258</td><td class="num">0.570</td><td class="num">1.00</td><td class="num">2.2</td></tr>
          <tr><td>Llama-3.1-8B base</td><td class="diff">ON</td><td class="num">0.818</td><td class="num">0.787</td><td class="num">0.430</td><td class="num">0.678</td><td class="num">0.99</td><td class="num">3.1</td></tr>
          <tr class="win"><td class="label"><strong>Sauda v2</strong> (8B SFT+GRPO)</td><td class="diff">OFF</td><td class="num">0.835</td><td class="num">0.827</td><td class="num">0.521</td><td class="num"><strong>0.728</strong></td><td class="num">0.91</td><td class="num">6.0</td></tr>
          <tr><td>Sauda v2 (8B SFT+GRPO)</td><td class="diff">ON</td><td class="num">0.810</td><td class="num">0.768</td><td class="num">0.507</td><td class="num">0.695</td><td class="num">0.88</td><td class="num">6.0</td></tr>
        </tbody>
      </table>
      <p class="small"><strong>Reading this:</strong> 3B → 8B base buys you +19% mean surplus. Training on 8B (SFT+GRPO) buys you another +7% AND ~2× longer negotiations — base models capitulate fast (2-3 rounds), Sauda actually plays the game. Sauda's deal rate (0.91) is a feature, not a bug — it walks when offers are bad. Tells channel ON underperforms tells OFF; reported as a kept negative result. Full transcripts: <a href="https://huggingface.co/datasets/PayMyBills/scaling-eval-runs" target="_blank">PayMyBills/scaling-eval-runs</a>.</p>
    </div>
  </section>

  <section class="alt">
    <div class="container">
      <div class="section-eyebrow">Training</div>
      <h2>SFT → GRPO → DPO/RLAIF</h2>
      <p class="section-lead">The buyer adapter is trained in three stages on top of Llama-3.1-8B-Instruct. SFT teaches strict-JSON Hinglish output. GRPO drives reward against the live env. DPO refines on Claude-judged preference pairs. Trainer state for the GRPO stage is on HF — anyone can curl it.</p>
      <div class="grid">
        <div class="card">
          <div class="label">GRPO reward</div>
          <div class="stat">0.97 <span class="delta">peak</span></div>
          <p>30 optimization steps, mean reward 0.94 across the run. Entropy fell 0.51 → 0.42 as the policy concentrated. Full log_history: <a href="https://huggingface.co/PayMyBills/bestdealbot-v2/blob/main/last-checkpoint/trainer_state.json" target="_blank">trainer_state.json</a></p>
        </div>
        <div class="card">
          <div class="label">Scaling-ladder win</div>
          <div class="stat">+7.4% <span class="delta">vs 8B base</span></div>
          <p>Mean surplus across single_deal / asymmetric / amazon. Same seller, same seeds. Doubles the 3B base on the amazon task (0.258 → 0.521).</p>
        </div>
        <div class="card">
          <div class="label">Seller quality</div>
          <div class="stat">5 / 6 <span class="delta">passing</span></div>
          <p>Acceptance criteria for the Gemma-4-E4B seller: never accepts below reservation, never leaks reservation, monotonic counters, etc. Dataset: <a href="https://huggingface.co/datasets/PayMyBills/seller-quality-runs" target="_blank">seller-quality-runs</a></p>
        </div>
      </div>
    </div>
  </section>

  <section id="environment">
    <div class="container">
      <div class="section-eyebrow">The environment</div>
      <h2>8 tasks. 4 seller personas. 1 OpenEnv API.</h2>
      <p class="section-lead">From symmetric one-shot deals to multi-buyer marketplaces. Asymmetric information, hidden deadlines, deceptive sellers leaking poker-style tells, career history that follows the buyer across 10 deals. Every task graded with deterministic surplus + deal-rate reward.</p>
      <table class="dat">
        <thead><tr><th>Name</th><th>Difficulty</th><th>Persona</th><th>What it tests</th></tr></thead>
        <tbody>{task_rows}</tbody>
      </table>
    </div>
  </section>

  <section id="api" class="alt">
    <div class="container">
      <div class="section-eyebrow">OpenEnv API</div>
      <h2>The endpoints judges run against</h2>
      <p class="section-lead">FastAPI server, Docker container, Hugging Face Space. POST <code class="kbd">/reset</code> to start. POST <code class="kbd">/step</code> to play. GET <code class="kbd">/score</code> to grade. Real-time streams over WebSocket. Multi-buyer arenas. Counterfactual replays. <a href="/docs">Interactive Swagger →</a></p>
      <div class="endpoints">
        <div class="ep"><span class="method post">POST</span><span class="path">/reset</span><span class="desc">Start an episode</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/step</span><span class="desc">Submit buyer action</span></div>
        <div class="ep"><span class="method get">GET</span><span class="path">/state</span><span class="desc">Full env state</span></div>
        <div class="ep"><span class="method get">GET</span><span class="path">/score</span><span class="desc">Graded score</span></div>
        <div class="ep"><span class="method get">GET</span><span class="path">/tasks</span><span class="desc">List tasks</span></div>
        <div class="ep"><span class="method ws">WS</span><span class="path">/ws/{{session}}</span><span class="desc">Real-time stream</span></div>
        <div class="ep"><span class="method get">GET</span><span class="path">/leaderboard</span><span class="desc">Score board</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/leaderboard/record</span><span class="desc">Record a score</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/counterfactual</span><span class="desc">What-if replay</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/arena/create</span><span class="desc">Multi-buyer arena</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/arena/join</span><span class="desc">Join arena</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/arena/step</span><span class="desc">Arena step</span></div>
        <div class="ep"><span class="method get">GET</span><span class="path">/arena/state</span><span class="desc">Arena state</span></div>
        <div class="ep"><span class="method post">POST</span><span class="path">/highlight</span><span class="desc">Extract seller tells</span></div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="section-eyebrow">Artifacts on Hugging Face</div>
      <h2>Everything is durable. Anyone can reproduce.</h2>
      <div class="grid">
        <div class="card">
          <div class="label">Adapter</div>
          <h3>PayMyBills/bestdealbot-v2</h3>
          <p>Llama-3.1-8B + QLoRA, SFT+GRPO. trainer_state.json + last-checkpoint live for verification.</p>
          <a href="https://huggingface.co/PayMyBills/bestdealbot-v2" target="_blank">Open on HF →</a>
        </div>
        <div class="card">
          <div class="label">Eval datasets</div>
          <h3>scaling-eval-runs</h3>
          <p>Full transcripts of the 3B / 8B / Sauda v2 scaling ladder. n=30 per task.</p>
          <a href="https://huggingface.co/datasets/PayMyBills/scaling-eval-runs" target="_blank">Open on HF →</a>
        </div>
        <div class="card">
          <div class="label">Hackathon journal</div>
          <h3>The blog with all receipts</h3>
          <p>Bugs, the four-hour rollout we lost to a bash typo, the ablation that disproved our own hypothesis, written live.</p>
          <a href="https://github.com/paymybills/BazaarBATNA/blob/main/docs/BLOG.md" target="_blank">Read on GitHub →</a>
        </div>
        <div class="card">
          <div class="label">Training notebooks</div>
          <h3>One-click reproduce</h3>
          <p>Colab notebooks for SFT+GRPO and for DPO/RLAIF. T4-friendly, runnable end-to-end.</p>
          <a href="https://github.com/paymybills/BazaarBATNA/blob/main/training/train_colab.ipynb" target="_blank">Open in Colab →</a>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <div class="row">
        <div>BazaarBATNA · OpenEnv hackathon submission · MIT</div>
        <div class="links">
          <a href="https://github.com/paymybills/BazaarBATNA" target="_blank">GitHub</a>
          <a href="https://huggingface.co/PayMyBills/bestdealbot-v2" target="_blank">Adapter</a>
          <a href="https://github.com/paymybills/BazaarBATNA/blob/main/docs/BLOG.md" target="_blank">Blog</a>
          <a href="/docs">API docs</a>
          <a href="/health">Health</a>
        </div>
      </div>
    </div>
  </footer>

</body>
</html>"""


@app.get("/tasks")
async def list_tasks():
    return {
        name: {
            "difficulty": t.difficulty,
            "description": t.description,
            "seller_personality": t.seller_personality.value,
            "num_buyers": t.num_buyers,
            "enable_tells": t.enable_tells,
            "enable_coalition": t.enable_coalition,
        }
        for name, t in TASKS.items()
    }


@app.post("/reset")
async def reset(req: ResetRequest = ResetRequest()) -> ResetResponse:
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}. Available: {list(TASKS.keys())}")

    task = copy.deepcopy(TASKS[req.task])

    # Override personality if specified
    if req.seller_personality:
        try:
            task.seller_personality = SellerPersonalityType(req.seller_personality)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown personality: {req.seller_personality}. "
                        f"Available: {[p.value for p in SellerPersonalityType]}",
            )

    env = BazaarEnvironment(task, seed=req.seed)
    obs = env.reset()
    _envs["default"] = env

    await _broadcast("default", "reset", {
        "task": req.task,
        "observation": obs.model_dump(),
    })

    return ResetResponse(observation=obs, done=False, reward=0.0)


@app.post("/step")
async def step(req: StepRequest) -> StepResponse:
    env = _get_env()

    try:
        action = BazaarAction(action=req.action, price=req.price)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid action: {e}")

    obs, reward_obj = env.step(action)

    # Broadcast via WebSocket
    await _broadcast("default", "step", {
        "round": env.current_round,
        "buyer_action": req.action,
        "buyer_price": req.price,
        "observation": obs.model_dump(),
        "reward": reward_obj.reward,
        "reward_components": reward_obj.components,
        "done": obs.done,
    })

    # Check if all episodes are done (career mode)
    all_done = env.all_episodes_done
    if env.done and not all_done:
        next_obs = env.reset()

        await _broadcast("default", "episode_end", {
            "episode": env.current_episode - 1,
            "next_episode": env.current_episode,
        })

        return StepResponse(
            observation=next_obs,
            reward=reward_obj.reward,
            done=False,
            info={
                "episode_done": True,
                "episode": env.current_episode - 1,
                "reward_components": reward_obj.components,
                "next_episode": env.current_episode,
            },
        )

    return StepResponse(
        observation=obs,
        reward=reward_obj.reward,
        done=all_done if env.task.enable_career else obs.done,
        info={
            "reward_components": reward_obj.components,
            "episode": env.current_episode,
        },
    )


@app.get("/state")
async def state() -> EnvironmentState:
    env = _get_env()
    return env.get_state()


@app.get("/score")
async def score() -> ScoreResponse:
    env = _get_env()
    task = env.task
    grader = GRADERS.get(task.name)
    if not grader:
        raise HTTPException(status_code=400, detail=f"No grader for task: {task.name}")

    final_score = grader(env.episode_results, task)
    return ScoreResponse(
        task=task.name,
        score=round(final_score, 4),
        episodes_completed=len(env.episode_results),
        total_episodes=task.total_episodes,
        success=final_score >= task.success_threshold,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}


# ── Highlight: span-level tell extraction for the /sell page ────

class HighlightRequest(BaseModel):
    message: str


class HighlightSpan(BaseModel):
    start: int
    end: int
    text: str
    signal: str
    score: float
    explanation: str


class HighlightResponse(BaseModel):
    spans: list[HighlightSpan]
    aggregate: dict[str, float]


@app.post("/highlight", response_model=HighlightResponse)
async def highlight(req: HighlightRequest):
    """Find tell-triggering phrases in a seller message and return char spans.

    Used by the /sell page to underline urgency/deception/condition phrases
    in the user's chat bubble after they send. Pattern-based, deterministic,
    no LLM call — instant.
    """
    from nlp.keyword_patterns import find_matches, aggregate_signals

    matches = find_matches(req.message)
    return HighlightResponse(
        spans=[
            HighlightSpan(
                start=m.start, end=m.end, text=m.text,
                signal=m.signal, score=m.score, explanation=m.explanation,
            )
            for m in matches
        ],
        aggregate=aggregate_signals(matches),
    )


@app.get("/sauda/health")
async def sauda_health(request: Request):
    """Probe both backends. Used to choose strategy and surface config errors.

    Public response is intentionally minimal: just a green/red signal.
    For the full ops view (spend, rate-limit hits, circuit-breaker state),
    pass the X-Sauda-Admin header matching SAUDA_ADMIN_TOKEN env-var.
    """
    from .sauda_buyer import health as _full_health
    full = _full_health()
    admin_token = os.environ.get("SAUDA_ADMIN_TOKEN", "").strip()
    is_admin = bool(admin_token) and request.headers.get("x-sauda-admin", "") == admin_token
    if is_admin:
        return full
    # Public view: only the bits a UI needs to decide whether the live agent
    # is reachable. No spend numbers, no IP counts, no circuit breaker state.
    return {
        "status": "ok" if (full.get("hf_ok") or full.get("ollama_ok")) else "degraded",
        "live_agent_available": bool(full.get("hf_ok") or full.get("ollama_ok")),
    }


@app.get("/sauda/backends")
async def sauda_backends():
    """Static metadata about available buyer backends, for the /sell UI dropdown."""
    return {
        "backends": [
            {"id": "sauda", "label": "Sauda v2 (HF Endpoint)", "primary": True,
             "description": "Llama-3.1-8B + SFT+GRPO LoRA, served via HF Inference Endpoint."},
            {"id": "sauda_ollama", "label": "Sauda v2 (Ollama, local)", "primary": False,
             "description": "Same adapter, served locally via Ollama. Fallback when HF endpoint is unavailable."},
            {"id": "smart", "label": "Rule-based (smart)", "primary": False,
             "description": "Heuristic baseline. No LLM. Always available."},
            {"id": "naive", "label": "Rule-based (naive)", "primary": False,
             "description": "Easy buyer for seller-mode warmup."},
            {"id": "aggressive", "label": "Rule-based (aggressive)", "primary": False,
             "description": "Hard rule-based buyer."},
        ]
    }


# ── Simulate (AI auto-play for spectator mode) ──────────────────

class SimulateRequest(BaseModel):
    task: str = "single_deal"
    strategy: str = "smart"  # "smart", "naive", "aggressive", "llm"
    seed: Optional[int] = None
    seller_personality: Optional[str] = None
    speed_ms: int = 0  # 0 = return all at once
    # LLM config (only used when strategy="llm")
    llm_provider: Optional[str] = None  # "openai", "anthropic", "gemini", "huggingface", "grok"
    llm_api_key: Optional[str] = None
    llm_model: Optional[str] = None


class SellerModeStepRequest(BaseModel):
    """User plays as seller: set your counteroffer price."""
    price: float


def _ai_buyer_action(
    obs: BazaarObservation,
    strategy: str,
    rng,
    *,
    client_ip: Optional[str] = None,
) -> BazaarAction:
    """Built-in AI buyer strategies for spectator / seller mode.

    `strategy` values:
      - "sauda" / "sauda_hf"  → HF Inference Endpoint serving Sauda v2
      - "sauda_ollama"        → local ollama serving Sauda v2
      - "smart" / "naive" / "aggressive" → rule-based heuristics (no LLM)

    `client_ip` is forwarded to the safety layer for per-IP rate-limiting on
    the metered HF backend; pass None for trusted server-internal callers.
    """
    # Live Sauda v2 path (HF endpoint primary, Ollama fallback selectable)
    if strategy in ("sauda", "sauda_hf", "sauda_ollama"):
        from .sauda_buyer import sauda_action
        backend = "ollama" if strategy == "sauda_ollama" else "hf"
        obs_dict = obs.model_dump() if hasattr(obs, "model_dump") else obs.dict()
        result = sauda_action(obs_dict, backend=backend, client_ip=client_ip)
        action_str = result.get("action", "offer")
        price = result.get("price")
        msg = result.get("message", "")
        if action_str == "accept":
            ba = BazaarAction(action="accept")
        elif action_str == "walk":
            ba = BazaarAction(action="walk")
        else:
            ba = BazaarAction(action="offer", price=float(price) if price is not None else round((obs.own_private_budget or 100) * 0.3, 2))
        # Smuggle the model's prose message + backend trace through a side channel
        # (BazaarAction has no message field; the route handler reads .sauda_message
        # off the action when present).
        try:
            object.__setattr__(ba, "sauda_message", msg)
            object.__setattr__(ba, "sauda_backend", result.get("backend", backend))
            if result.get("error"):
                object.__setattr__(ba, "sauda_error", result["error"])
        except Exception:
            pass
        return ba

    budget = obs.own_private_budget
    ask = obs.seller_asking_price
    opp = obs.opponent_last_offer or ask

    if strategy == "naive":
        if obs.current_round == 0:
            return BazaarAction(action="offer", price=round(ask * 0.8, 2))
        if obs.current_round >= 2:
            return BazaarAction(action="accept")
        return BazaarAction(action="offer", price=round(ask * 0.85, 2))

    elif strategy == "aggressive":
        target = budget * 0.35
        if obs.current_round == 0:
            return BazaarAction(action="offer", price=round(target * 0.7, 2))
        if opp <= target * 1.1:
            return BazaarAction(action="accept")
        if obs.rounds_remaining <= 1:
            return BazaarAction(action="walk")
        step_up = target * (0.7 + 0.05 * obs.current_round)
        return BazaarAction(action="offer", price=round(min(step_up, target), 2))

    else:  # smart
        if obs.current_round == 0:
            return BazaarAction(action="offer", price=round(ask * 0.4, 2))

        seller_velocity = obs.seller_last_move_delta or 0
        own_move = budget * 0.02 if seller_velocity > ask * 0.05 else budget * 0.05
        last = obs.own_last_offer or (ask * 0.4)
        next_offer = last + own_move

        if obs.own_private_deadline and obs.current_round >= obs.own_private_deadline - 1:
            next_offer = min(opp * 0.95, budget * 0.7)
            if obs.current_round >= obs.own_private_deadline:
                return BazaarAction(action="accept")

        if opp <= budget * 0.55:
            return BazaarAction(action="accept")
        if obs.rounds_remaining <= 1 and opp > budget * 0.75:
            return BazaarAction(action="walk")
        if obs.rounds_remaining <= 1:
            return BazaarAction(action="accept")

        # Read tells if available
        if obs.tells and obs.tells.verbal_deception_cue > 0.4:
            next_offer *= 0.92  # hold firmer against bluffers

        if obs.career_history and obs.career_history.capitulation_rate > 0.3:
            next_offer *= 0.95

        next_offer = max(next_offer, ask * 0.3)
        next_offer = min(next_offer, budget * 0.7)
        return BazaarAction(action="offer", price=round(next_offer, 2))


@app.get("/providers")
async def list_providers():
    """List available LLM providers and their models."""
    from .llm import PROVIDERS
    return {
        name: {
            "name": p["name"],
            "models": p["models"],
        }
        for name, p in PROVIDERS.items()
    }


@app.post("/simulate")
async def simulate(req: SimulateRequest):
    """Run a full AI-vs-seller negotiation and return the complete history.

    Used for spectator mode — watch an AI agent negotiate in real-time.
    strategy="llm" uses an actual LLM via the specified provider.
    """
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}")

    if req.strategy == "llm":
        if not req.llm_provider or not req.llm_api_key:
            raise HTTPException(
                status_code=400,
                detail="LLM strategy requires llm_provider and llm_api_key",
            )

    task = copy.deepcopy(TASKS[req.task])
    if req.seller_personality:
        task.seller_personality = SellerPersonalityType(req.seller_personality)

    env = BazaarEnvironment(task, seed=req.seed)
    _envs["spectator"] = env

    import random
    rng = random.Random(req.seed)

    steps = []
    llm_history: list[str] = []  # conversation log for LLM context

    for ep in range(task.total_episodes):
        obs = env.reset()
        steps.append({
            "round": 0,
            "episode": ep + 1,
            "actor": "seller",
            "action": "open",
            "price": obs.seller_asking_price,
            "message": obs.message,
            "reasoning": None,
            "reward": 0,
            "done": False,
            "tells": obs.tells.model_dump() if obs.tells else None,
        })

        max_rounds = task.max_steps if task.total_episodes == 1 else task.max_steps // task.total_episodes
        for r in range(1, max_rounds + 1):
            if env.done:
                break

            reasoning = None

            if req.strategy == "llm":
                # Use actual LLM
                from .llm import call_llm
                obs_dict = obs.model_dump()
                llm_result = call_llm(
                    provider=req.llm_provider,
                    api_key=req.llm_api_key,
                    model=req.llm_model,
                    obs=obs_dict,
                    history=llm_history,
                )
                action_str = llm_result.get("action", "offer")
                price = llm_result.get("price")
                reasoning = llm_result.get("reasoning", "")
                action = BazaarAction(action=action_str, price=price)

                # Build history entry for next LLM call
                llm_history.append(
                    f"Round {r}: You {'offered ' + str(price) if action_str == 'offer' else action_str}"
                    f" -> Seller: {obs.message}"
                )
            else:
                action = _ai_buyer_action(obs, req.strategy, rng)

            obs, reward_obj = env.step(action)

            steps.append({
                "round": r,
                "episode": ep + 1,
                "actor": "buyer",
                "action": action.action.value if hasattr(action.action, 'value') else action.action,
                "price": action.price,
                "buyer_offer": action.price,
                "seller_offer": obs.opponent_last_offer,
                "message": obs.message,
                "reasoning": reasoning,
                "reward": reward_obj.reward,
                "reward_components": reward_obj.components,
                "done": obs.done,
                "outcome": obs.deal_outcome.value if obs.deal_outcome else None,
                "tells": obs.tells.model_dump() if obs.tells else None,
            })

            if obs.done:
                break

    grader = GRADERS.get(task.name)
    final_score = grader(env.episode_results, task) if grader else 0.0

    return {
        "steps": steps,
        "score": round(final_score, 4),
        "task": task.name,
        "strategy": req.strategy,
        "personality": task.seller_personality.value,
        "episodes": len(env.episode_results),
        "state": env.get_state().model_dump(),
    }


# ── Seller mode (user plays as seller, AI is buyer) ─────────────

class SellerModeResetRequest(BaseModel):
    task: str = "single_deal"
    strategy: str = "smart"
    seed: Optional[int] = None
    opening_price: float = 60.0
    item_name: Optional[str] = None
    listing_price: Optional[float] = None  # if user picked a real listing, this is its MRP


@app.post("/seller-mode/reset")
async def seller_mode_reset(req: SellerModeResetRequest, request: Request):
    """Start a seller-mode session. User plays as seller, AI plays as buyer."""
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}")

    task = copy.deepcopy(TASKS[req.task])

    # Tasks have hardcoded buyer_budget / seller_cost from synthetic examples.
    # When the user opens at a real-listing price ($2695 for an iPhone, $399
    # for a sofa, etc) those numbers become nonsense and Sauda offers $30 on
    # a $2695 ask. Anchor the scale on the task's *opening price prior* —
    # buyer_budget = 1.67×ask in single_deal (60 → 100), and the relative
    # ratios (cost / budget ≈ 0.35, ask / budget ≈ 0.6) hold across tasks.
    # Derive sane budget/cost from the user's actual opening_price using those
    # ratios so the buyer's model of the deal scales with the listing.
    if req.opening_price and req.opening_price > 0:
        scaled_budget = float(req.opening_price) * 1.05   # buyer can stretch ~5% above ask
        scaled_cost = float(req.opening_price) * 0.35     # seller's true cost ~35% of ask
    else:
        scaled_budget = task.buyer_budget
        scaled_cost = task.seller_cost

    # Store seller mode state
    import random
    session = {
        "task": task,
        "strategy": req.strategy,
        "rng": random.Random(req.seed),
        "round": 0,
        "max_rounds": task.max_steps if task.total_episodes == 1 else task.max_steps // task.total_episodes,
        "buyer_budget": scaled_budget,
        "seller_cost": scaled_cost,
        "current_seller_price": req.opening_price,
        "last_buyer_offer": None,
        "history": [],
        "done": False,
        "outcome": None,
    }
    _envs["seller_mode"] = session  # type: ignore

    # AI buyer sees the opening price
    obs = BazaarObservation(
        current_round=0,
        max_rounds=session["max_rounds"],
        opponent_last_offer=req.opening_price,
        own_private_budget=scaled_budget,
        rounds_remaining=session["max_rounds"],
        seller_asking_price=req.opening_price,
        item_name=req.item_name or "handwoven silk scarf",
        message=f"You open at {req.opening_price:.0f} rupees.",
    )

    # AI buyer makes first offer
    client_ip = _client_ip(request)
    action = _ai_buyer_action(obs, req.strategy, session["rng"], client_ip=client_ip)
    session["round"] = 1
    session["last_buyer_offer"] = action.price
    sauda_msg = getattr(action, "sauda_message", None) or ""
    sauda_backend = getattr(action, "sauda_backend", None)
    sauda_error = getattr(action, "sauda_error", None)
    session["history"].append({
        "round": 0,
        "actor": "seller",
        "action": "open",
        "price": req.opening_price,
    })
    session["history"].append({
        "round": 1,
        "actor": "buyer",
        "action": action.action.value if hasattr(action.action, 'value') else action.action,
        "price": action.price,
        "message": sauda_msg,
    })

    fallback_msg = (
        f"Buyer offers {action.price:.0f} rupees."
        if action.action in ("offer", "OFFER", ActionType.OFFER)
        else f"Buyer {action.action}s."
    )

    return {
        "round": 1,
        "buyer_action": action.action.value if hasattr(action.action, 'value') else action.action,
        "buyer_price": action.price,
        "message": sauda_msg or fallback_msg,
        "buyer_message": sauda_msg,
        "your_opening": req.opening_price,
        "history": session["history"],
        "done": False,
    }


@app.post("/seller-mode/step")
async def seller_mode_step(req: SellerModeStepRequest, request: Request):
    """User (as seller) sets counteroffer price. AI buyer responds."""
    if "seller_mode" not in _envs:
        raise HTTPException(status_code=400, detail="No seller-mode session. Call /seller-mode/reset first.")

    session = _envs["seller_mode"]
    if session["done"]:
        return {"message": "Negotiation is over.", "done": True, "history": session["history"]}

    seller_price = req.price
    session["current_seller_price"] = seller_price
    session["round"] += 1
    rnd = session["round"]

    session["history"].append({
        "round": rnd,
        "actor": "seller",
        "action": "counter",
        "price": seller_price,
    })

    # Check if seller accepted buyer's offer (seller price <= buyer's offer)
    if session["last_buyer_offer"] is not None and seller_price <= session["last_buyer_offer"]:
        session["done"] = True
        session["outcome"] = "deal"
        agreed = session["last_buyer_offer"]
        surplus = session["buyer_budget"] - agreed
        max_surplus = session["buyer_budget"] - session["seller_cost"]
        buyer_score = max(0, surplus / max_surplus) if max_surplus > 0 else 0

        return {
            "round": rnd,
            "message": f"You accepted the buyer's offer of {agreed:.0f}! Deal closed.",
            "buyer_action": "deal",
            "buyer_price": agreed,
            "done": True,
            "outcome": "deal",
            "agreed_price": agreed,
            "buyer_score": round(buyer_score, 4),
            "seller_profit": agreed - session["seller_cost"],
            "history": session["history"],
        }

    # Build observation for AI buyer
    obs = BazaarObservation(
        current_round=rnd,
        max_rounds=session["max_rounds"],
        own_last_offer=session["last_buyer_offer"],
        opponent_last_offer=seller_price,
        own_private_budget=session["buyer_budget"],
        rounds_remaining=max(0, session["max_rounds"] - rnd),
        seller_asking_price=session["history"][0]["price"],
        item_name="handwoven silk scarf",
        message=f"Seller counters: {seller_price:.0f} rupees.",
    )

    # Check expired
    if rnd >= session["max_rounds"]:
        session["done"] = True
        session["outcome"] = "expired"
        return {
            "round": rnd,
            "message": "Time's up! No deal reached.",
            "buyer_action": "expired",
            "buyer_price": None,
            "done": True,
            "outcome": "expired",
            "history": session["history"],
        }

    # AI buyer responds
    client_ip = _client_ip(request)
    action = _ai_buyer_action(obs, session["strategy"], session["rng"], client_ip=client_ip)

    if action.action in ("accept", ActionType.ACCEPT):
        session["done"] = True
        session["outcome"] = "deal"
        agreed = seller_price
        surplus = session["buyer_budget"] - agreed
        max_surplus = session["buyer_budget"] - session["seller_cost"]
        buyer_score = max(0, surplus / max_surplus) if max_surplus > 0 else 0

        sauda_msg = getattr(action, "sauda_message", None) or ""
        sauda_backend = getattr(action, "sauda_backend", None)
        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "accept",
            "price": seller_price,
            "message": sauda_msg,
        })

        return {
            "round": rnd,
            "message": sauda_msg or f"Buyer accepts your price of {seller_price:.0f}! Deal closed.",
            "buyer_message": sauda_msg,
            "buyer_action": "accept",
            "buyer_price": seller_price,
            "done": True,
            "outcome": "deal",
            "agreed_price": seller_price,
            "buyer_score": round(buyer_score, 4),
            "seller_profit": seller_price - session["seller_cost"],
            "history": session["history"],
        }

    elif action.action in ("walk", ActionType.WALK):
        session["done"] = True
        session["outcome"] = "walk"
        sauda_msg = getattr(action, "sauda_message", None) or ""
        sauda_backend = getattr(action, "sauda_backend", None)

        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "walk",
            "price": None,
            "message": sauda_msg,
        })

        return {
            "round": rnd,
            "message": sauda_msg or "Buyer walks away! No deal.",
            "buyer_message": sauda_msg,
            "buyer_action": "walk",
            "buyer_price": None,
            "done": True,
            "outcome": "walk",
            "history": session["history"],
        }

    else:  # offer
        session["last_buyer_offer"] = action.price
        sauda_msg = getattr(action, "sauda_message", None) or ""
        sauda_backend = getattr(action, "sauda_backend", None)
        sauda_error = getattr(action, "sauda_error", None)
        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "offer",
            "price": action.price,
            "message": sauda_msg,
        })

        return {
            "round": rnd,
            "message": sauda_msg or f"Buyer counters with {action.price:.0f} rupees.",
            "buyer_message": sauda_msg,
            "buyer_action": "offer",
            "buyer_price": action.price,
            "done": False,
            "history": session["history"],
        }


# ── WebSocket ────────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str = "default"):
    await websocket.accept()

    if session_id not in _ws_connections:
        _ws_connections[session_id] = []
    _ws_connections[session_id].append(websocket)

    try:
        # Send current state if session exists
        if session_id in _envs:
            env = _envs[session_id]
            await websocket.send_json({
                "event": "connected",
                "state": env.get_state().model_dump(),
            })
        else:
            await websocket.send_json({"event": "connected", "state": None})

        # Keep alive and handle client messages
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "ping":
                await websocket.send_json({"event": "pong"})

            elif msg.get("type") == "step":
                # Allow stepping via WebSocket too
                env = _get_env(session_id)
                action = BazaarAction(action=msg["action"], price=msg.get("price"))
                obs, reward_obj = env.step(action)

                response = {
                    "event": "step",
                    "round": env.current_round,
                    "observation": obs.model_dump(),
                    "reward": reward_obj.reward,
                    "reward_components": reward_obj.components,
                    "done": obs.done,
                }
                # Broadcast to all watchers
                await _broadcast(session_id, "step", response)

    except WebSocketDisconnect:
        _ws_connections[session_id].remove(websocket)


# ── Leaderboard ──────────────────────────────────────────────────

@app.get("/leaderboard")
async def leaderboard(task: Optional[str] = None, limit: int = 50, offset: int = 0) -> LeaderboardResponse:
    return get_leaderboard(task=task, limit=limit, offset=offset)


@app.get("/leaderboard/best")
async def leaderboard_best():
    return get_best_scores()


@app.post("/leaderboard/record")
async def leaderboard_record(req: RecordScoreRequest) -> LeaderboardEntry:
    env = _get_env()
    task = env.task
    grader = GRADERS.get(task.name)
    if not grader:
        raise HTTPException(status_code=400, detail=f"No grader for task: {task.name}")

    final_score = grader(env.episode_results, task)
    return record_score(
        agent_name=req.agent_name,
        task=task.name,
        score=round(final_score, 4),
        episodes_completed=len(env.episode_results),
        metadata=req.metadata,
    )


# ── Counterfactual analysis ──────────────────────────────────────

@app.post("/counterfactual")
async def counterfactual(req: CounterfactualRequest) -> CounterfactualResult:
    """Replay from a decision point with a different action.

    Uses environment snapshots to fork the negotiation at any round
    and explore 'what if I had offered X instead?'
    """
    env = _get_env(req.session_id)

    # Save original results
    original_results = list(env.episode_results)
    original_outcome = original_results[-1].outcome if original_results else None
    original_price = original_results[-1].agreed_price if original_results else None
    original_grader = GRADERS.get(env.task.name)
    original_score = original_grader(original_results, env.task) if original_grader else 0.0

    # Create a copy of the environment and restore to the fork point
    cf_env = copy.deepcopy(env)
    if not cf_env.restore_snapshot(req.from_round):
        raise HTTPException(
            status_code=400,
            detail=f"No snapshot at round {req.from_round}. Available: {list(env._snapshots.keys())}",
        )

    # Execute the alternative action
    alt_action = BazaarAction(action=req.alternative_action, price=req.alternative_price)
    cf_history = []

    obs, reward = cf_env.step(alt_action)
    cf_history.append({
        "round": cf_env.current_round,
        "action": req.alternative_action.value,
        "price": req.alternative_price,
        "seller_response": obs.message,
        "reward": reward.reward,
        "done": obs.done,
    })

    # Continue with a simple greedy strategy for remaining rounds
    while not cf_env.done and cf_env.current_round < cf_env.seller.max_rounds:
        if obs.opponent_last_offer and obs.opponent_last_offer <= cf_env.buyer_budget * 0.6:
            action = BazaarAction(action="accept")
        else:
            offer_price = (obs.opponent_last_offer or cf_env.seller.anchor) * 0.85
            offer_price = min(offer_price, cf_env.buyer_budget * 0.7)
            action = BazaarAction(action="offer", price=round(offer_price, 2))

        obs, reward = cf_env.step(action)
        cf_history.append({
            "round": cf_env.current_round,
            "action": action.action.value,
            "price": action.price,
            "seller_response": obs.message,
            "reward": reward.reward,
            "done": obs.done,
        })

    cf_results = cf_env.episode_results
    cf_outcome = cf_results[-1].outcome if cf_results else None
    cf_price = cf_results[-1].agreed_price if cf_results else None
    cf_score = original_grader(cf_results, cf_env.task) if original_grader else 0.0

    return CounterfactualResult(
        original_outcome=original_outcome,
        original_price=original_price,
        original_score=round(original_score, 4),
        counterfactual_outcome=cf_outcome,
        counterfactual_price=cf_price,
        counterfactual_score=round(cf_score, 4),
        divergence_round=req.from_round,
        counterfactual_history=cf_history,
    )


# ── Multi-buyer Arena ───────────────────────────────────────────

@app.post("/arena/create")
async def arena_create(req: ArenaCreateRequest):
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}")

    task = copy.deepcopy(TASKS[req.task])
    task.num_buyers = req.num_buyers
    arena = MultiBuyerArena(task, seed=req.seed)
    arena_id = arena.arena_id
    _arenas[arena_id] = arena
    return {"arena_id": arena_id, "num_buyers": req.num_buyers, "task": req.task}


@app.post("/arena/{arena_id}/join")
async def arena_join(arena_id: str, req: ArenaJoinRequest):
    if arena_id not in _arenas:
        raise HTTPException(status_code=404, detail="Arena not found")
    arena = _arenas[arena_id]
    try:
        buyer = arena.add_buyer(req.buyer_id, req.name, req.is_human)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"buyer": buyer.model_dump(), "arena_id": arena_id, "total_buyers": len(arena.buyers)}


@app.post("/arena/{arena_id}/reset")
async def arena_reset(arena_id: str):
    if arena_id not in _arenas:
        raise HTTPException(status_code=404, detail="Arena not found")
    arena = _arenas[arena_id]
    if len(arena.buyers) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 buyers to start")
    observations = arena.reset()
    return {bid: obs.model_dump() for bid, obs in observations.items()}


@app.post("/arena/{arena_id}/step")
async def arena_step(arena_id: str, req: ArenaStepRequest):
    if arena_id not in _arenas:
        raise HTTPException(status_code=404, detail="Arena not found")
    arena = _arenas[arena_id]

    actions = {}
    for bid, act_dict in req.actions.items():
        actions[bid] = ArenaAction(
            buyer_id=bid,
            action=act_dict.get("action", "offer"),
            price=act_dict.get("price"),
            signal=act_dict.get("signal"),
        )

    observations = arena.step(actions)

    await _broadcast(f"arena_{arena_id}", "arena_step", {
        "round": arena.current_round,
        "done": arena.done,
        "winner": arena.winner,
    })

    return {bid: obs.model_dump() for bid, obs in observations.items()}


@app.get("/arena/{arena_id}/state")
async def arena_state(arena_id: str) -> ArenaState:
    if arena_id not in _arenas:
        raise HTTPException(status_code=404, detail="Arena not found")
    return _arenas[arena_id].get_state()
