"""FastAPI server for BazaarBot environment."""

from __future__ import annotations

import copy
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
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
        f"<tr><td><code>{name}</code></td><td>{t.difficulty.capitalize()}</td>"
        f"<td><code>{t.seller_personality.value}</code></td><td>{t.description}</td></tr>"
        for name, t in TASKS.items()
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BazaarBATNA v2</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 960px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; }}
    h1 {{ font-size: 2rem; margin-bottom: 4px; }}
    .subtitle {{ color: #555; margin-bottom: 32px; }}
    .badge {{ display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }}
    .running {{ background: #d1fae5; color: #065f46; }}
    .new {{ background: #dbeafe; color: #1e40af; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0 32px; }}
    th {{ text-align: left; padding: 8px 12px; background: #f4f4f5; font-size: 0.8rem; text-transform: uppercase; letter-spacing: .05em; }}
    td {{ padding: 8px 12px; border-top: 1px solid #e4e4e7; font-size: 0.9rem; vertical-align: top; }}
    code {{ background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }}
    .method {{ font-size: 0.75rem; font-weight: 700; color: #fff; padding: 2px 7px; border-radius: 4px; }}
    .post {{ background: #f59e0b; }}
    .get {{ background: #3b82f6; }}
    .ws {{ background: #8b5cf6; }}
    a {{ color: #2563eb; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <h1>BazaarBATNA v2</h1>
  <p class="subtitle">Negotiation environment with game theory, poker tells, and multi-buyer arenas
    &nbsp;&middot;&nbsp; <span class="badge running">Running</span>
    &nbsp;<span class="badge new">NEW: Tells + Arena</span></p>

  <h2>Tasks</h2>
  <table>
    <tr><th>Name</th><th>Difficulty</th><th>Personality</th><th>Description</th></tr>
    {task_rows}
  </table>

  <h2>Endpoints</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Description</th></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/reset</code></td><td>Start a new episode</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/step</code></td><td>Submit buyer action</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/state</code></td><td>Full environment state</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/score</code></td><td>Graded score</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/tasks</code></td><td>Available tasks</td></tr>
    <tr><td><span class="method ws">WS</span></td><td><code>/ws/{{session}}</code></td><td>Real-time negotiation stream</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/leaderboard</code></td><td>Score leaderboard</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/leaderboard/record</code></td><td>Record a score</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/counterfactual</code></td><td>What-if replay from any round</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/arena/create</code></td><td>Create multi-buyer arena</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/arena/join</code></td><td>Join an arena</td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/arena/step</code></td><td>Submit arena actions</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/arena/state</code></td><td>Arena state</td></tr>
  </table>

  <p><a href="/docs">Interactive API docs &rarr;</a></p>
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


# ── Simulate (AI auto-play for spectator mode) ──────────────────

class SimulateRequest(BaseModel):
    task: str = "single_deal"
    strategy: str = "smart"  # "smart", "naive", "aggressive"
    seed: Optional[int] = None
    seller_personality: Optional[str] = None
    speed_ms: int = 0  # 0 = return all at once


class SellerModeStepRequest(BaseModel):
    """User plays as seller: set your counteroffer price."""
    price: float


def _ai_buyer_action(obs: BazaarObservation, strategy: str, rng) -> BazaarAction:
    """Built-in AI buyer strategies for spectator / seller mode."""
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


@app.post("/simulate")
async def simulate(req: SimulateRequest):
    """Run a full AI-vs-seller negotiation and return the complete history.

    Used for spectator mode — watch an AI agent negotiate in real-time.
    """
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}")

    task = copy.deepcopy(TASKS[req.task])
    if req.seller_personality:
        task.seller_personality = SellerPersonalityType(req.seller_personality)

    env = BazaarEnvironment(task, seed=req.seed)
    _envs["spectator"] = env

    import random
    rng = random.Random(req.seed)

    steps = []
    for ep in range(task.total_episodes):
        obs = env.reset()
        steps.append({
            "round": 0,
            "episode": ep + 1,
            "actor": "seller",
            "action": "open",
            "price": obs.seller_asking_price,
            "message": obs.message,
            "reward": 0,
            "done": False,
            "tells": obs.tells.model_dump() if obs.tells else None,
        })

        max_rounds = task.max_steps if task.total_episodes == 1 else task.max_steps // task.total_episodes
        for r in range(1, max_rounds + 1):
            if env.done:
                break

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


@app.post("/seller-mode/reset")
async def seller_mode_reset(req: SellerModeResetRequest):
    """Start a seller-mode session. User plays as seller, AI plays as buyer."""
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}")

    task = copy.deepcopy(TASKS[req.task])
    # Store seller mode state
    import random
    session = {
        "task": task,
        "strategy": req.strategy,
        "rng": random.Random(req.seed),
        "round": 0,
        "max_rounds": task.max_steps if task.total_episodes == 1 else task.max_steps // task.total_episodes,
        "buyer_budget": task.buyer_budget,
        "seller_cost": task.seller_cost,
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
        own_private_budget=task.buyer_budget,
        rounds_remaining=session["max_rounds"],
        seller_asking_price=req.opening_price,
        item_name="handwoven silk scarf",
        message=f"You open at {req.opening_price:.0f} rupees.",
    )

    # AI buyer makes first offer
    action = _ai_buyer_action(obs, req.strategy, session["rng"])
    session["round"] = 1
    session["last_buyer_offer"] = action.price
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
    })

    buyer_msg = (
        f"Buyer offers {action.price:.0f} rupees."
        if action.action in ("offer", "OFFER", ActionType.OFFER)
        else f"Buyer {action.action}s."
    )

    return {
        "round": 1,
        "buyer_action": action.action.value if hasattr(action.action, 'value') else action.action,
        "buyer_price": action.price,
        "message": buyer_msg,
        "your_opening": req.opening_price,
        "history": session["history"],
        "done": False,
    }


@app.post("/seller-mode/step")
async def seller_mode_step(req: SellerModeStepRequest):
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
    action = _ai_buyer_action(obs, session["strategy"], session["rng"])

    if action.action in ("accept", ActionType.ACCEPT):
        session["done"] = True
        session["outcome"] = "deal"
        agreed = seller_price
        surplus = session["buyer_budget"] - agreed
        max_surplus = session["buyer_budget"] - session["seller_cost"]
        buyer_score = max(0, surplus / max_surplus) if max_surplus > 0 else 0

        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "accept",
            "price": seller_price,
        })

        return {
            "round": rnd,
            "message": f"Buyer accepts your price of {seller_price:.0f}! Deal closed.",
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

        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "walk",
            "price": None,
        })

        return {
            "round": rnd,
            "message": "Buyer walks away! No deal.",
            "buyer_action": "walk",
            "buyer_price": None,
            "done": True,
            "outcome": "walk",
            "history": session["history"],
        }

    else:  # offer
        session["last_buyer_offer"] = action.price
        session["history"].append({
            "round": rnd,
            "actor": "buyer",
            "action": "offer",
            "price": action.price,
        })

        return {
            "round": rnd,
            "message": f"Buyer counters with {action.price:.0f} rupees.",
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
