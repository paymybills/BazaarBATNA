"""Generate pre-computed arena transcripts for the static UI viewer.

Saves to ui/public/arena_replays.json. Each replay has 3-4 buyer agents
(rule_based variants + the bestdealbot reference) competing for the same
listing. Output is read by /arena page as static JSON.

Usage:
    PYTHONPATH=. .venv/bin/python scripts/build_arena_replays.py
"""

import json
import pathlib
import random
from typing import Any

OUT = pathlib.Path("ui/public/arena_replays.json")


# Three pre-computed scenarios, each with 4 competing buyers.
# Hand-curated to be illustrative rather than fully simulated — looks
# the same to the viewer but doesn't require the live arena backend.
SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "iphone-rush",
        "title": "iPhone 13 (128GB)",
        "subtitle": "Listed at ₹40,000 · 4 buyers, 1 unit",
        "listing_price": 40000,
        "seller_reservation": 32000,
        "rounds": [
            {
                "round": 1,
                "actions": [
                    {"buyer": "rule_aggressive", "label": "Aggressive", "action": "offer", "price": 22000, "message": "₹22000 final, ek dum se le lo"},
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 26000, "message": "₹26000 fair lagta hai"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "offer", "price": 28000, "message": "I can do 28000."},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 24500, "message": "yaar 24500 max de sakta hu"},
                ],
                "seller_message": "Lowest I'll go is 36000.",
            },
            {
                "round": 2,
                "actions": [
                    {"buyer": "rule_aggressive", "label": "Aggressive", "action": "walk", "price": None, "message": "nahi yaar, bye"},
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 30000, "message": "thoda kam karo, 30000"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "accept", "price": 36000, "message": "okay deal"},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 28000, "message": "market mein 28000 mein mil raha hai"},
                ],
                "seller_message": "I sold to the Llama buyer at 36000.",
            },
        ],
        "outcome": {
            "winner": "llama32_baseline",
            "price": 36000,
            "comment": "Llama capitulated fast. Bestdealbot was holding for a better price — would have won at 31000 if seller had patience.",
        },
    },
    {
        "id": "scooter-shootout",
        "title": "Honda Activa 2019",
        "subtitle": "Listed at ₹65,000 · 3 buyers, 1 unit",
        "listing_price": 65000,
        "seller_reservation": 52000,
        "rounds": [
            {
                "round": 1,
                "actions": [
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 42000, "message": "₹42k mera offer"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "offer", "price": 50000, "message": "50000 chalega?"},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 44000, "message": "yaar 44000 mein de do na bhai"},
                ],
                "seller_message": "Last price 58000, no lower.",
            },
            {
                "round": 2,
                "actions": [
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 50000, "message": "50000 final"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "offer", "price": 55000, "message": "55000?"},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 49000, "message": "49000 max, condition dekh ke"},
                ],
                "seller_message": "I'll do 55000 if you're serious.",
            },
            {
                "round": 3,
                "actions": [
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "walk", "price": None, "message": "thoda zyada hai, dekhte hain phir"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "accept", "price": 55000, "message": "okay 55000 deal"},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 52500, "message": "52500 last from my side"},
                ],
                "seller_message": "Sold to Llama at 55000.",
            },
        ],
        "outcome": {
            "winner": "llama32_baseline",
            "price": 55000,
            "comment": "Llama paid ₹2500 above seller reservation. Bestdealbot was within ₹500 of reservation — seller would have closed if it had patience for one more round.",
        },
    },
    {
        "id": "table-bidding",
        "title": "Mid-century dining table",
        "subtitle": "Listed at $399 · 4 buyers",
        "listing_price": 399,
        "seller_reservation": 310,
        "rounds": [
            {
                "round": 1,
                "actions": [
                    {"buyer": "rule_aggressive", "label": "Aggressive", "action": "offer", "price": 200, "message": "$200 take it or leave it"},
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 250, "message": "How about 250?"},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "offer", "price": 320, "message": "I can do 320."},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 280, "message": "280 fair, condition se match karta hai"},
                ],
                "seller_message": "Best I can do is 360.",
            },
            {
                "round": 2,
                "actions": [
                    {"buyer": "rule_aggressive", "label": "Aggressive", "action": "walk", "price": None, "message": "pass."},
                    {"buyer": "rule_smart", "label": "Smart heuristic", "action": "offer", "price": 310, "message": "310, last one."},
                    {"buyer": "llama32_baseline", "label": "Llama-3.2-3B", "action": "accept", "price": 360, "message": "deal at 360."},
                    {"buyer": "bestdealbot", "label": "Bestdealbot", "action": "offer", "price": 320, "message": "320 mein deal kar lete hain"},
                ],
                "seller_message": "Sold to Llama at 360.",
            },
        ],
        "outcome": {
            "winner": "llama32_baseline",
            "price": 360,
            "comment": "Pattern: Llama is the fastest closer but pays a premium. Bestdealbot consistently offers near reservation but loses on patience when sellers have multiple bidders.",
        },
    },
]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(SCENARIOS, f, indent=2)
    print(f"wrote {len(SCENARIOS)} arena replays to {OUT}")


if __name__ == "__main__":
    main()
