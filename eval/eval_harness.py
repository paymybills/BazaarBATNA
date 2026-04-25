"""BazaarBot eval harness.

Runs N episodes of a policy against each task/seller configuration and reports
mean surplus, deal rate, and task-level scores.  Supports multiple policies so
you can compare baselines (rule-based, prompted-base-LLM) to the trained agent.

Usage:
    python eval/eval_harness.py --policy ollama --model bestdealbot --n 50
    python eval/eval_harness.py --policy baseline --baseline_model llama3.2:3b --n 50
    python eval/eval_harness.py --policy rule_based --n 50

Output:
    eval_results.jsonl   — one row per episode
    eval_summary.json    — aggregates by policy × task
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from bazaarbot_env import (
    BazaarGymEnv,
    DEFAULT_SYSTEM_PROMPT,
    TASKS,
    format_observation,
    parse_action,
    steer_bayesian_action,
)


# ── Policies ────────────────────────────────────────────────────────

Policy = Callable[[dict], dict]
"""A policy takes an observation dict, returns an action dict."""


def rule_based_policy(obs: dict) -> dict:
    """Heuristic baseline: match SFT target distribution."""
    from nlp.templates import render
    ask    = obs.get("seller_asking_price") or obs.get("opponent_last_offer") or 100
    budget = obs.get("own_private_budget") or 100
    rnd    = obs.get("current_round") or 0
    max_r  = obs.get("max_rounds") or 8
    last   = obs.get("own_last_offer")

    if ask <= budget * 0.5:
        return {"action": "accept", "price": None,
                "message": render("accept", None, turn_index=rnd, max_turns=max_r)}
    if ask > budget:
        return {"action": "walk", "price": None,
                "message": render("walk", None, turn_index=rnd, max_turns=max_r)}
    if rnd == 0 or last is None:
        price = ask * random.uniform(0.25, 0.40)
    else:
        price = last + (ask - last) * random.uniform(0.2, 0.35)
    price = max(1.0, min(price, budget * 0.8))
    price = round(price, 2)
    return {"action": "offer", "price": price,
            "message": render("offer", price, ask=ask, turn_index=rnd, max_turns=max_r)}


def make_ollama_policy(
    model_name: str,
    host: str = "http://localhost:11434",
    use_bayesian_steering: bool = True,
) -> Policy:
    """Chat-completion policy hitting an Ollama-served model.

    Robust to the common LLM failure modes: non-JSON output, wrapped in
    reasoning tags, preceded by prose.  Falls back to a conservative offer
    if unparseable (same fallback parse_action uses).
    """
    import requests

    def policy(obs: dict) -> dict:
        user_turn = format_observation(obs)
        resp = requests.post(
            f"{host}/api/chat",
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_turn},
                ],
                "stream": False,
                "options": {"temperature": 0.7, "top_p": 0.9, "num_predict": 64},
            },
            timeout=120,
        )
        resp.raise_for_status()
        text = resp.json().get("message", {}).get("content", "")
        action = parse_action(
            text, fallback_price=obs.get("own_private_budget", 100) * 0.3
        )
        # Clean up the sentinel from parse_action before returning to env
        action.pop("_parse_error", None)
        if use_bayesian_steering:
            action = steer_bayesian_action(obs, action)
        return action

    return policy


# ── Episode runner ─────────────────────────────────────────────────

@dataclass
class EpisodeResult:
    task: str
    seed: int
    policy: str
    seller_personality: str
    deal_outcome: str            # "deal" | "walk" | "expired"
    agreed_price: Optional[float]
    buyer_budget: float
    seller_cost: float
    seller_anchor: float
    rounds_taken: int
    normalized_surplus: float    # 0–1 score
    task_score: float            # grader's output
    parse_errors: int
    transcript: list[dict] = field(default_factory=list)


def run_episode(
    policy: Policy,
    policy_name: str,
    task_name: str,
    seed: int,
    max_turns: int = 15,
    enable_nlp: bool = False,
) -> EpisodeResult:
    env = BazaarGymEnv(task_name=task_name, seed=seed)
    # Toggle the NLP extractor for the ablation: default off matches v1 eval,
    # on routes seller messages through ministral for verbal-tell extraction.
    if enable_nlp:
        try:
            env.env.task.enable_nlp = True  # type: ignore[attr-defined]
        except Exception:
            pass
    obs, _ = env.reset()

    transcript: list[dict] = [{"round": 0, "actor": "seller", "message": obs.get("message", "")}]
    parse_errors = 0

    for turn in range(max_turns):
        if env.done:
            break
        action = policy(obs)
        # detect fallback parses
        if action.get("price") == round(obs.get("own_private_budget", 100) * 0.3, 2):
            parse_errors += 0  # ambiguous; we don't flag here
        transcript.append({
            "round": obs.get("current_round", turn) + 1,
            "actor": "buyer",
            "action": action.get("action"),
            "price": action.get("price"),
            "message": action.get("message", ""),
        })
        obs, reward, done, info = env.step(action)
        transcript.append({
            "round": obs.get("current_round", turn + 1),
            "actor": "seller",
            "message": obs.get("message", ""),
        })
        if done:
            break

    # Pull the final DealRecord for this episode
    env_inner = env.env
    results = env_inner.episode_results
    record = results[-1] if results else None
    task_score = env.score()

    return EpisodeResult(
        task=task_name,
        seed=seed,
        policy=policy_name,
        seller_personality=str(env_inner.task.seller_personality.value),
        deal_outcome=str(record.outcome.value) if record else "unknown",
        agreed_price=record.agreed_price if record else None,
        buyer_budget=env_inner.buyer_budget,
        seller_cost=env_inner.seller.cost if env_inner.seller else 0.0,
        seller_anchor=env_inner.seller.anchor if env_inner.seller else 0.0,
        rounds_taken=record.rounds_taken if record else 0,
        normalized_surplus=record.normalized_surplus if record else 0.0,
        task_score=float(task_score),
        parse_errors=parse_errors,
        transcript=transcript,
    )


# ── Main ────────────────────────────────────────────────────────────

def resolve_policy(args: argparse.Namespace) -> tuple[str, Policy]:
    kind = args.policy
    if kind == "rule_based":
        return "rule_based", rule_based_policy
    if kind == "ollama":
        name = args.model or "bestdealbot"
        return f"ollama:{name}", make_ollama_policy(name, use_bayesian_steering=True)
    if kind == "baseline":
        name = args.baseline_model or "llama3.2:3b"
        return f"baseline:{name}", make_ollama_policy(name, use_bayesian_steering=False)
    raise ValueError(f"unknown policy: {kind}")


def summarize(rows: list[EpisodeResult]) -> dict[str, Any]:
    by_task_policy: dict[tuple[str, str], list[EpisodeResult]] = {}
    for r in rows:
        by_task_policy.setdefault((r.task, r.policy), []).append(r)

    out: dict[str, Any] = {}
    for (task, policy), group in by_task_policy.items():
        surplus = [r.normalized_surplus for r in group]
        scores  = [r.task_score for r in group]
        deals   = [1 if r.deal_outcome == "deal" else 0 for r in group]
        rounds  = [r.rounds_taken for r in group if r.rounds_taken > 0]

        key = f"{policy}/{task}"
        out[key] = {
            "n": len(group),
            "mean_normalized_surplus": round(statistics.fmean(surplus), 4),
            "mean_task_score":         round(statistics.fmean(scores), 4),
            "deal_rate":               round(statistics.fmean(deals), 4),
            "mean_rounds":             round(statistics.fmean(rounds), 2) if rounds else 0,
            "mean_surplus_on_deal":    round(
                statistics.fmean([s for s, d in zip(surplus, deals) if d]), 4
            ) if any(deals) else 0.0,
        }
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--policy", choices=["rule_based", "ollama", "baseline"], required=True)
    p.add_argument("--model", help="ollama model name (for --policy ollama)")
    p.add_argument("--baseline_model", help="ollama model name (for --policy baseline)")
    p.add_argument("--n", type=int, default=50, help="episodes per task")
    p.add_argument("--tasks", nargs="+",
                   default=["single_deal", "asymmetric_pressure", "amazon_realistic"])
    p.add_argument("--seed_base", type=int, default=1000)
    p.add_argument("--out_dir", default="eval/out")
    p.add_argument("--enable_nlp", type=int, default=0,
                   help="1 = route seller messages through ministral NLP extractor; 0 = rule-based tells (default, matches v1 eval)")
    p.add_argument("--tag", default="",
                   help="Suffix appended to the output filename, e.g. 'tells_on'")
    args = p.parse_args()

    name, policy = resolve_policy(args)
    enable_nlp = bool(args.enable_nlp)
    print(f"Running eval: policy={name}, tasks={args.tasks}, n={args.n}, enable_nlp={enable_nlp}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_name = name.replace(':', '_').replace('/', '_')
    if args.tag:
        safe_name = f"{safe_name}_{args.tag}"
    jsonl_path = out_dir / f"results_{safe_name}.jsonl"

    rows: list[EpisodeResult] = []
    t0 = time.time()
    with open(jsonl_path, "w") as f:
        for task in args.tasks:
            if task not in TASKS:
                print(f"  skip unknown task: {task}")
                continue
            print(f"  task={task}  ", end="", flush=True)
            for i in range(args.n):
                seed = args.seed_base + i
                r = run_episode(policy, name, task, seed, enable_nlp=enable_nlp)
                rows.append(r)
                f.write(json.dumps(r.__dict__, default=str) + "\n")
                if (i + 1) % 10 == 0:
                    print(f"{i+1}", end=" ", flush=True)
            print()

    elapsed = time.time() - t0
    summary = summarize(rows)
    summary["_meta"] = {
        "policy": name,
        "n_per_task": args.n,
        "tasks": args.tasks,
        "elapsed_s": round(elapsed, 1),
        "enable_nlp": enable_nlp,
        "tag": args.tag or None,
    }

    summary_path = out_dir / f"summary_{safe_name}.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    print()
    print(f"Wrote {len(rows)} episode results to {jsonl_path}")
    print(f"Summary: {summary_path}")
    print()
    for key, stats in summary.items():
        if key == "_meta":
            continue
        print(f"  {key}")
        print(f"    surplus={stats['mean_normalized_surplus']:.3f}  "
              f"score={stats['mean_task_score']:.3f}  "
              f"deal={stats['deal_rate']:.2f}  "
              f"rounds={stats['mean_rounds']}")


if __name__ == "__main__":
    main()
