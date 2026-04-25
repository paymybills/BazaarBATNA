"""CraigslistBargains listing loader. Stub — teammate finalizes.

See docs/SELLER_HANDOFF.md.
"""

import gzip
import json
import pathlib
import random

DATA_DIR = pathlib.Path(__file__).parent
TRAIN = DATA_DIR / "train.json"
DEV = DATA_DIR / "dev.json"
TEST = DATA_DIR / "test.json"

_SPLITS = {"train": TRAIN, "dev": DEV, "test": TEST}


def _open(path: pathlib.Path):
    if path.suffix == ".gz" or path.read_bytes()[:2] == b"\x1f\x8b":
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")


def load_listings(
    split: str = "train",
    min_price: float = 100,
    max_price: float = 50000,
) -> list[dict]:
    """Load and filter CraigslistBargains listings."""
    path = _SPLITS[split]
    with _open(path) as f:
        rows = json.load(f) if path.read_bytes()[:1] == b"[" else [json.loads(l) for l in f]
    out = []
    for r in rows:
        price = r.get("price") or (r.get("agent_info", {}) or {}).get("Target")
        if price and min_price <= price <= max_price:
            out.append(r)
    return out


def sample_listing(seed: int | None = None, split: str = "train") -> dict:
    """Return one random listing."""
    rng = random.Random(seed)
    listings = load_listings(split=split)
    return rng.choice(listings)
