"""Training-friendly wrapper over BazaarEnvironment.

Exposes a minimal in-process API (no HTTP) for RL training.  The wrapper:

- Accepts actions as plain dicts: ``{"action": "offer|accept|walk", "price": float | None}``.
- Emits observations as plain dicts with every field the LLM prompt needs.
- Terminates when the environment's current episode ends.  For career tasks
  (multiple episodes), call `reset_episode()` between episodes and sum
  terminal rewards — each episode's terminal reward is the GRPO advantage unit.
- Provides `format_observation()` so the same prompt string is used at train
  time and inference time.
- Provides `rollout_episode(policy_fn, ...)` as the GRPO rollout primitive:
  returns a list of (prompt, action_text, reward) tuples plus the final
  graded score.
"""

from __future__ import annotations

import copy
import json
import random
import textwrap
from typing import Any, Callable, Optional

from .environment import BazaarEnvironment
from .models import (
    ActionType,
    BazaarAction,
    BazaarObservation,
    SellerPersonalityType,
    TaskConfig,
)
from .tasks import GRADERS, TASKS


# Keep in sync with inference.py's system prompt so training and eval
# see the same conditioning.  Few-shot examples are inline so a cold
# (un-SFT'd) base model has the pattern to copy.
DEFAULT_SYSTEM_PROMPT = textwrap.dedent("""\
    You are a buyer at an Indian bazaar. Your ONLY output is one JSON object.

    Rules:
    - Seller's opening price is inflated. Negotiate down.
    - Never reveal your budget.
    - Close early at a good price; don't grind for pennies.

    Output schema (pick ONE per turn):
    {"action": "offer", "price": <number>}
    {"action": "accept", "price": null}
    {"action": "walk", "price": null}

    Examples:

    Seller's ask: 100. Your budget: 200.
    {"action": "offer", "price": 35}

    Seller's ask: 45. Your budget: 200.
    {"action": "accept", "price": null}

    Seller's ask: 180. Your budget: 200.
    {"action": "walk", "price": null}

    Output ONE JSON object. No prose. No markdown. No thinking.
""")


def _obs_to_dict(obs: BazaarObservation) -> dict[str, Any]:
    return obs.model_dump(mode="json")


def format_observation(
    obs: dict[str, Any] | BazaarObservation,
    history: Optional[list[str]] = None,
) -> str:
    """Format an observation as the user-turn prompt.

    Mirrors the schema used by `inference.py::build_user_prompt` so the
    policy sees the same text distribution at train and eval time.
    """
    if isinstance(obs, BazaarObservation):
        obs = _obs_to_dict(obs)

    history_block = "\n".join((history or [])[-6:]) if history else "None"

    career_info = ""
    if obs.get("career_history"):
        ch = obs["career_history"]
        career_info = textwrap.dedent(f"""\
            --- Career History ---
            Episodes completed: {len(ch.get('deals', []))}
            Your capitulation rate: {ch.get('capitulation_rate', 0):.1%}
            Avg surplus captured: {ch.get('avg_normalized_surplus', 0):.1%}
            Avg rounds to close: {ch.get('avg_rounds_to_close', 0):.1f}
        """)

    deadline_info = ""
    if obs.get("own_private_deadline"):
        deadline_info = (
            f"YOUR HARD DEADLINE: Round {obs['own_private_deadline']} "
            "(seller doesn't know this!)\n"
        )

    return textwrap.dedent(f"""\
        --- Negotiation State ---
        Item: {obs.get('item_name', 'item')}
        Round: {obs.get('current_round', 0)} / {obs.get('max_rounds', 0)}
        Rounds remaining: {obs.get('rounds_remaining', 0)}
        Seller's current ask: {obs.get('opponent_last_offer', 'N/A')}
        Your last offer: {obs.get('own_last_offer', 'N/A')}
        Your private budget: {obs.get('own_private_budget', 0)}
        Seller's opening price: {obs.get('seller_asking_price', 0)}
        {deadline_info}\
        Seller's last concession: {obs.get('seller_last_move_delta', 'N/A')} rupees
        Episode: {obs.get('episode_number', 1)} / {obs.get('total_episodes', 1)}

        {career_info}\
        --- Recent History ---
        {history_block}

        Seller says: {obs.get('message', '')}

        Your move (JSON only):
    """)


def parse_action(text: str, fallback_price: float = 30.0) -> dict[str, Any]:
    """Best-effort JSON parser for LLM action output.

    Robust to the common failure modes: markdown fences, leading prose,
    trailing commentary.  Falls back to a conservative offer if unparseable
    so training never crashes on a bad generation.
    """
    s = text.strip()
    if "```" in s:
        parts = s.split("```")
        if len(parts) >= 2:
            s = parts[1]
            if s.lstrip().startswith("json"):
                s = s.lstrip()[4:]
    start = s.find("{")
    end = s.rfind("}") + 1
    if start >= 0 and end > start:
        s = s[start:end]
    try:
        parsed = json.loads(s)
        if parsed.get("action") not in ("offer", "accept", "walk"):
            return {"action": "offer", "price": fallback_price, "_parse_error": True}
        return parsed
    except Exception:
        return {"action": "offer", "price": fallback_price, "_parse_error": True}


class BazaarGymEnv:
    """Minimal gym-like wrapper over BazaarEnvironment for in-process training."""

    def __init__(
        self,
        task_name: str = "single_deal",
        seed: Optional[int] = None,
        personality_override: Optional[str] = None,
    ):
        if task_name not in TASKS:
            raise ValueError(
                f"Unknown task: {task_name}. Available: {list(TASKS.keys())}"
            )
        self.task_name = task_name
        self.seed = seed
        self._base_task = copy.deepcopy(TASKS[task_name])
        if personality_override:
            self._base_task.seller_personality = SellerPersonalityType(
                personality_override
            )
        self._env: Optional[BazaarEnvironment] = None
        self.done: bool = True

    def reset(self) -> tuple[dict[str, Any], dict[str, Any]]:
        self._env = BazaarEnvironment(copy.deepcopy(self._base_task), seed=self.seed)
        obs = self._env.reset()
        self.done = False
        return _obs_to_dict(obs), {}

    def step(
        self, action: dict[str, Any]
    ) -> tuple[dict[str, Any], float, bool, dict[str, Any]]:
        if self._env is None:
            raise RuntimeError("Call reset() before step().")
        act = BazaarAction(
            action=ActionType(action.get("action", "offer")),
            price=action.get("price"),
        )
        obs, reward_obj = self._env.step(act)
        # Episode-level done.  For career tasks, we signal done at episode end
        # so the outer loop can compute per-episode rewards; the caller resets.
        self.done = obs.done
        info = {
            "components": reward_obj.components,
            "episode": self._env.current_episode,
            "all_episodes_done": self._env.all_episodes_done,
        }
        return _obs_to_dict(obs), float(reward_obj.reward), self.done, info

    def score(self) -> float:
        """Final graded score across all completed episodes."""
        if self._env is None:
            return 0.0
        grader = GRADERS.get(self._env.task.name)
        if grader is None:
            return 0.0
        return float(grader(self._env.episode_results, self._env.task))

    @property
    def env(self) -> BazaarEnvironment:
        if self._env is None:
            raise RuntimeError("Environment not initialized; call reset().")
        return self._env


PolicyFn = Callable[[str], str]
"""A policy takes a user-turn prompt and returns raw text (LLM completion)."""


def rollout_episode(
    policy_fn: PolicyFn,
    task_name: str = "single_deal",
    seed: Optional[int] = None,
    personality_override: Optional[str] = None,
    max_env_steps: int = 200,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> dict[str, Any]:
    """Run one full rollout with an LLM policy; return trajectory + score.

    Returns a dict with keys:
        steps: list of {prompt, completion, action, reward, done} per turn
        total_reward: sum of per-step rewards
        score: grader-assigned terminal score (this is the GRPO reward signal)
        num_steps, success
    """
    env = BazaarGymEnv(
        task_name=task_name, seed=seed, personality_override=personality_override
    )
    obs, _ = env.reset()
    history: list[str] = []
    steps: list[dict[str, Any]] = []
    total_reward = 0.0

    for _ in range(max_env_steps):
        prompt = format_observation(obs, history=history)
        completion = policy_fn(prompt)
        action = parse_action(completion, fallback_price=obs.get("own_private_budget", 100) * 0.3)

        obs, reward, done, info = env.step(action)
        total_reward += reward

        history.append(
            f"Round {obs.get('current_round', '?')}: You "
            f"{'offered ' + str(action.get('price')) if action.get('action') == 'offer' else action.get('action')}"
            f" -> Seller: {obs.get('message', '')}"
        )

        steps.append({
            "prompt": prompt,
            "completion": completion,
            "action": action,
            "reward": reward,
            "done": done,
            "parse_error": bool(action.get("_parse_error")),
        })

        if done:
            if info.get("all_episodes_done"):
                break
            # Career mode: inner env auto-resets via the wrapper's outer loop.
            # We let the test harness (or trainer) handle multi-episode by
            # calling rollout_episode once per episode if desired.
            break

    return {
        "steps": steps,
        "total_reward": total_reward,
        "score": env.score(),
        "num_steps": len(steps),
        "task": task_name,
    }
