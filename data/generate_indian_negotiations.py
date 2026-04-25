"""Generate synthetic Indian C2C marketplace negotiation conversations.

Uses gemma4:e2b via Ollama to generate Hinglish WhatsApp-style negotiations
grounded in CraigslistBargains structure and CaSiNo strategy taxonomy.

Each conversation includes:
- WhatsApp-style Hinglish turns
- Outcome: deal / walk / pending
- Per-turn strategy label (CaSiNo taxonomy)
- Condition description mapped to eBay grade
- tell_supervision dict for NLP extractor training

Output: data/indian_negotiations.jsonl

Run:
    python data/generate_indian_negotiations.py [--n 500] [--model gemma4:e2b]
"""

import argparse
import json
import pathlib
import random
import time
import requests

OUT = pathlib.Path(__file__).parent / "indian_negotiations.jsonl"
OLLAMA_URL = "http://localhost:11434/api/generate"

ITEMS = [
    "iPhone 13 128GB", "Honda Activa 2019", "Samsung 43 inch TV",
    "Wooden study table", "PS4 with 2 controllers", "Canon DSLR 1300D",
    "Dell laptop i5", "Godrej almirah", "Cycle Trek MTB",
    "Redmi Note 12", "Hero Splendor bike", "OnePlus Buds Z2",
    "Bajaj mixer grinder", "Titan Fastrack watch", "JBL Flip 5 speaker",
    "Kent RO water purifier", "Prestige pressure cooker", "Boat Rockerz 450",
    "Lenovo IdeaPad i3", "Xiaomi Smart TV 32 inch",
]

CONDITIONS = [
    ("minor scratches on back, fully functional", "good", 0.55, 0.40),
    ("one small dent, works perfectly", "good", 0.55, 0.40),
    ("screen replaced once, battery health 81%", "acceptable", 0.35, 0.60),
    ("like new, used for 3 months only", "like_new", 0.85, 0.10),
    ("thoda use hua hai, bilkul sahi kaam karta hai", "like_new", 0.85, 0.10),
    ("box band hai, seal packed", "new", 1.0, 0.0),
    ("ek chhota sa scratch hai screen pe", "very_good", 0.70, 0.25),
    ("battery thodi kam hai, 79%, baaki sab theek", "acceptable", 0.35, 0.60),
    ("2 saal purana hai, magar condition ekdum mast hai", "very_good", 0.70, 0.25),
    ("bilkul naya, abhi box se nikala", "new", 1.0, 0.0),
    ("kabhi giraya nahi, original charger + box ke saath", "like_new", 0.85, 0.10),
    ("display mein ek chhota chip hai, baaki perfect", "good", 0.55, 0.40),
]

PERSONALITIES = ["deceptive", "impatient", "collaborative", "default"]

# CaSiNo strategy taxonomy for per-turn labels
STRATEGIES = [
    "self-need", "no-need", "other-need", "vouch-fair",
    "showing-concern", "no-deal", "coordination", "empathy",
]

SYSTEM_PROMPT = """You generate realistic Indian C2C marketplace negotiation conversations.
Format: WhatsApp-style chat between buyer and seller.

Rules:
- Natural Hinglish (mix Hindi/English as Indians actually text)
- Seller lists item, buyer initiates with a lowball
- 6-10 turns total
- End with deal, walk, or pending
- Include realistic INR prices
- Seller has the given personality:
  * deceptive: bluffs about other buyers, fake urgency, social proof ("teen aur log dekh rahe")
  * impatient: short replies, take-it-or-leave-it, walks fast
  * collaborative: honest, explains costs, seeks fair deal
  * default: balanced, moderate concessions
- Each turn: tag with ONE CaSiNo strategy from: self-need / no-need / other-need / vouch-fair / showing-concern / no-deal / coordination / empathy
- Output ONLY valid JSON, no preamble, no explanation

JSON schema:
{
  "item": str,
  "listed_price": int,
  "final_price": int or null,
  "outcome": "deal" | "walk" | "pending",
  "seller_personality": str,
  "condition": str,
  "condition_label": "new"|"like_new"|"very_good"|"good"|"acceptable"|"junk",
  "condition_score": float,
  "depreciation_score": float,
  "turns": [
    {"role": "seller"|"buyer", "message": str, "strategy": str}
  ]
}"""


def _call_ollama(prompt: str, model: str, timeout: int = 120) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.8, "num_predict": 2048},
    }
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json().get("response", "")
    except Exception as e:
        print(f"  ! Ollama error: {e}")
        return ""


def _parse_json(raw: str) -> dict | None:
    import re
    s = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "```" in s:
        parts = s.split("```")
        s = parts[1].lstrip("json").strip() if len(parts) >= 2 else s
    start, end = s.find("{"), s.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(s[start:end])
    except Exception:
        return None


def generate_conversation(model: str, item: str, condition_tuple: tuple, personality: str, listed_price: int) -> dict | None:
    condition_str, condition_label, condition_score, dep_score = condition_tuple
    buyer_target = int(listed_price * random.uniform(0.55, 0.72))

    prompt = f"""{SYSTEM_PROMPT}

Generate a negotiation:
Item: {item}
Listed price: ₹{listed_price}
Condition: {condition_str}
Seller personality: {personality}
Buyer target: ₹{buyer_target}

JSON:"""

    raw = _call_ollama(prompt, model)
    if not raw:
        return None

    parsed = _parse_json(raw)
    if parsed is None:
        print(f"  ! JSON parse failed. Raw: {raw[:100]!r}")
        return None

    # Validate minimum structure
    if not parsed.get("turns") or not isinstance(parsed["turns"], list):
        return None

    # Inject ground truth condition fields (more reliable than LLM-generated)
    parsed["condition_label"] = condition_label
    parsed["condition_score"] = condition_score
    parsed["depreciation_score"] = dep_score

    return parsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=500)
    parser.add_argument("--model", type=str, default="gemma4:e2b")
    args = parser.parse_args()

    print(f"Generating {args.n} conversations with {args.model}")
    print(f"Output: {OUT}\n")

    dataset = []
    # Load existing if resuming
    if OUT.exists():
        with open(OUT) as f:
            for line in f:
                line = line.strip()
                if line:
                    dataset.append(json.loads(line))
        print(f"Resuming from {len(dataset)} existing conversations")

    failures = 0
    i = len(dataset)
    while i < args.n:
        item = random.choice(ITEMS)
        condition_tuple = random.choice(CONDITIONS)
        personality = random.choice(PERSONALITIES)
        price = random.randint(3000, 80000)

        print(f"[{i+1}/{args.n}] {item} ₹{price} ({personality}) ... ", end="", flush=True)
        t0 = time.time()

        conv = generate_conversation(args.model, item, condition_tuple, personality, price)

        elapsed = time.time() - t0
        if conv is None:
            failures += 1
            print(f"FAILED ({failures} total failures)")
            if failures > 20:
                print("Too many failures, stopping.")
                break
            continue

        failures = 0  # reset on success
        turns = len(conv.get("turns", []))
        outcome = conv.get("outcome", "?")
        print(f"ok — {turns} turns, {outcome} ({elapsed:.1f}s)")

        dataset.append(conv)
        i += 1

        # Incremental save every 10
        if i % 10 == 0:
            with open(OUT, "w") as f:
                for d in dataset:
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
            print(f"  → Saved {i} conversations")

    # Final save
    with open(OUT, "w") as f:
        for d in dataset:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    outcomes = [d.get("outcome") for d in dataset]
    print(f"\nDone. {len(dataset)} conversations saved to {OUT}")
    print(f"Outcomes: deal={outcomes.count('deal')}, walk={outcomes.count('walk')}, pending={outcomes.count('pending')}")


if __name__ == "__main__":
    main()
