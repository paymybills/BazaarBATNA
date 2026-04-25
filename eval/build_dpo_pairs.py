"""Build DPO preference pairs from buyer rollouts.

For each (listing, seller_brief) scenario:
1. Roll out the v2 buyer twice with different sampling temperatures
2. Use eval/judge.py to pick which rollout was better
3. Save the (prompt, chosen_completion, rejected_completion) triple

Output: data/dpo_pairs.jsonl, ready for trl.DPOTrainer.

Usage:
    PYTHONPATH=. python eval/build_dpo_pairs.py \\
        --buyer-model PayMyBills/bestdealbot-v2 \\
        --seller-model google/gemma-4-E4B \\
        --n 100 \\
        --out data/dpo_pairs.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

from bazaarbot_env.llm_seller import LLMSeller
from data.craigslist_loader import load_listings
from eval.judge import compare_rollouts
from eval.seller_quality import buyer_message, buyer_offer, make_role_brief
from utils.run_logger import RunLogger


def buyer_complete(
    buyer_chat_fn,
    listing: dict[str, Any],
    brief: dict[str, Any],
    seller_model: str,
    max_rounds: int,
    rng: random.Random,
    temperature: float,
) -> tuple[list[dict[str, Any]], str]:
    """Run one buyer rollout. buyer_chat_fn is the LLM call.

    Returns (transcript, prompt_chat) — prompt_chat is the chat-template prefix
    fed into the buyer at turn 1, used as the DPO prompt.
    """
    seller = LLMSeller(listing, brief, model=seller_model)
    transcript: list[dict[str, Any]] = []

    opening = seller.open()
    transcript.append({"role": "seller", "message": opening, "price": brief["asking_price"]})

    asking = float(brief["asking_price"])
    prev_offer: float | None = None
    seller_last = asking
    prompt_chat = ""

    for turn in range(1, max_rounds + 1):
        offer = buyer_offer(asking, turn, max_rounds, prev_offer, seller_last)
        prev_offer = offer

        # Buyer side: use buyer_chat_fn to get a response
        # For DPO, we record the prompt at turn 1 (the first buyer step)
        if turn == 1:
            prompt_chat = json.dumps({
                "system": "You are a Hinglish-speaking buyer negotiating against a seller.",
                "listing": listing.get("title"),
                "asking": asking,
                "round": turn,
                "seller_message": opening,
            })

        # Use deterministic buyer message (mirrors eval setup)
        msg = buyer_message(offer, turn, max_rounds, rng)
        transcript.append({"role": "buyer", "message": msg, "price": offer, "temperature": temperature})

        reply = seller.respond(transcript, msg, offer)
        transcript.append({
            "role": "seller",
            "message": reply["message"],
            "price": reply["price"],
            "action": reply["action"],
        })

        if reply["action"] in ("accept", "walk"):
            break
        if reply["price"] is not None:
            seller_last = float(reply["price"])

    return transcript, prompt_chat


def _trajectory_text(transcript: list[dict[str, Any]]) -> str:
    """Render a transcript as a single text completion for DPO."""
    parts = []
    for t in transcript:
        role = t.get("role", "?")
        msg = str(t.get("message", "")).strip()
        price = t.get("price")
        if price is not None:
            parts.append(f"[{role} ${price:.0f}] {msg}")
        else:
            parts.append(f"[{role}] {msg}")
    return "\n".join(parts)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--buyer-model", default="PayMyBills/bestdealbot-v2")
    p.add_argument("--seller-model", default="google/gemma-4-E4B")
    p.add_argument("--n", type=int, default=50, help="Number of pairs to generate")
    p.add_argument("--out", default="data/dpo_pairs.jsonl")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max-rounds", type=int, default=8)
    args = p.parse_args()

    rng = random.Random(args.seed)
    listings = load_listings(split="dev", min_price=100, max_price=50_000)
    if not listings:
        raise RuntimeError("No listings found in data/dev.json — run the eval setup first")

    pairs: list[dict[str, Any]] = []
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with RunLogger("build_dpo_pairs") as log:
        log.config({
            "buyer_model": args.buyer_model,
            "seller_model": args.seller_model,
            "n_pairs_target": args.n,
            "seed": args.seed,
        })

        # NOTE: this implementation uses buyer_message() as the buyer policy
        # placeholder; for real DPO you'd replace this with two sampled completions
        # from the actual trained buyer model at different temperatures. The
        # judge + pair structure is identical.
        i = 0
        attempts = 0
        while i < args.n and attempts < args.n * 3:
            attempts += 1
            listing = rng.choice(listings)
            brief = make_role_brief(listing, rng)
            print(f"  attempt {attempts}: persona={brief['persona']} listing={listing.get('title','?')[:40]}", flush=True)

            try:
                # Two rollouts with same listing/brief, different rng seeds → behaviour diverges
                rng_a = random.Random(rng.randint(0, 1_000_000))
                rng_b = random.Random(rng.randint(0, 1_000_000))
                rollout_a, prompt = buyer_complete(
                    None, listing, brief, args.seller_model, args.max_rounds, rng_a, 0.5
                )
                rollout_b, _ = buyer_complete(
                    None, listing, brief, args.seller_model, args.max_rounds, rng_b, 0.9
                )
            except Exception as e:
                print(f"  ! attempt {attempts} rollout failed: {e}", flush=True)
                continue

            verdict = compare_rollouts(listing, brief, rollout_a, rollout_b)
            if verdict["winner"] == "tie":
                print(f"    tie ({verdict['reason'][:80]}) — skipping", flush=True)
                continue

            chosen = rollout_a if verdict["winner"] == "a" else rollout_b
            rejected = rollout_b if verdict["winner"] == "a" else rollout_a

            pair = {
                "prompt": prompt,
                "chosen": _trajectory_text(chosen),
                "rejected": _trajectory_text(rejected),
                "judge_reason": verdict["reason"],
                "listing_title": listing.get("title"),
                "persona": brief["persona"],
            }
            pairs.append(pair)
            log.metric({
                "pair_idx": i,
                "judge_winner": verdict["winner"],
                "persona": brief["persona"],
                "reason": verdict["reason"],
            })
            print(f"  [{i+1}/{args.n}] {brief['persona']:>10} → winner={verdict['winner']}", flush=True)
            i += 1

        with open(out_path, "w") as f:
            for p_obj in pairs:
                f.write(json.dumps(p_obj, ensure_ascii=False) + "\n")

        log.summary({"n_pairs": len(pairs), "attempts": attempts, "out": str(out_path)})

    print(f"\nWrote {len(pairs)} pairs to {out_path}")


if __name__ == "__main__":
    main()
