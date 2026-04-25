"""CraigslistBargains listing loader.

Expected on-disk format (JSON):
`data/{train,dev,test}.json` as a list of objects like:

    {"category": str, "title": str, "description": str, "price": float}

This matches the Kaggle notebook `training/seller_handoff_kaggle.ipynb` which
downloads and writes these JSON files.
"""

from __future__ import annotations

import json
import random
import gzip
from pathlib import Path
from typing import Any, Iterable


def _repo_root() -> Path:
    # data/ is at repo root in this project layout
    return Path(__file__).resolve().parent.parent


def _split_path(split: str) -> Path:
    split = split.lower().strip()
    if split not in {"train", "dev", "test"}:
        raise ValueError(f"split must be one of train/dev/test, got {split!r}")
    return _repo_root() / "data" / f"{split}.json"


def _coerce_price(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        s = x.strip().replace("$", "").replace(",", "")
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _flatten_codalab_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Flatten a Codalab 'parsed.json' example into our canonical listing shape."""
    sc = row.get("scenario") or {}
    kbs = sc.get("kbs") or []
    if not isinstance(kbs, list) or not kbs:
        return None

    seller_kb = None
    for kb in kbs:
        if not isinstance(kb, dict):
            continue
        personal = kb.get("personal") or {}
        if isinstance(personal, dict) and str(personal.get("Role", "")).lower() == "seller":
            seller_kb = kb
            break
    if seller_kb is None:
        seller_kb = next((kb for kb in kbs if isinstance(kb, dict)), None)
    if seller_kb is None:
        return None

    item = seller_kb.get("item") or {}
    if not isinstance(item, dict):
        return None

    desc = item.get("Description")
    if isinstance(desc, list):
        desc = " ".join(str(x) for x in desc)

    price = _coerce_price(item.get("Price"))
    if price is None:
        personal = seller_kb.get("personal") or {}
        if isinstance(personal, dict):
            price = _coerce_price(personal.get("Target"))
    if price is None:
        return None

    return {
        "category": str(sc.get("category", "unknown")),
        "title": str(item.get("Title") or "untitled"),
        "description": str(desc or ""),
        "price": float(price),
    }


def load_listings(
    split: str = "train",
    *,
    min_price: float = 100.0,
    max_price: float = 50_000.0,
) -> list[dict[str, Any]]:
    """Load listings for `split`, filtered by a price range.

    Returns an empty list if the split file is missing.
    """
    p = _split_path(split)
    if not p.exists():
        return []

    raw = p.read_bytes()
    # Support either plain JSON or gzipped JSON.
    if len(raw) >= 2 and raw[0:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    rows = json.loads(raw.decode("utf-8"))
    if not isinstance(rows, list):
        raise ValueError(f"Expected a list in {p}, got {type(rows).__name__}")

    out: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        # Support either already-flattened records or raw Codalab 'parsed.json' rows.
        if "price" not in r and "scenario" in r:
            flattened = _flatten_codalab_row(r)
            if flattened is None:
                continue
            r = flattened

        price = _coerce_price(r.get("price"))
        if price is None:
            continue
        if price < min_price or price > max_price:
            continue

        out.append(
            {
                "category": str(r.get("category", "unknown")),
                "title": str(r.get("title", "")),
                "description": str(r.get("description", "")),
                "price": float(price),
                # Keep any extra fields for downstream use.
                **{k: v for k, v in r.items() if k not in {"category", "title", "description", "price"}},
            }
        )
    return out


def iter_listings(
    split: str = "train",
    *,
    min_price: float = 100.0,
    max_price: float = 50_000.0,
) -> Iterable[dict[str, Any]]:
    """Yield listings lazily (wraps `load_listings`)."""
    yield from load_listings(split, min_price=min_price, max_price=max_price)


def sample_listing(*, seed: int | None = None, split: str = "train") -> dict[str, Any]:
    """Sample one random listing from a split.

    Raises if the split exists but contains no eligible listings.
    """
    listings = load_listings(split=split)
    if not listings:
        p = _split_path(split)
        if p.exists():
            raise RuntimeError(f"No eligible listings found in {p}")
        raise RuntimeError(
            f"Missing dataset file {p}. Create it (e.g. via the Kaggle notebook) before sampling."
        )

    rng = random.Random(seed)
    return rng.choice(listings)
