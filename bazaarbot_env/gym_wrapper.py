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


def strip_think_tags(chat_text: str) -> str:
    """NO-OP: kept for API compatibility.

    We initially stripped Qwen3.5's auto-injected <think>...</think>
    blocks from prompts and SFT targets, intending to teach the model
    to skip reasoning and go straight to JSON.  In practice the first
    SFT run happened before the strip was wired in, so the trained
    LoRA actually expects to see <think>\\n\\n</think>\\n\\n preceding
    its JSON output.

    Rather than redo SFT, we leave the chat template untouched and let
    parse_action() discard the leading think block at parse time.
    """
    return chat_text


def parse_action(text: str, fallback_price: float = 30.0) -> dict[str, Any]:
    """Best-effort JSON parser for LLM action output.

    Robust to the common failure modes: markdown fences, leading prose,
    trailing commentary, reasoning-mode <think>...</think> blocks.  Falls
    back to a conservative offer if unparseable so training never crashes
    on a bad generation.
    """
    import re
    s = text.strip()
    # Drop any <think>...</think> blocks before looking for JSON
    s = re.sub(r"<think>.*?</think>", "", s, flags=re.DOTALL).strip()
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


def steer_bayesian_action(
    obs: dict[str, Any] | BazaarObservation,
    proposed_action: dict[str, Any],
) -> dict[str, Any]:
    """Apply Bayesian-persuasion-inspired steering + adaptive fallback.

    The model has incomplete information, so we maintain a compact posterior over
    seller urgency/flexibility from tells and concession behavior, then gate the
    raw model action with:
    - a Nash-style target offer (under estimated seller cost),
    - an adaptive close threshold near deadline (to reduce unnecessary walks),
    - anti-premature-walk logic that prefers one more calibrated counter.
    """
    if isinstance(obs, BazaarObservation):
        obs = _obs_to_dict(obs)

    action = {
        "action": str(proposed_action.get("action", "offer")),
        "price": proposed_action.get("price"),
    }

    ask = float(obs.get("opponent_last_offer") or obs.get("seller_asking_price") or 0.0)
    budget = float(obs.get("own_private_budget") or 0.0)
    if ask <= 0 or budget <= 0:
        if action["action"] == "offer" and action.get("price") is None:
            action["price"] = round(max(1.0, fallback := budget * 0.3 if budget > 0 else 30.0), 2)
        return action

    rounds_remaining = int(obs.get("rounds_remaining") or 0)
    max_rounds = max(1, int(obs.get("max_rounds") or rounds_remaining or 1))
    current_round = int(obs.get("current_round") or (max_rounds - rounds_remaining))
    late_pressure = max(0.0, min(1.0, current_round / max_rounds))

    personality = str(obs.get("seller_personality") or "default")
    prior_urgency = {
        "default": 0.50,
        "deceptive": 0.45,
        "impatient": 0.68,
        "collaborative": 0.40,
    }.get(personality, 0.50)
    prior_flex = {
        "default": 0.50,
        "deceptive": 0.30,
        "impatient": 0.65,
        "collaborative": 0.72,
    }.get(personality, 0.50)

    tells = obs.get("tells") or {}
    verbal_urgency = float(tells.get("verbal_urgency") or 0.0)
    fidget = float(tells.get("fidget_level") or 0.0)
    emotional = float(tells.get("emotional_escalation") or 0.0)
    deception = float(tells.get("verbal_deception_cue") or 0.0)
    confidence = float(tells.get("verbal_confidence") or 0.5)
    speed = str(tells.get("offer_speed") or "normal")
    concession_pattern = str(tells.get("concession_pattern") or "steady")

    speed_urgency = {"instant": 0.15, "normal": 0.05, "deliberate": -0.05}.get(speed, 0.0)
    pattern_urgency = {
        "front_loaded": 0.15,
        "erratic": 0.08,
        "stalling": -0.10,
        "steady": 0.00,
    }.get(concession_pattern, 0.0)
    signal_urgency = max(
        0.0,
        min(
            1.0,
            0.35 * verbal_urgency
            + 0.25 * fidget
            + 0.20 * emotional
            + 0.10 * deception
            + 0.10 * (1.0 - confidence)
            + speed_urgency
            + pattern_urgency,
        ),
    )

    seller_delta = float(obs.get("seller_last_move_delta") or 0.0)
    concession_ratio = max(0.0, min(1.0, seller_delta / max(ask, 1.0)))
    pattern_flex = {
        "front_loaded": 0.22,
        "steady": 0.08,
        "erratic": 0.03,
        "stalling": -0.18,
    }.get(concession_pattern, 0.0)
    signal_flex = max(
        0.0,
        min(
            1.0,
            0.45 * concession_ratio
            + 0.20 * (1.0 - confidence)
            + 0.20 * verbal_urgency
            + 0.15 * (1.0 - deception)
            + pattern_flex,
        ),
    )

    posterior_urgency = max(0.0, min(1.0, 0.55 * prior_urgency + 0.45 * signal_urgency))
    posterior_flex = max(0.0, min(1.0, 0.55 * prior_flex + 0.45 * signal_flex))

    estimated_cost = ask * (0.58 - 0.18 * posterior_urgency + 0.08 * (1.0 - posterior_flex))
    estimated_cost = max(1.0, min(estimated_cost, ask * 0.90))

    # Nash bargaining point under estimated seller cost and inferred buyer power.
    buyer_power = 0.35 + 0.40 * posterior_urgency + 0.20 * posterior_flex - 0.30 * late_pressure
    buyer_power = max(0.20, min(0.85, buyer_power))
    nash_target = (1.0 - buyer_power) * budget + buyer_power * estimated_cost
    nash_target = max(1.0, min(nash_target, min(budget * 0.95, ask * 1.02)))

    # Adaptive fallback: grow acceptance threshold late so we close more often.
    close_slack = 0.28 + 0.45 * late_pressure + 0.12 * (1.0 - posterior_urgency)
    accept_threshold = nash_target + (budget - nash_target) * close_slack
    accept_threshold = min(accept_threshold, budget * 0.95)

    floor_offer = max(1.0, min(nash_target * 0.85, ask * 0.65, budget * 0.85))
    ceiling_offer = min(accept_threshold, ask * (0.90 + 0.08 * late_pressure))
    if rounds_remaining <= 2:
        floor_offer = max(floor_offer, ask * 0.87)
        ceiling_offer = max(ceiling_offer, floor_offer)
    if ceiling_offer < floor_offer:
        floor_offer = ceiling_offer

    own_last_offer = obs.get("own_last_offer")
    own_last_offer = float(own_last_offer) if own_last_offer is not None else None

    if action["action"] == "accept":
        if ask > accept_threshold and rounds_remaining > 1:
            action["action"] = "offer"
            action["price"] = round(max(floor_offer, min(ceiling_offer, nash_target)), 2)
        else:
            action["price"] = None
        return action

    if action["action"] == "walk":
        if rounds_remaining <= 1 and ask > budget * 0.98:
            action["price"] = None
            return action
        # Anti-premature walk: take one calibrated close attempt first.
        if ask <= accept_threshold and rounds_remaining <= 2:
            action["action"] = "accept"
            action["price"] = None
            return action
        action["action"] = "offer"
        probe_start = own_last_offer if own_last_offer is not None else floor_offer
        probe_price = max(floor_offer, min(ceiling_offer, probe_start + max(1.0, ask * 0.06)))
        action["price"] = round(probe_price, 2)
        return action

    # Offer path: clip to Bayesian/Nash band and auto-close late if ask is acceptable.
    if rounds_remaining <= 1 and ask <= accept_threshold:
        return {"action": "accept", "price": None}

    proposed_price = action.get("price")
    if proposed_price is None:
        proposed_price = (floor_offer + ceiling_offer) / 2
    proposed_price = float(proposed_price)
    steered_price = max(floor_offer, min(ceiling_offer, proposed_price))
    action["price"] = round(steered_price, 2)
    action["action"] = "offer"
    return action


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
