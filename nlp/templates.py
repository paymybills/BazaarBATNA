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
        ("firm",   "{price} max de sakta hu, isse upar nahi"),
        ("firm",   "{price} mera offer, isse zyada nahi"),
        ("firm",   "{price} pe baat banegi, warna nahi"),
        ("firm",   "{price} hai bas, final"),
        ("soft",   "{price} mein de dijiye please"),
        ("soft",   "{price} chalega bhai?"),
        ("soft",   "{price} kar lo, deal pakki"),
        ("polite", "market mein {price} mein mil jaata hai, dekh lijiye"),
        ("polite", "honestly bhai, {price} fair lagta hai mujhe"),
        ("polite", "{price} reasonable hai, condition dekh ke"),
        ("curt",   "{price}. le ya jaa."),
        ("curt",   "{price}, last from my side"),
        ("final",  "okay, {price} mera final offer hai"),
        ("final",  "{price} ya nahi — beyond this I walk"),
    ],
    "offer_mid": [
        ("firm",   "{price} pe karte hain deal"),
        ("firm",   "{price} works for me, lock kar do"),
        ("firm",   "chalo, {price} pe baat khatam"),
        ("soft",   "{price} chalega bhai?"),
        ("soft",   "{price} mein ho jaye?"),
        ("soft",   "thoda kam karo, {price} pe finalize?"),
        ("polite", "{price} fair hai dono ke liye"),
        ("polite", "{price} sahi rate lagta hai mujhe"),
        ("curt",   "{price}. that's where I am"),
        ("curt",   "{price}, isse upar nahi"),
        ("final",  "{price} ya I'm out"),
        ("final",  "this is my last move — {price}"),
    ],
    "offer_high": [
        ("firm",   "okay, {price} but that's the limit"),
        ("firm",   "{price}, isse upar nahi ja sakta"),
        ("soft",   "{price} okay? close kar dete hain"),
        ("soft",   "fine, {price} mein le leta hu"),
        ("polite", "{price} stretch kar raha hu, condition fair lagi"),
        ("polite", "{price} de raha hu since you've been reasonable"),
        ("curt",   "{price}. done?"),
        ("curt",   "{price}, last bid"),
        ("final",  "okay {price} — bas yahi ceiling hai"),
        ("final",  "{price} pe close ya I walk"),
    ],
    "accept": [
        ("firm",   "deal."),
        ("firm",   "done."),
        ("firm",   "chalo, deal."),
        ("soft",   "okay, le leta hu"),
        ("soft",   "theek hai, kar lete hain"),
        ("polite", "fair, accepted"),
        ("polite", "sounds good, deal pakki"),
        ("curt",   "haan."),
        ("curt",   "ho gaya, done"),
        ("final",  "deal, close kar dete hain"),
        ("final",  "okay, isi pe lock"),
    ],
    "walk": [
        ("firm",   "nahi yaar nahi, ye nahi ho payega"),
        ("firm",   "budget mein nahi aa raha, passing"),
        ("soft",   "thanks for your time, dekhte hain phir kabhi"),
        ("soft",   "appreciate it, but is price pe nahi"),
        ("polite", "gap zyada hai, mujhe pass karna hoga"),
        ("polite", "respect your floor, but mere liye nahi banega"),
        ("curt",   "no deal."),
        ("curt",   "passing, thanks"),
        ("final",  "bahut difference hai — walking"),
        ("final",  "is price pe nahi, goodbye"),
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
