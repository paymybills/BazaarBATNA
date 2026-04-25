"""Symmetric scoring for negotiation episodes.

Reads existing eval/out/results_*.jsonl files and computes:
  - buyer_share, seller_share (split of bargaining zone)
  - outcome classification (buyer win / seller win / tie / mutual loss / rational walk)
  - aggregates per policy + per task
  - bootstrap 95% CIs

Logs to runs/{ts}_scoring/.

Usage:
    PYTHONPATH=. .venv/bin/python eval/scoring.py
"""

import json
import pathlib
import random
from collections import defaultdict

from utils.run_logger import RunLogger

OUT_DIR = pathlib.Path("eval/out")


def shares(ep: dict) -> tuple[float | None, float | None]:
    """Compute (buyer_share, seller_share). None if no deal."""
    if ep["deal_outcome"] != "deal" or ep["agreed_price"] is None:
        return None, None
    zopa = ep["buyer_budget"] - ep["seller_cost"]
    if zopa <= 0:
        return None, None
    buyer_share = (ep["buyer_budget"] - ep["agreed_price"]) / zopa
    seller_share = (ep["agreed_price"] - ep["seller_cost"]) / zopa
    return buyer_share, seller_share


def classify(ep: dict) -> str:
    """Return one of: buyer_win, seller_win, tie, mutual_loss, rational_walk."""
    bs, ss = shares(ep)
    if bs is None:
        zopa = ep["buyer_budget"] - ep["seller_cost"]
        return "rational_walk" if zopa <= 0 else "mutual_loss"
    if bs > 0.6:
        return "buyer_win"
    if ss > 0.6:
        return "seller_win"
    return "tie"


def bootstrap_ci(values: list[float], n_iter: int = 1000, seed: int = 42) -> tuple[float, float]:
    """Bootstrap 95% CI on the mean."""
    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    means = []
    n = len(values)
    for _ in range(n_iter):
        sample = [values[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    return (means[int(0.025 * n_iter)], means[int(0.975 * n_iter)])


def aggregate(episodes: list[dict]) -> dict:
    """Per-policy report card."""
    classified = [(ep, classify(ep)) for ep in episodes]
    buyer_shares = [shares(ep)[0] for ep in episodes if shares(ep)[0] is not None]
    rounds = [ep["rounds_taken"] for ep in episodes]

    counts = defaultdict(int)
    for _, label in classified:
        counts[label] += 1
    n = len(episodes)

    mean_share = sum(buyer_shares) / len(buyer_shares) if buyer_shares else 0.0
    ci_lo, ci_hi = bootstrap_ci(buyer_shares) if buyer_shares else (0.0, 0.0)

    return {
        "n": n,
        "mean_buyer_share": round(mean_share, 4),
        "buyer_share_ci95": [round(ci_lo, 4), round(ci_hi, 4)],
        "win_rate": round(counts["buyer_win"] / n, 4),
        "loss_rate": round(counts["seller_win"] / n, 4),
        "tie_rate": round(counts["tie"] / n, 4),
        "mutual_loss_rate": round(counts["mutual_loss"] / n, 4),
        "rational_walk_rate": round(counts["rational_walk"] / n, 4),
        "mean_rounds": round(sum(rounds) / n, 2),
    }


def main():
    files = sorted(OUT_DIR.glob("results_*.jsonl"))
    print(f"Found {len(files)} result files")

    with RunLogger("scoring") as log:
        log.config({
            "input_files": [str(f) for f in files],
            "metric": "symmetric_buyer_share",
        })

        all_summaries = {}
        for fpath in files:
            policy = fpath.stem.replace("results_", "")
            episodes = [json.loads(l) for l in open(fpath)]
            print(f"\n=== {policy}  ({len(episodes)} episodes) ===")

            # Aggregate by task
            by_task = defaultdict(list)
            for ep in episodes:
                by_task[ep["task"]].append(ep)

            policy_summary = {"overall": aggregate(episodes)}
            for task, eps in by_task.items():
                policy_summary[task] = aggregate(eps)

            for task, summary in policy_summary.items():
                print(f"  {task}: share={summary['mean_buyer_share']} "
                      f"win={summary['win_rate']} mutual_loss={summary['mutual_loss_rate']}")

            all_summaries[policy] = policy_summary

            # Per-episode log
            for ep in episodes:
                bs, ss = shares(ep)
                log.metric({
                    "policy": policy,
                    "task": ep["task"],
                    "seed": ep["seed"],
                    "outcome": classify(ep),
                    "buyer_share": bs,
                    "seller_share": ss,
                    "rounds": ep["rounds_taken"],
                })

        log.summary(all_summaries)

        # Print headline table
        print("\n=== HEADLINE TABLE ===")
        print(f"{'Policy':<32} {'buyer_share':>14} {'win_rate':>10} {'mutual_loss':>14} {'rounds':>8}")
        for policy, s in all_summaries.items():
            o = s["overall"]
            print(f"{policy:<32} {o['mean_buyer_share']:>14.3f} {o['win_rate']:>10.0%} "
                  f"{o['mutual_loss_rate']:>14.0%} {o['mean_rounds']:>8.1f}")
        print(f"\nFull logs: {log.dir}")


if __name__ == "__main__":
    main()
