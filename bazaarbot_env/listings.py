"""Real-world listing sampler for varied negotiation scenarios.

Loads the Amazon Sales CSV (committed at ``data/amazon.csv``) and exposes
``sample_listing(rng)``.  Each listing provides ground-truth fair-market
anchors used to set buyer budget and seller cost per episode, so the model
sees a different item and price range every rollout instead of the 10
hardcoded bazaar items.

Price mapping (rupees):
    actual_price       -> seller opening anchor (MRP)
    discounted_price   -> realistic market price
    seller_cost        = discounted_price * 0.7   (below-market floor)
    buyer_budget       = actual_price             (can afford MRP but wants lower)
"""

from __future__ import annotations

import csv
import os
import random
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional


# Path resolution: try repo root, then package-local data dir.
_CANDIDATES = [
    Path(__file__).resolve().parent.parent / "data" / "amazon.csv",
    Path(__file__).resolve().parent / "data" / "amazon.csv",
    Path(os.getenv("BAZAARBOT_LISTINGS_CSV", "")),
]


def _find_csv() -> Optional[Path]:
    for p in _CANDIDATES:
        if p and p.exists():
            return p
    return None


def _parse_rupees(s: str) -> Optional[float]:
    """Parse '₹1,099' -> 1099.0.  None on failure."""
    if not s:
        return None
    cleaned = re.sub(r"[^\d.]", "", s)
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


@lru_cache(maxsize=1)
def _load_listings() -> list[dict]:
    csv_path = _find_csv()
    if csv_path is None:
        return []

    listings: list[dict] = []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            actual = _parse_rupees(row.get("actual_price", ""))
            discounted = _parse_rupees(row.get("discounted_price", ""))
            name = (row.get("product_name") or "").strip()
            if not name or actual is None or discounted is None:
                continue
            if actual <= 0 or discounted <= 0 or discounted >= actual:
                # require a real discount so there's negotiation room
                continue
            # Trim absurdly long product titles; keep the informative head.
            short_name = name.split(",")[0].strip()
            if len(short_name) > 80:
                short_name = short_name[:77] + "..."
            listings.append({
                "name": short_name,
                "full_name": name,
                "category": (row.get("category") or "").split("|")[0].strip(),
                "actual_price": actual,
                "discounted_price": discounted,
            })
    return listings


def num_listings() -> int:
    return len(_load_listings())


def sample_listing(rng: Optional[random.Random] = None) -> Optional[dict]:
    """Return a dict with listing + derived bazaar params, or None if CSV absent.

    Return shape::

        {
            "name": str,
            "category": str,
            "actual_price": float,
            "discounted_price": float,
            "seller_cost": float,      # below-market floor
            "buyer_budget": float,     # MRP ceiling
            "seller_anchor": float,    # opening ask
            "fair_value": float,       # street price (hidden from buyer)
        }
    """
    listings = _load_listings()
    if not listings:
        return None
    rng = rng or random
    row = rng.choice(listings)
    return {
        "name": row["name"],
        "category": row["category"],
        "actual_price": row["actual_price"],
        "discounted_price": row["discounted_price"],
        "seller_cost": round(row["discounted_price"] * 0.7, 2),
        "buyer_budget": round(row["actual_price"], 2),
        "seller_anchor": round(row["actual_price"], 2),
        "fair_value": round(row["discounted_price"], 2),
    }
