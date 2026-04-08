"""FastAPI server for BazaarBot environment."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .environment import BazaarEnvironment
from .models import BazaarAction, BazaarObservation, BazaarReward, EnvironmentState
from .tasks import GRADERS, TASKS


# ── Request / Response models ─────────────────────────────────────

class ResetRequest(BaseModel):
    task: str = "single_deal"
    seed: Optional[int] = None


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


# ── App state ─────────────────────────────────────────────────────

_envs: dict[str, BazaarEnvironment] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    _envs.clear()


app = FastAPI(
    title="BazaarBot",
    description="OpenEnv negotiation environment simulating customer-vendor price bargaining",
    version="1.0.0",
    lifespan=lifespan,
)


def _get_env(session_id: str = "default") -> BazaarEnvironment:
    if session_id not in _envs:
        raise HTTPException(status_code=400, detail="No active session. Call /reset first.")
    return _envs[session_id]


# ── Endpoints ─────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    task_rows = "".join(
        f"<tr><td><code>{name}</code></td><td>{t.difficulty.capitalize()}</td><td>{t.description}</td></tr>"
        for name, t in TASKS.items()
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BazaarBATNA</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 860px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; }}
    h1 {{ font-size: 2rem; margin-bottom: 4px; }}
    .subtitle {{ color: #555; margin-bottom: 32px; }}
    .badge {{ display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }}
    .running {{ background: #d1fae5; color: #065f46; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0 32px; }}
    th {{ text-align: left; padding: 8px 12px; background: #f4f4f5; font-size: 0.8rem; text-transform: uppercase; letter-spacing: .05em; }}
    td {{ padding: 8px 12px; border-top: 1px solid #e4e4e7; font-size: 0.9rem; vertical-align: top; }}
    code {{ background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }}
    .method {{ font-size: 0.75rem; font-weight: 700; color: #fff; padding: 2px 7px; border-radius: 4px; }}
    .post {{ background: #f59e0b; }}
    .get {{ background: #3b82f6; }}
    a {{ color: #2563eb; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
  <h1>🪬 BazaarBATNA</h1>
  <p class="subtitle">Customer-vendor price negotiation environment &nbsp;·&nbsp; <span class="badge running">● Running</span></p>

  <h2>Tasks</h2>
  <table>
    <tr><th>Name</th><th>Difficulty</th><th>Description</th></tr>
    {task_rows}
  </table>

  <h2>Endpoints</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Description</th></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/reset</code></td><td>Start a new episode. Body: <code>{{"task": "single_deal", "seed": 42}}</code></td></tr>
    <tr><td><span class="method post">POST</span></td><td><code>/step</code></td><td>Submit buyer action. Body: <code>{{"action": "offer", "price": 35.0}}</code></td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/state</code></td><td>Full environment state</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/score</code></td><td>Graded score for current task</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/tasks</code></td><td>List available tasks</td></tr>
    <tr><td><span class="method get">GET</span></td><td><code>/health</code></td><td>Health check</td></tr>
  </table>

  <p><a href="/docs">Interactive API docs →</a></p>
</body>
</html>"""


@app.get("/tasks")
async def list_tasks():
    return {name: {"difficulty": t.difficulty, "description": t.description} for name, t in TASKS.items()}


@app.post("/reset")
async def reset(req: ResetRequest = ResetRequest()) -> ResetResponse:
    if req.task not in TASKS:
        raise HTTPException(status_code=400, detail=f"Unknown task: {req.task}. Available: {list(TASKS.keys())}")

    task = TASKS[req.task]
    env = BazaarEnvironment(task, seed=req.seed)
    obs = env.reset()
    _envs["default"] = env

    return ResetResponse(observation=obs, done=False, reward=0.0)


@app.post("/step")
async def step(req: StepRequest) -> StepResponse:
    env = _get_env()

    try:
        action = BazaarAction(action=req.action, price=req.price)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid action: {e}")

    obs, reward_obj = env.step(action)

    # Check if all episodes are done (career mode)
    all_done = env.all_episodes_done
    if env.done and not all_done:
        # Auto-reset for next episode
        next_obs = env.reset()
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
    return {"status": "ok"}
