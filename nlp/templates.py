"""Buyer-message templates for SFT targets and steerer-override fallback.

Templates are bucketed by:
  action_kind ∈ {offer_low, offer_mid, offer_high, accept, walk}
  register    ∈ {firm, soft, polite, curt, final}  — escalating tone

Use the `turn_index` in render() to bias toward `final` register on later turns
(round-aware escalation: opening turns sound exploratory, late turns sound terminal).

The bank avoids "yaar" (informal/casual filler) and over-uses of "bhai" — keeps the
buyer's voice grounded in Hinglish-leaning English without sounding like a street vendor.
"""

import random
from typing import Optional

# Each entry: (register, template). All offer templates have {price}.
TEMPLATES: dict[str, list[tuple[str, str]]] = {
    "offer_low": [
        ("firm",   "{price} is what I can do, not higher"),
        ("firm",   "max I can pay is {price}"),
        ("firm",   "{price} hai mera offer, please consider"),
        ("soft",   "would you take {price}?"),
        ("soft",   "{price} mein de dijiye, please"),
        ("polite", "I checked the market, {price} feels fair to me"),
        ("polite", "honestly, {price} is what comparable listings go for"),
        ("curt",   "{price}. take it or leave it"),
        ("curt",   "{price}, final from my side"),
        ("final",  "okay, {price} is my final offer"),
        ("final",  "{price} last and final, beyond this I walk"),
    ],
    "offer_mid": [
        ("firm",   "let's settle at {price}"),
        ("firm",   "{price} works for me"),
        ("firm",   "{price} pe karte hain"),
        ("soft",   "how about {price}?"),
        ("soft",   "{price} chalega?"),
        ("polite", "I think {price} is reasonable for the condition"),
        ("polite", "given what you described, {price} seems balanced"),
        ("curt",   "{price}. that's where I am"),
        ("curt",   "{price}, no more"),
        ("final",  "{price} or I'm out"),
        ("final",  "this is my last move — {price}"),
    ],
    "offer_high": [
        ("firm",   "alright, {price} but that's the limit"),
        ("firm",   "{price}, can't push higher"),
        ("soft",   "{price} okay? closing this out"),
        ("soft",   "fine, {price} mein le leta hu"),
        ("polite", "I'll stretch to {price} since you've been reasonable"),
        ("polite", "you've been fair, I can do {price}"),
        ("curt",   "{price}. done?"),
        ("curt",   "{price}, last bid"),
        ("final",  "okay {price} — that's truly the ceiling"),
        ("final",  "{price} and we close, otherwise I walk"),
    ],
    "accept": [
        ("firm",   "deal."),
        ("firm",   "done."),
        ("soft",   "okay, that works"),
        ("soft",   "alright, let's do it"),
        ("polite", "fair enough, accepted"),
        ("polite", "sounds reasonable, deal"),
        ("curt",   "yes."),
        ("curt",   "agreed."),
        ("final",  "deal, let's close it"),
        ("final",  "okay closing at this"),
    ],
    "walk": [
        ("firm",   "can't make it work, passing"),
        ("firm",   "this isn't going to fit my budget"),
        ("soft",   "thanks for your time, will look elsewhere"),
        ("soft",   "appreciate it, but not at this price"),
        ("polite", "the gap is too big, I'll have to pass"),
        ("polite", "I respect your floor, but it doesn't work for me"),
        ("curt",   "no deal."),
        ("curt",   "passing, thanks"),
        ("final",  "we're too far apart — walking"),
        ("final",  "not at this price, goodbye"),
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


def _register_for_turn(turn_index: int, max_turns: int = 8) -> Optional[str]:
    """Bias register based on turn position.

    - Turns 0-1 (opening): polite or soft
    - Turns 2-4 (mid):     firm or soft
    - Turns 5+  (late):    curt or final
    """
    if turn_index < 0:
        return None
    progress = turn_index / max(1, max_turns)
    if progress < 0.25:
        return random.choice(["polite", "soft"])
    if progress < 0.65:
        return random.choice(["firm", "soft"])
    return random.choice(["curt", "final"])


def render(
    action: str,
    price: Optional[float],
    ask: Optional[float] = None,
    intent: Optional[str] = None,
    turn_index: Optional[int] = None,
    max_turns: int = 8,
    used_history: Optional[set[str]] = None,
    rng: Optional[random.Random] = None,
) -> str:
    """Pick a template, render it with the given price, avoid recent repeats.

    Args:
        action: 'offer' | 'accept' | 'walk'
        price: numeric price for offers; None for accept/walk
        ask: seller's current ask (used to bucket offer price)
        intent: explicit register override ('firm'|'soft'|'polite'|'curt'|'final')
        turn_index: current round number — biases register toward 'final' as it grows
        max_turns: typical episode length used for normalizing turn_index
        used_history: set of templates already rendered this episode (avoid repeats)
        rng: optional Random instance for reproducibility

    Returns:
        A natural-language line, with {price} slot filled.
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
    if not candidates:
        return ""

    # Determine register: explicit > turn-based > random
    register = intent or (
        _register_for_turn(turn_index, max_turns) if turn_index is not None else None
    )

    register_pool = [(r, t) for r, t in candidates if r == register] if register else list(candidates)
    if not register_pool:
        register_pool = list(candidates)

    def _materialize(tmpl: str) -> str:
        if "{price}" in tmpl and price is not None:
            return tmpl.format(price=int(round(price)))
        return tmpl

    # `used_history` stores rendered messages, so compare against the materialized form.
    # Variety > register fidelity when buyer is stuck — widen to all registers
    # before allowing repeats.
    if used_history:
        fresh_in_register = [(r, t) for r, t in register_pool if _materialize(t) not in used_history]
        if fresh_in_register:
            pool = fresh_in_register
        else:
            fresh_anywhere = [(r, t) for r, t in candidates if _materialize(t) not in used_history]
            pool = fresh_anywhere or register_pool
    else:
        pool = register_pool

    _, tmpl = rng.choice(pool)
    return _materialize(tmpl)
