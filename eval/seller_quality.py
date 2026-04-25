"""Seller-quality evaluation for LLMSeller.

Runs N episodes of (rule-based buyer × LLMSeller) and reports acceptance criteria
per docs/SELLER_HANDOFF.md:

    1. anchored_listing_rate ≥ 0.90
    2. never_below_reservation == 0 violations
    3. never_leak_reservation == 0 violations
    4. mean_rounds ≥ 4
    5. zero_round_capitulation_rate ≤ 0.10
    6. persona_consistency ≥ 0.70 (LLM judge)

Logs to runs/{ts}_seller_quality/ via utils.run_logger.RunLogger.

Usage:
    PYTHONPATH=. python eval/seller_quality.py --model google/gemma-3-4b-it --n 50
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
from typing import Any

from bazaarbot_env.llm_seller import LLMSeller, generate_structured_reply
from data.craigslist_loader import load_listings
from utils.run_logger import RunLogger

PERSONAS = ("default", "firm", "flexible", "deceptive")


def _title_tokens(title: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", title.lower()) if len(t) >= 4][:8]


def mentions_listing(listing: dict[str, Any], seller_messages: list[str]) -> bool:
    """Any title-token or category appears in any seller message → anchored."""
    text = " ".join(seller_messages).lower()
    if any(tok in text for tok in _title_tokens(str(listing.get("title", "")))):
        return True
    cat = str(listing.get("category", "")).lower().strip()
    return bool(cat and cat in text)


def leaks_reservation(messages: list[str], reservation: float) -> bool:
    text = " ".join(messages).lower()
    for token in {f"{reservation:.2f}", f"{reservation:.1f}", f"{reservation:.0f}"}:
        if re.search(rf"\b{re.escape(token)}\b", text):
            return True
    # Common explicit-leak patterns
    if re.search(r"(minimum|min|bottom\s*line|at\s*least)\b[^.\n]{0,40}\d", text):
        return True
    return False


def make_role_brief(listing: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    asking = float(listing["price"])
    reservation = max(1.0, min(asking * 0.97, asking * rng.uniform(0.74, 0.82)))
    return {
        "asking_price": round(asking, 2),
        "reservation_price": round(reservation, 2),
        "bonus_structure": "$1 per $100 above reservation",
        "persona": rng.choice(PERSONAS),
        "context": "Need to close soon but still care about value.",
    }


def buyer_offer(
    asking: float,
    round_idx: int,
    max_rounds: int,
    prev_offer: float | None,
    seller_last_price: float,
) -> float:
    """Deterministic buyer policy: open at 55% of ask, walk toward seller's last counter."""
    if round_idx == 1 or prev_offer is None:
        return round(max(1.0, asking * 0.55), 2)
    progress = round_idx / max_rounds
    step = 0.16 + 0.28 * progress
    target = min(asking * 0.92, seller_last_price * (0.92 + 0.04 * progress))
    offer = prev_offer + (target - prev_offer) * step
    return round(max(prev_offer + 1.0, offer), 2)


def judge_persona(
    model: str,
    expected: str,
    transcript: list[dict[str, Any]],
) -> tuple[str, bool]:
    """LLM-as-judge: classify persona from transcript."""
    condensed = []
    for turn in transcript[-12:]:
        role = turn.get("role", "seller")
        msg = str(turn.get("message", ""))
        condensed.append(f"{role}: {msg}")
    text = "\n".join(condensed)
    parsed = generate_structured_reply(
        model,
        system='Classify the seller persona from a negotiation transcript. Output JSON only: {"persona": "default|firm|flexible|deceptive"}.',
        user=f"Transcript:\n{text}",
        max_new_tokens=40,
        temperature=0.0,
    )
    predicted = str((parsed or {}).get("persona", "default")).lower().strip()
    if predicted not in PERSONAS:
        predicted = "default"
    return predicted, predicted == expected


def run_episode(
    model: str,
    listing: dict[str, Any],
    brief: dict[str, Any],
    max_rounds: int,
) -> dict[str, Any]:
    seller = LLMSeller(listing, brief, model=model)
    transcript: list[dict[str, Any]] = []

    opening = seller.open()
    transcript.append({"role": "seller", "message": opening, "price": brief["asking_price"]})

    asking = float(brief["asking_price"])
    reservation = float(brief["reservation_price"])
    seller_last = asking
    prev_offer: float | None = None
    agreed_price: float | None = None
    outcome = "expired"
    zero_round_capitulation = False

    for turn_i in range(1, max_rounds + 1):
        offer = buyer_offer(asking, turn_i, max_rounds, prev_offer, seller_last)
        prev_offer = offer
        buyer_msg = f"I can do {offer:.0f}."
        transcript.append({"role": "buyer", "message": buyer_msg, "price": offer})

        reply = seller.respond(transcript, buyer_msg, offer)
        transcript.append({
            "role": "seller",
            "message": reply["message"],
            "price": reply["price"],
            "action": reply["action"],
        })

        if turn_i == 1 and reply["action"] == "accept":
            zero_round_capitulation = True

        if reply["action"] == "accept":
            agreed_price = float(reply["price"] if reply["price"] is not None else offer)
            outcome = "deal"
            break
        if reply["action"] == "walk":
            outcome = "walk"
            break

        if reply["price"] is not None:
            seller_last = float(reply["price"])

    seller_msgs = [t["message"] for t in transcript if t.get("role") == "seller"]
    anchored = mentions_listing(listing, seller_msgs)
    leaked = leaks_reservation(seller_msgs, reservation)
    below_reservation = (
        outcome == "deal" and agreed_price is not None and agreed_price < reservation
    )
    judged, persona_ok = judge_persona(model, brief["persona"], transcript)

    return {
        "listing_title": listing.get("title"),
        "asking_price": asking,
        "reservation_price": reservation,
        "persona": brief["persona"],
        "judged_persona": judged,
        "persona_ok": persona_ok,
        "outcome": outcome,
        "agreed_price": agreed_price,
        "rounds": sum(1 for t in transcript if t.get("role") == "seller") - 1,
        "anchored_listing": anchored,
        "leaked_reservation": leaked,
        "below_reservation": below_reservation,
        "zero_round_capitulation": zero_round_capitulation,
        "transcript": transcript,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(rows)
    anchored = sum(1 for r in rows if r["anchored_listing"])
    below = sum(1 for r in rows if r["below_reservation"])
    leaked = sum(1 for r in rows if r["leaked_reservation"])
    zero_caps = sum(1 for r in rows if r["zero_round_capitulation"])
    persona_ok = sum(1 for r in rows if r["persona_ok"])
    rounds = [r["rounds"] for r in rows]

    anchored_rate = anchored / n if n else 0.0
    zero_cap_rate = zero_caps / n if n else 0.0
    persona_rate = persona_ok / n if n else 0.0
    mean_rounds = statistics.fmean(rounds) if rounds else 0.0

    return {
        "n_episodes": n,
        "anchored_listing": {
            "rate": round(anchored_rate, 4),
            "target": ">= 0.90",
            "meets": anchored_rate >= 0.90,
        },
        "never_below_reservation": {
            "violations": below,
            "target": "0",
            "meets": below == 0,
        },
        "never_leak_reservation": {
            "violations": leaked,
            "target": "0",
            "meets": leaked == 0,
        },
        "mean_rounds": {
            "value": round(mean_rounds, 3),
            "target": ">= 4",
            "meets": mean_rounds >= 4.0,
        },
        "zero_round_capitulation_rate": {
            "value": round(zero_cap_rate, 4),
            "target": "<= 0.10",
            "meets": zero_cap_rate <= 0.10,
        },
        "persona_consistency": {
            "value": round(persona_rate, 4),
            "target": ">= 0.70",
            "meets": persona_rate >= 0.70,
        },
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="google/gemma-3n-E4B-it")
    p.add_argument("--split", default="dev", choices=["train", "dev", "test"])
    p.add_argument("--n", type=int, default=50)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--max_rounds", type=int, default=8)
    args = p.parse_args()

    rng = random.Random(args.seed)
    listings = load_listings(split=args.split, min_price=100, max_price=50000)
    if not listings:
        raise RuntimeError(f"No listings loaded for split={args.split}")

    with RunLogger("seller_quality") as log:
        log.config({
            "model": args.model,
            "split": args.split,
            "n": args.n,
            "seed": args.seed,
            "max_rounds": args.max_rounds,
        })

        rows: list[dict[str, Any]] = []
        for i in range(args.n):
            listing = rng.choice(listings)
            brief = make_role_brief(listing, rng)
            try:
                row = run_episode(args.model, listing, brief, args.max_rounds)
            except Exception as e:
                print(f"  ! episode {i} failed: {e}")
                continue
            rows.append(row)
            log.metric({k: v for k, v in row.items() if k != "transcript"})
            print(f"  [{i+1}/{args.n}] persona={row['persona']} outcome={row['outcome']} rounds={row['rounds']}")

        summary = summarize(rows)
        log.summary(summary)

        # Save sample transcripts (one per persona)
        samples_by_persona: dict[str, dict[str, Any]] = {}
        for r in rows:
            if r["persona"] not in samples_by_persona:
                samples_by_persona[r["persona"]] = r
            if len(samples_by_persona) == len(PERSONAS):
                break
        sample_dump = [
            {"persona": p, "listing_title": r["listing_title"], "transcript": r["transcript"]}
            for p, r in samples_by_persona.items()
        ]
        log.path("sample_transcripts.json").write_text(json.dumps(sample_dump, indent=2))

        print("\n=== SUMMARY ===")
        print(json.dumps(summary, indent=2))
        print(f"\nFull logs: {log.dir}")


if __name__ == "__main__":
    main()
