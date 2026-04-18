"""Standalone, training-ready BazaarBot negotiation environment.

This package is a thin re-export of the core env (`models`, `seller`,
`environment`, `tasks`) plus a training-oriented wrapper:

    from bazaarbot_env import BazaarGymEnv, rollout_episode

It is importable without FastAPI, uvicorn, or any of the serving stack —
designed to vendor cleanly into a Kaggle notebook or standalone training job.

Usage:
    env = BazaarGymEnv(task_name="single_deal", seed=42)
    obs, _ = env.reset()
    while not env.done:
        action = policy(obs)          # policy returns dict: {"action": ..., "price": ...}
        obs, reward, done, info = env.step(action)

For GRPO-style training over multiple rollouts, use `rollout_episode`.
"""

from .models import (
    ActionType,
    BazaarAction,
    BazaarObservation,
    BazaarReward,
    CareerHistory,
    DealOutcome,
    DealRecord,
    EnvironmentState,
    SellerPersonalityType,
    TaskConfig,
    TellObservation,
)
from .environment import BazaarEnvironment
from .seller import SellerPersonality, SellerState, SellerTell
from .tasks import GRADERS, TASKS
from .gym_wrapper import (
    DEFAULT_SYSTEM_PROMPT,
    BazaarGymEnv,
    format_observation,
    parse_action,
    rollout_episode,
)

__all__ = [
    "ActionType",
    "BazaarAction",
    "BazaarEnvironment",
    "BazaarGymEnv",
    "BazaarObservation",
    "BazaarReward",
    "CareerHistory",
    "DealOutcome",
    "DealRecord",
    "DEFAULT_SYSTEM_PROMPT",
    "EnvironmentState",
    "GRADERS",
    "SellerPersonality",
    "SellerPersonalityType",
    "SellerState",
    "SellerTell",
    "TASKS",
    "TaskConfig",
    "TellObservation",
    "format_observation",
    "parse_action",
    "rollout_episode",
]
