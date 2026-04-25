"""Evaluate the NLP tell extractor against Chicago HAI human-labeled rows.

Compares ministral-3:3b zero-shot extraction to Chicago HAI ground-truth labels:
- firm_soft → verbal_confidence (binary: f=high, s=low)
- external_incentive=y → verbal_deception_cue (claim of outside pressure)
- category → loosely informs urgency/confidence

Also runs a rule-based control baseline (no LLM) for comparison.

Logs to runs/{ts}_extractor_eval/ via RunLogger.

Usage:
    PYTHONPATH=. .venv/bin/python nlp/eval_extractor.py [--n 500] [--model ministral-3:3b]
"""

import argparse
import json
import pathlib
import time
from collections import defaultdict

from nlp.extractor import TellExtractor, _condition_from_text, DEFAULT_TELL
from utils.run_logger import RunLogger

LABELED_ROWS = pathlib.Path("nlp/data/chicago_hai_bargaining.jsonl")


def load_labeled(min_len: int = 10) -> list[dict]:
    """Load Chicago HAI rows that have at least one human label."""
    rows = []
    with open(LABELED_ROWS) as f:
        for line in f:
            r = json.loads(line)
            has_label = bool(r["category"] or r["firm_soft"] or r["external_incentive"])
            if has_label and len(r["utterance"]) >= min_len:
                rows.append(r)
    return rows


def rule_based_predict(utterance: str) -> dict:
    """Control baseline: condition rules only, defaults elsewhere."""
    cond_score, dep_score, cond_label = _condition_from_text(utterance)
    out = dict(DEFAULT_TELL)
    out["condition_score"] = cond_score
    out["depreciation_score"] = dep_score
    out["condition_label"] = cond_label
    return out


def score_row(predicted: dict, gold: dict, row: dict) -> dict:
    """Per-row scoring against Chicago HAI labels."""
    out = {
        "abs_err_urgency": abs(predicted["verbal_urgency"] - gold["verbal_urgency"]),
        "abs_err_confidence": abs(predicted["verbal_confidence"] - gold["verbal_confidence"]),
        "abs_err_deception": abs(predicted["verbal_deception_cue"] - gold["verbal_deception_cue"]),
    }

    # Binary firm/soft accuracy: gold confidence ≥ 0.5 = firm
    if row["firm_soft"]:
        gold_firm = row["firm_soft"] == "f"
        pred_firm = predicted["verbal_confidence"] >= 0.5
        out["firm_correct"] = int(gold_firm == pred_firm)

    # External incentive (deception) recall: gold y → pred deception ≥ 0.4
    if row["external_incentive"] == "y":
        out["deception_flagged"] = int(predicted["verbal_deception_cue"] >= 0.4)

    return out


def aggregate(per_row: list[dict]) -> dict:
    """Roll up per-row scores into a summary."""
    sums = defaultdict(list)
    for r in per_row:
        for k, v in r.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                sums[k].append(v)
    return {f"mean_{k}": round(sum(v) / len(v), 4) for k, v in sums.items() if v}


def run_pass(rows: list[dict], predict_fn, name: str, log) -> dict:
    """Run one extraction pass over labeled rows."""
    print(f"\n[{name}] running on {len(rows)} rows ...")
    per_row = []
    t0 = time.time()
    for i, row in enumerate(rows):
        try:
            pred = predict_fn(row["utterance"])
        except Exception as e:
            print(f"  ! row {i} failed: {e}")
            continue

        scored = score_row(pred, row["tell_supervision"], row)
        log.metric({
            **scored,
            "pass": name,
            "row_idx": i,
            "utterance_preview": row["utterance"][:80],
        })
        per_row.append(scored)

        if (i + 1) % 50 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            eta = (len(rows) - i - 1) / rate
            print(f"  [{i+1}/{len(rows)}]  {rate:.2f} rows/s  ETA {eta:.0f}s")

    elapsed = time.time() - t0
    print(f"[{name}] done in {elapsed:.1f}s")
    summary = aggregate(per_row)
    summary["n"] = len(per_row)
    summary["elapsed_s"] = round(elapsed, 1)
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=500, help="Cap on labeled rows")
    parser.add_argument("--model", type=str, default="ministral-3:3b")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    import random
    random.seed(args.seed)

    rows = load_labeled()
    print(f"Loaded {len(rows)} labeled rows from Chicago HAI")
    if args.n and args.n < len(rows):
        rows = random.sample(rows, args.n)
        print(f"Sampled {args.n} rows for eval")

    extractor = TellExtractor(model=args.model)

    with RunLogger("extractor_eval") as log:
        log.config({
            "model": args.model,
            "n_rows": len(rows),
            "seed": args.seed,
            "labeled_source": "chicago_hai_bargaining.jsonl",
        })

        rule_summary = run_pass(rows, rule_based_predict, "rule_based", log)
        ministral_summary = run_pass(rows, extractor.extract, args.model, log)

        comparison = {
            "rule_based": rule_summary,
            args.model: ministral_summary,
            "deltas": {
                k.replace("mean_", "delta_"): ministral_summary.get(k, 0) - rule_summary.get(k, 0)
                for k in rule_summary
                if k.startswith("mean_") and k in ministral_summary
            },
        }
        log.summary(comparison)

        print("\n=== SUMMARY ===")
        print(json.dumps(comparison, indent=2))
        print(f"\nFull logs: {log.dir}")


if __name__ == "__main__":
    main()
