"""Fetch and cache negotiation datasets used for NLP extractor supervision.

Datasets:
  1. stanfordnlp/craigslist_bargains  — per-turn intent labels (init-price/accept/reject)
  2. ChicagoHAI/language-of-bargaining — per-turn bargaining act + Firm/Soft + External Incentive
  3. casino                            — multi-issue strategy annotations

Run:
    python nlp/fetch_datasets.py

Outputs written to nlp/data/:
    craigslist_bargains.jsonl
    chicago_hai_bargaining.jsonl
    casino.jsonl
    extractor_supervision.jsonl   ← merged supervision set for NLP extractor fine-tune
"""

import json
import pathlib
from datasets import load_dataset

OUT = pathlib.Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)


# ── Chicago HAI: Category → verbal tell mapping ───────────────────
# Derived from ACL 2023 paper taxonomy
CHICAGO_CATEGORY_MAP = {
    "offer":             {"verbal_urgency": 0.2, "verbal_confidence": 0.7},
    "counter-offer":     {"verbal_urgency": 0.3, "verbal_confidence": 0.6},
    "accept":            {"verbal_urgency": 0.1, "verbal_confidence": 0.8},
    "reject":            {"verbal_urgency": 0.4, "verbal_confidence": 0.5},
    "information":       {"verbal_urgency": 0.1, "verbal_confidence": 0.6},
    "threat":            {"verbal_urgency": 0.7, "verbal_confidence": 0.8},
    "appeal":            {"verbal_urgency": 0.5, "verbal_confidence": 0.4},
    "other":             {"verbal_urgency": 0.2, "verbal_confidence": 0.5},
}

FIRM_SOFT_MAP = {
    "Firm": 0.85,
    "Soft": 0.25,
    "":     0.5,
}

# Non-empty External Incentive = social proof / bluff signal
EXTERNAL_INCENTIVE_DECEPTION = 0.65


# ── CaSiNo: strategy → tell mapping ──────────────────────────────
# CaSiNo annotates with: no-need, self-need, other-need, vouch-fair,
# showing-concern, no-deal, coordination, empathy, small-talk
CASINO_STRATEGY_MAP = {
    "no-need":          {"verbal_urgency": 0.1, "verbal_deception_cue": 0.3},
    "self-need":        {"verbal_urgency": 0.6, "verbal_deception_cue": 0.1},
    "other-need":       {"verbal_urgency": 0.3, "verbal_deception_cue": 0.4},
    "vouch-fair":       {"verbal_urgency": 0.2, "verbal_confidence": 0.7},
    "showing-concern":  {"verbal_urgency": 0.3, "verbal_confidence": 0.4},
    "no-deal":          {"verbal_urgency": 0.5, "verbal_confidence": 0.8},
    "coordination":     {"verbal_urgency": 0.2, "verbal_confidence": 0.6},
    "empathy":          {"verbal_urgency": 0.2, "verbal_confidence": 0.5},
    "small-talk":       {"verbal_urgency": 0.05, "verbal_confidence": 0.5},
}


def _default_tell() -> dict:
    return {
        "verbal_urgency": 0.2,
        "verbal_confidence": 0.5,
        "verbal_deception_cue": 0.0,
        "condition_score": 1.0,
        "depreciation_score": 0.0,
        "condition_label": "unknown",
    }


def fetch_craigslist():
    # Load from local CodaLab downloads: data/train.json + data/dev.json (gzipped)
    # Source: https://worksheets.codalab.org/worksheets/0x453913e76b65495d8b9730d41c7e0a0c
    # Schema: events list with action in {message, offer, accept, reject, quit}
    # No per-turn intent labels — derive from action type
    import gzip, pathlib

    ACTION_TELL_MAP = {
        "message": {"verbal_urgency": 0.2, "verbal_confidence": 0.5},
        "offer":   {"verbal_urgency": 0.35, "verbal_confidence": 0.7},
        "accept":  {"verbal_urgency": 0.1, "verbal_confidence": 0.8},
        "reject":  {"verbal_urgency": 0.45, "verbal_confidence": 0.55},
        "quit":    {"verbal_urgency": 0.6, "verbal_confidence": 0.6},
    }

    rows = []
    for split in ("train", "dev"):
        path = pathlib.Path(f"data/{split}.json")
        if not path.exists():
            print(f"  ! data/{split}.json not found, skipping")
            continue
        print(f"  Loading data/{split}.json ...")
        try:
            with gzip.open(path) as f:
                examples = json.load(f)
        except Exception:
            # Try plain JSON if not gzipped
            examples = json.loads(path.read_text())

        for ex in examples:
            kbs = ex.get("scenario", {}).get("kbs", [{}, {}])
            # agent 0 = buyer (Role in personal), agent 1 = seller
            agent_roles = {}
            for kb in kbs:
                role = kb.get("personal", {}).get("Role", "")
                # agent index inferred from role
                if role == "buyer":
                    agent_roles[0] = "buyer"
                elif role == "seller":
                    agent_roles[1] = "seller"

            outcome = ex.get("outcome", {})
            deal_price = (outcome.get("offer") or {}).get("price")

            for ev in ex.get("events", []):
                action = ev.get("action", "")
                text = ev.get("data", "")
                if action != "message" or not isinstance(text, str) or len(text) < 5:
                    continue

                agent_idx = ev.get("agent", 0)
                role = agent_roles.get(agent_idx, "unknown")

                tell = _default_tell()
                tell.update(ACTION_TELL_MAP.get(action, {}))

                # Derive condition signals from listing description if present
                item = ex.get("scenario", {}).get("kbs", [{}])[0].get("item", {})
                desc = " ".join(item.get("Description", []) or [])
                if desc:
                    try:
                        from nlp.extractor import _condition_from_text
                        cond_score, dep_score, cond_label = _condition_from_text(desc)
                        if cond_label != "unknown":
                            tell["condition_score"] = cond_score
                            tell["depreciation_score"] = dep_score
                            tell["condition_label"] = cond_label
                    except ImportError:
                        pass

                rows.append({
                    "source": "craigslist_bargains",
                    "role": role,
                    "utterance": text,
                    "action": action,
                    "deal_price": deal_price,
                    "tell_supervision": tell,
                })

    path = OUT / "craigslist_bargains.jsonl"
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  → {len(rows)} turns written to {path}")
    return rows

    rows = []
    for split in ("train", "validation"):
        for ex in ds[split]:
            utterances = ex["utterance"]
            acts = ex["dialogue_acts"]
            roles = [ex["agent_info"]["Role"][t] for t in ex["agent_turn"]]
            item_price = ex["items"]["Price"][0] if ex["items"]["Price"] else None

            for i, (utt, role) in enumerate(zip(utterances, roles)):
                intent = acts["intent"][i] if acts and acts["intent"] else ""
                price_val = acts["price"][i] if acts and acts["price"] else -1.0

                tell = _default_tell()
                if intent == "accept":
                    tell["verbal_urgency"] = 0.1
                    tell["verbal_confidence"] = 0.8
                elif intent == "reject":
                    tell["verbal_urgency"] = 0.4
                    tell["verbal_confidence"] = 0.5
                elif intent == "init-price":
                    tell["verbal_confidence"] = 0.75

                rows.append({
                    "source": "craigslist_bargains",
                    "role": role,
                    "utterance": utt,
                    "intent": intent,
                    "price": float(price_val) if price_val and price_val != -1.0 else None,
                    "item_price": float(item_price) if item_price else None,
                    "tell_supervision": tell,
                })

    path = OUT / "craigslist_bargains.jsonl"
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  → {len(rows)} turns written to {path}")
    return rows


def fetch_chicago_hai():
    # Load from local negotiations_public_release/nl/ — 178 JSON files
    # HF version is broken; we have the data zip locally already.
    # Label taxonomy (from data exploration):
    #   Category: p=price, n=new-offer, c=counter, r=reject, a=accept, e=exit
    #   Firm or Soft: f=firm, s=soft
    #   External Incentive: y=yes (social proof / outside pressure claim)
    import pathlib
    nl_dir = pathlib.Path("negotiations_public_release/nl")
    if not nl_dir.exists():
        print("  ! negotiations_public_release/nl not found, skipping Chicago HAI")
        return []

    print(f"Loading Chicago HAI from {nl_dir} ({len(list(nl_dir.glob('*.json')))} files) ...")

    CATEGORY_MAP = {
        "p": {"verbal_urgency": 0.3, "verbal_confidence": 0.7},   # price proposal
        "n": {"verbal_urgency": 0.4, "verbal_confidence": 0.65},  # new offer
        "c": {"verbal_urgency": 0.35, "verbal_confidence": 0.6},  # counter
        "r": {"verbal_urgency": 0.5, "verbal_confidence": 0.5},   # reject
        "a": {"verbal_urgency": 0.1, "verbal_confidence": 0.8},   # accept
        "e": {"verbal_urgency": 0.6, "verbal_confidence": 0.7},   # exit/walk
    }
    FIRM_MAP = {"f": 0.80, "s": 0.25}

    rows = []
    for fpath in sorted(nl_dir.glob("*.json")):
        try:
            raw = fpath.read_text().replace(": NaN", ": null")
            d = json.loads(raw)
        except Exception:
            continue

        for turn_words in d.get("turns", []):
            if not isinstance(turn_words, list) or not turn_words:
                continue

            # Reconstruct utterance by joining Word fields
            utterance = " ".join(
                w.get("Word", "") for w in turn_words if w.get("Word")
            ).strip()
            if len(utterance) < 5:
                continue

            role = turn_words[0].get("Role", "")

            # Take labels from last word that has them (annotation is span-level)
            category, firm_soft, ext_incentive = "", "", ""
            for w in reversed(turn_words):
                if not category and w.get("Category"):
                    category = str(w["Category"]).strip()
                if not firm_soft and w.get("Firm or Soft"):
                    firm_soft = str(w["Firm or Soft"]).strip()
                if not ext_incentive and w.get("External Incentive"):
                    ext_incentive = str(w["External Incentive"]).strip()

            tell = _default_tell()
            tell.update(CATEGORY_MAP.get(category, {}))
            if firm_soft in FIRM_MAP:
                tell["verbal_confidence"] = FIRM_MAP[firm_soft]
            if ext_incentive == "y":
                tell["verbal_deception_cue"] = EXTERNAL_INCENTIVE_DECEPTION

            rows.append({
                "source": "chicago_hai",
                "role": role,
                "utterance": utterance,
                "category": category,
                "firm_soft": firm_soft,
                "external_incentive": ext_incentive,
                "tell_supervision": tell,
            })

    path = OUT / "chicago_hai_bargaining.jsonl"
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  → {len(rows)} turns written to {path}")
    return rows


def fetch_casino():
    print("Fetching casino (CaSiNo) ...")
    try:
        ds = load_dataset("casino", trust_remote_code=True)
    except Exception as e:
        print(f"  ! Could not load: {e}")
        return []

    rows = []
    for split in ds.keys():
        for ex in ds[split]:
            chat = ex.get("chat_logs", [])
            for turn in chat:
                utt = turn.get("text", "")
                if not utt:
                    continue

                role = turn.get("id", "")
                # CaSiNo per-turn strategy is in annotations, not task_data
                # task_data contains item allocation info, not strategy labels
                # Strategy labels are in ex["annotations"] keyed by worker
                strategy_label = ""

                tell = _default_tell()
                sig = CASINO_STRATEGY_MAP.get(strategy_label, {})
                tell.update(sig)

                rows.append({
                    "source": "casino",
                    "role": role,
                    "utterance": utt,
                    "strategy": strategy_label,
                    "tell_supervision": tell,
                })

    path = OUT / "casino.jsonl"
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  → {len(rows)} turns written to {path}")
    return rows


def merge_supervision(craigslist, chicago, casino):
    """Merge all sources into a single supervision set for extractor training.

    Each row: {"utterance": str, "tell_supervision": dict}
    Only rows with non-trivial utterances (len > 10) and non-default tells are kept.
    """
    all_rows = craigslist + chicago + casino
    merged = []
    for r in all_rows:
        utt = r.get("utterance", "").strip()
        tell = r.get("tell_supervision", {})
        if len(utt) < 10:
            continue
        # Keep only rows where at least one tell deviates from defaults
        non_default = (
            tell.get("verbal_urgency", 0.2) != 0.2
            or tell.get("verbal_confidence", 0.5) != 0.5
            or tell.get("verbal_deception_cue", 0.0) != 0.0
        )
        if not non_default:
            continue
        merged.append({"utterance": utt, "source": r["source"], "tell_supervision": tell})

    path = OUT / "extractor_supervision.jsonl"
    with open(path, "w") as f:
        for r in merged:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nMerged supervision set: {len(merged)} rows → {path}")


if __name__ == "__main__":
    craigslist = fetch_craigslist()
    chicago = fetch_chicago_hai()
    casino = fetch_casino()
    merge_supervision(craigslist, chicago, casino)
    print("\nDone. Run nlp/extractor.py to test extraction against these.")
