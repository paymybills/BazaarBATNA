"""FastAPI server for BazaarBot environment."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
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

@app.get("/")
async def root():
    return {
        "name": "BazaarBot",
        "description": "Customer-vendor negotiation environment",
        "tasks": list(TASKS.keys()),
        "endpoints": ["/reset", "/step", "/state", "/score", "/tasks"],
    }


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
