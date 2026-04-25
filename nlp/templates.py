"""Mined buyer-message templates from the 500 Hinglish synthetic conversations.

Used as a fallback when the Bayesian steerer overrides the LLM's price — the original
message is no longer defending the right number, so we swap in a templated line that
matches the new action and direction.

Buckets keyed by (action_kind, intent):
  action_kind ∈ {offer_low, offer_mid, offer_high, accept, walk}
  intent      ∈ {firm, soft, friendly} — derived from how the model framed it

Templates use {price} as the slot. e.g. "yaar {price} max, market mein isse kam mil jaata hai".
"""

import random
from typing import Optional

# Templates curated/mined from data/indian_negotiations.jsonl turns.
# Each entry is: (intent, template). All templates have a {price} slot for offers.
TEMPLATES: dict[str, list[tuple[str, str]]] = {
    "offer_low": [
        ("firm",     "yaar {price} max de sakta hu, isse zyada nahi"),
        ("firm",     "{price} hai mera offer, final"),
        ("firm",     "sorry boss, {price} se zyada nahi"),
        ("soft",     "thoda kam karo, {price} kar do"),
        ("soft",     "{price} mein de do na bhai"),
        ("friendly", "dekho yaar, {price} fair lagta hai mujhe"),
        ("friendly", "market mein {price} mein mil jaata hai, please consider"),
    ],
    "offer_mid": [
        ("firm",     "{price} pe karte hain deal, that's it"),
        ("firm",     "okay, {price} max"),
        ("soft",     "chalo {price} pe baat karte hain"),
        ("soft",     "{price} fair hai dono ke liye"),
        ("friendly", "{price} pe finalize karein? thoda thoda dono adjust karte hain"),
        ("friendly", "yaar {price} pe close kar dete hain"),
    ],
    "offer_high": [
        ("firm",     "okay, {price} ye mera last offer"),
        ("firm",     "{price}, isse upar nahi ja sakta"),
        ("soft",     "{price} de raha hu, deal kar lo"),
        ("friendly", "{price} pe deal lock karein?"),
        ("friendly", "okay yaar, {price} mein le leta hu"),
    ],
    "accept": [
        ("firm",     "deal."),
        ("firm",     "done."),
        ("soft",     "okay, deal kar lete hain"),
        ("soft",     "theek hai, le leta hu"),
        ("friendly", "perfect, done deal"),
        ("friendly", "haan yaar, le leta hu"),
    ],
    "walk": [
        ("firm",     "sorry boss, itna nahi de sakta"),
        ("firm",     "nahi yaar, ye nahi ho payega"),
        ("soft",     "thoda zyada hai, dekhte hain phir kabhi"),
        ("soft",     "abhi nahi le sakta, thanks"),
        ("friendly", "sorry yaar, budget se bahar hai"),
        ("friendly", "dekhte hain, thanks for your time"),
    ],
}


def _bucket_for_offer(price: float, ask: float) -> str:
    """Classify an offer price as low/mid/high relative to seller's ask."""
    if ask <= 0:
        return "offer_mid"
    ratio = price / ask
    if ratio < 0.55:
        return "offer_low"
    if ratio < 0.80:
        return "offer_mid"
    return "offer_high"


def render(
    action: str,
    price: Optional[float],
    ask: Optional[float] = None,
    intent: Optional[str] = None,
    rng: Optional[random.Random] = None,
) -> str:
    """Pick a template and render it with the given price.

    Args:
        action: 'offer' | 'accept' | 'walk'
        price: numeric price for offers; ignored for accept/walk
        ask: seller's current ask, used to bucket offer price
        intent: 'firm' | 'soft' | 'friendly'; if None, picks randomly
        rng: optional Random instance for reproducibility

    Returns:
        A natural-language line.
    """
    rng = rng or random
    if action == "offer":
        bucket = _bucket_for_offer(price or 0, ask or (price or 0))
    elif action == "accept":
        bucket = "accept"
    elif action == "walk":
        bucket = "walk"
    else:
        return ""

    candidates = TEMPLATES.get(bucket, [])
    if intent:
        filtered = [(i, t) for i, t in candidates if i == intent]
        if filtered:
            candidates = filtered
    if not candidates:
        return ""
    _, tmpl = rng.choice(candidates)
    if "{price}" in tmpl and price is not None:
        return tmpl.format(price=int(round(price)))
    return tmpl
