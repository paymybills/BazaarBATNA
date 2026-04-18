"""Rule-based seller opponent for BazaarBot.

The seller is a credible counterparty with configurable personality types:

Personalities:
- **default**: Balanced anchoring, moderate concession
- **deceptive**: Bluffs about demand/inventory, anchors higher, fakes urgency
- **impatient**: Reverses time pressure onto buyer, concedes fast but walks fast
- **collaborative**: Seeks fair deals, concedes to midpoint faster, builds rapport

Game-theory / poker inspired "tells":
- Each personality leaks observable signals that a smart agent can read
- Tells are noisy -- they correlate with hidden state but aren't deterministic
"""

from __future__ import annotations

import enum
import math
import random
from dataclasses import dataclass, field


class SellerPersonality(str, enum.Enum):
    DEFAULT = "default"
    DECEPTIVE = "deceptive"
    IMPATIENT = "impatient"
    COLLABORATIVE = "collaborative"


# ── Tell system ──────────────────────────────────────────────────

@dataclass
class SellerTell:
    """Observable signal that leaks seller state.

    Inspired by poker tells -- behavioral patterns that correlate
    with hidden information (inventory, urgency, BATNA strength).
    """
    # Verbal tells -- word choices in messages
    verbal_urgency: float = 0.0       # 0-1: how desperate the language sounds
    verbal_confidence: float = 0.5    # 0-1: assertiveness of language
    verbal_deception_cue: float = 0.0 # 0-1: over-justification, filler phrases

    # Price pattern tells
    price_rounding: str = "round"     # "round" (multiples of 5/10) vs "precise"
    offer_speed: str = "normal"       # "instant", "normal", "deliberate" (thinking time proxy)
    concession_pattern: str = "steady" # "steady", "erratic", "front_loaded", "stalling"

    # Body language proxy (text-based signals)
    fidget_level: float = 0.0         # 0-1: nervousness indicators
    eye_contact: str = "steady"       # "steady", "avoidant", "intense"
    posture: str = "neutral"          # "neutral", "leaning_in", "leaning_back", "arms_crossed"

    # Meta-tells (patterns across rounds)
    repeat_phrases: int = 0           # how many times seller repeats same phrase
    topic_changes: int = 0            # diversionary tactics count
    emotional_escalation: float = 0.0 # 0-1: how emotional the seller is getting


def _compute_tells(
    seller: "SellerState",
    buyer_offer: float | None,
    round_t: int,
    rng: random.Random,
) -> SellerTell:
    """Compute observable tells based on seller hidden state + personality.

    Tells are noisy signals -- they correlate with ground truth but have
    variance, so agents must read patterns over multiple rounds.
    """
    personality = seller.personality
    noise = lambda: rng.gauss(0, 0.1)  # noqa: E731

    # Base urgency from inventory pressure and time
    true_urgency = seller.inventory_pressure * (round_t / max(seller.max_rounds, 1))
    # How close to reserve price
    price_pressure = 0.0
    if seller.current_offer > 0 and seller.anchor > seller.reserve_price:
        price_pressure = 1.0 - (seller.current_offer - seller.reserve_price) / (seller.anchor - seller.reserve_price)
    true_urgency = min(1.0, true_urgency + price_pressure * 0.3)

    tell = SellerTell()

    if personality == SellerPersonality.DEFAULT:
        tell.verbal_urgency = max(0, min(1, true_urgency * 0.6 + noise()))
        tell.verbal_confidence = max(0, min(1, 0.6 - true_urgency * 0.3 + noise()))
        tell.fidget_level = max(0, min(1, true_urgency * 0.4 + noise()))
        tell.eye_contact = "steady" if true_urgency < 0.5 else "avoidant"
        tell.price_rounding = "round"
        tell.offer_speed = "normal"
        tell.concession_pattern = "steady"

    elif personality == SellerPersonality.DECEPTIVE:
        # Deceptive sellers INVERT their tells -- act confident when desperate
        fake_confidence = max(0, min(1, 0.3 + true_urgency * 0.5 + noise()))
        tell.verbal_urgency = max(0, min(1, 0.1 + noise() * 0.15))  # suppress urgency
        tell.verbal_confidence = fake_confidence
        tell.verbal_deception_cue = max(0, min(1, true_urgency * 0.7 + noise()))  # leaks!
        tell.fidget_level = max(0, min(1, true_urgency * 0.6 + noise()))  # hard to fake
        tell.eye_contact = "intense"  # overcompensation
        tell.posture = "leaning_in"   # aggressive posture to mask weakness
        tell.price_rounding = "precise"  # uses precise numbers to seem authoritative
        tell.offer_speed = "instant"  # answers too fast (rehearsed)
        tell.concession_pattern = "erratic"  # jumps around to confuse
        tell.topic_changes = max(0, int(true_urgency * 3 + rng.gauss(0, 0.5)))

    elif personality == SellerPersonality.IMPATIENT:
        tell.verbal_urgency = max(0, min(1, 0.4 + round_t * 0.1 + noise()))
        tell.verbal_confidence = max(0, min(1, 0.7 - round_t * 0.05 + noise()))
        tell.fidget_level = max(0, min(1, 0.3 + round_t * 0.08 + noise()))
        tell.eye_contact = "intense" if round_t < 3 else "avoidant"
        tell.posture = "arms_crossed" if round_t > 2 else "neutral"
        tell.offer_speed = "instant"
        tell.concession_pattern = "front_loaded"  # big drops early, nothing later
        tell.emotional_escalation = max(0, min(1, round_t * 0.12 + noise()))

    elif personality == SellerPersonality.COLLABORATIVE:
        tell.verbal_urgency = max(0, min(1, true_urgency * 0.8 + noise()))  # honest
        tell.verbal_confidence = max(0, min(1, 0.5 + noise()))
        tell.verbal_deception_cue = 0.0  # no deception
        tell.fidget_level = max(0, min(1, true_urgency * 0.3 + noise()))
        tell.eye_contact = "steady"
        tell.posture = "leaning_in"  # engaged, not aggressive
        tell.price_rounding = "round"  # transparent
        tell.offer_speed = "deliberate"  # thinks carefully
        tell.concession_pattern = "steady"
        tell.emotional_escalation = 0.0

    # Meta-tells accumulate over rounds
    if len(seller.offer_history) >= 2:
        last_two = seller.offer_history[-2:]
        if abs(last_two[0] - last_two[1]) < 1.0:
            tell.repeat_phrases += 1
            tell.concession_pattern = "stalling"

    return tell


# ── Personality-specific message templates ───────────────────────

_MESSAGES: dict[SellerPersonality, dict[str, list[str]]] = {
    SellerPersonality.DEFAULT: {
        "open": [
            'This {item}? Best quality. {price:.0f} rupees, final price.',
            '{price:.0f} rupees for this {item}. Very fair.',
        ],
        "counter": [
            '{price:.0f} rupees. That\'s my best offer.',
            'I can do {price:.0f}. Not lower.',
            'Okay, {price:.0f}. But that\'s the limit.',
        ],
        "walk": [
            'I have another buyer interested. Good day.',
            'Sorry, can\'t go that low. Maybe try next stall.',
        ],
        "accept": [
            'Done! {price:.0f} rupees. Good deal for both of us.',
        ],
        "pressure": [
            'Someone else was looking at this earlier...',
            'This is the last one I have.',
        ],
    },
    SellerPersonality.DECEPTIVE: {
        "open": [
            'Ah, this {item}! I just got three offers above {price:.0f}. '
            'For you, special: {price:.0f} rupees.',
            'This {item} is selling fast. {price:.0f}, and honestly I\'m losing money at that.',
        ],
        "counter": [
            'My supplier charges me almost that much! {price:.0f} is rock bottom.',
            '{price:.0f}... you know, I shouldn\'t even go this low. '
            'My cousin told me someone offered more yesterday.',
            'Look, I have five people asking about this. {price:.0f}, take it or leave it.',
        ],
        "walk": [
            'Fine, fine. I have better buyers lined up anyway.',
            'You think about it. I have three others who want this.',
        ],
        "accept": [
            'You\'re killing me! {price:.0f}... okay, but don\'t tell anyone I gave this price.',
        ],
        "pressure": [
            'I\'m actually about to close up for the day...',
            'Another customer was asking about this just minutes ago.',
            'My wife says I shouldn\'t sell below cost, but for you...',
        ],
    },
    SellerPersonality.IMPATIENT: {
        "open": [
            '{price:.0f} rupees. Quick, I\'m busy.',
            'This {item}, {price:.0f}. Yes or no?',
        ],
        "counter": [
            '{price:.0f}. Decide now.',
            'Fine, {price:.0f}. Last offer. I don\'t have all day.',
            '{price:.0f}. Take it. I have other customers waiting.',
        ],
        "walk": [
            'Too slow. Next customer!',
            'I don\'t have time for this. Goodbye.',
        ],
        "accept": [
            '{price:.0f}, done. Finally.',
        ],
        "pressure": [
            'Come on, come on. What\'s it going to be?',
            'I\'ve been standing here too long already.',
        ],
    },
    SellerPersonality.COLLABORATIVE: {
        "open": [
            'Welcome! This {item} is lovely, isn\'t it? '
            'I\'m asking {price:.0f} rupees. What do you think?',
            'Good to see you! This {item} -- I paid {cost:.0f} for the materials. '
            'How about {price:.0f}?',
        ],
        "counter": [
            'I understand. How about {price:.0f}? That\'s fair for both of us.',
            'Let me think... {price:.0f} works. I need to cover my costs, you know.',
            'You drive a good bargain! {price:.0f} -- that leaves us both happy.',
        ],
        "walk": [
            'I understand, maybe next time. Come back anytime!',
            'No worries. I hope you find what you\'re looking for.',
        ],
        "accept": [
            '{price:.0f} rupees -- wonderful! I hope you enjoy the {item}.',
        ],
        "pressure": [
            'I\'ll be honest with you -- I need to sell a few more today to cover rent.',
            'Between you and me, I can be a bit flexible.',
        ],
    },
}


def _pick_message(
    personality: SellerPersonality,
    category: str,
    rng: random.Random,
    **kwargs,
) -> str:
    templates = _MESSAGES[personality].get(category, _MESSAGES[SellerPersonality.DEFAULT][category])
    template = rng.choice(templates)
    return template.format(**kwargs)


# ── Seller state ─────────────────────────────────────────────────

@dataclass
class SellerState:
    cost: float = 30.0
    anchor: float = 60.0
    base_concession_rate: float = 0.08
    inventory: int = 1
    initial_inventory: int = 1
    batna_probability: float = 0.1
    reserve_price: float = 0.0
    current_offer: float = 0.0
    round_number: int = 0
    max_rounds: int = 8
    buyer_capitulation_rate: float = 0.0
    offer_history: list[float] = field(default_factory=list)
    batna_triggered: bool = False
    personality: SellerPersonality = SellerPersonality.DEFAULT
    _rng: random.Random = field(default_factory=random.Random)

    # Tell tracking
    last_tell: SellerTell | None = None
    _pressure_used: int = 0
    _bluff_count: int = 0

    def __post_init__(self):
        self.reserve_price = self.cost * 1.05
        self.current_offer = self.anchor
        # Personality adjustments to anchor
        if self.personality == SellerPersonality.DECEPTIVE:
            self.anchor *= 1.15  # inflated anchor
            self.current_offer = self.anchor
        elif self.personality == SellerPersonality.IMPATIENT:
            self.max_rounds = max(4, self.max_rounds - 2)  # shorter patience
        elif self.personality == SellerPersonality.COLLABORATIVE:
            self.anchor *= 0.9  # lower starting anchor
            self.current_offer = self.anchor
            self.reserve_price = self.cost * 1.02  # tighter margins

    @property
    def inventory_pressure(self) -> float:
        if self.initial_inventory <= 1:
            return 0.5
        return self.inventory / self.initial_inventory

    @property
    def effective_concession_rate(self) -> float:
        rate = self.base_concession_rate

        # Personality modifiers
        if self.personality == SellerPersonality.DECEPTIVE:
            rate *= 0.7  # concedes less (anchored higher)
        elif self.personality == SellerPersonality.IMPATIENT:
            rate *= 1.5  # concedes fast but walks fast
        elif self.personality == SellerPersonality.COLLABORATIVE:
            rate *= 1.3  # concedes toward fairness

        rate *= (1.0 + 0.5 * self.inventory_pressure)
        rate *= (1.0 - 0.3 * self.buyer_capitulation_rate)
        return min(rate, 0.25)

    def compute_counteroffer(self, round_t: int) -> float:
        t_frac = round_t / max(self.max_rounds, 1)
        concession = self.effective_concession_rate * round_t
        offer = self.anchor * (1.0 - concession)

        # Personality-specific counteroffer adjustments
        if self.personality == SellerPersonality.DECEPTIVE and self._rng.random() < 0.3:
            # Occasionally fake a big concession then pull back next round
            if self._bluff_count < 2:
                offer *= 0.92  # looks generous
                self._bluff_count += 1
        elif self.personality == SellerPersonality.IMPATIENT:
            # Front-load concessions: big drops early, nothing later
            if round_t <= 2:
                offer *= (1.0 - 0.08 * round_t)
            # After round 2, barely move
        elif self.personality == SellerPersonality.COLLABORATIVE:
            # Move toward midpoint between cost and buyer's last offer
            if self.offer_history and len(self.offer_history) > 0:
                midpoint = (self.cost * 1.1 + (self.offer_history[-1] if self.offer_history else self.anchor)) / 2
                offer = offer * 0.7 + midpoint * 0.3

        offer = max(offer, self.reserve_price)
        return round(offer, 2)

    def respond(
        self, buyer_offer: float | None, round_t: int
    ) -> tuple[str, float, SellerTell, str]:
        """Seller's response to a buyer action.

        Returns (action, price, tell, message):
            ("counter", price, tell, msg)
            ("accept", price, tell, msg)
            ("walk", 0, tell, msg)
        """
        self.round_number = round_t

        # Compute tells BEFORE decision (observable during deliberation)
        tell = _compute_tells(self, buyer_offer, round_t, self._rng)
        self.last_tell = tell

        item = "item"  # will be overridden by environment

        # Check BATNA
        batna_threshold = self.batna_probability * (round_t / self.max_rounds)
        if self.personality == SellerPersonality.IMPATIENT:
            batna_threshold *= 1.5  # walks sooner
        elif self.personality == SellerPersonality.COLLABORATIVE:
            batna_threshold *= 0.3  # rarely walks

        if self._rng.random() < batna_threshold:
            if buyer_offer is None or buyer_offer < self.reserve_price * 0.9:
                self.batna_triggered = True
                msg = _pick_message(self.personality, "walk", self._rng, item=item, price=0)
                return ("walk", 0.0, tell, msg)

        # If buyer made an offer
        if buyer_offer is not None:
            # Accept if offer >= current ask
            accept_threshold = 0.98
            if self.personality == SellerPersonality.COLLABORATIVE:
                accept_threshold = 0.95  # more accepting
            elif self.personality == SellerPersonality.DECEPTIVE:
                accept_threshold = 1.0  # harder to close

            if buyer_offer >= self.current_offer * accept_threshold:
                msg = _pick_message(self.personality, "accept", self._rng,
                                    item=item, price=buyer_offer)
                return ("accept", buyer_offer, tell, msg)

            # Time pressure acceptance
            time_pressure = round_t / self.max_rounds
            if buyer_offer >= self.reserve_price and time_pressure > 0.75:
                accept_prob = (buyer_offer - self.reserve_price) / (self.anchor - self.reserve_price)
                accept_prob *= time_pressure

                if self.personality == SellerPersonality.IMPATIENT:
                    accept_prob *= 1.3
                elif self.personality == SellerPersonality.DECEPTIVE:
                    accept_prob *= 0.6

                if self._rng.random() < accept_prob:
                    msg = _pick_message(self.personality, "accept", self._rng,
                                        item=item, price=buyer_offer)
                    return ("accept", buyer_offer, tell, msg)

        # Make counteroffer
        new_offer = self.compute_counteroffer(round_t)
        if buyer_offer is not None and len(self.offer_history) > 0:
            last = self.offer_history[-1]
            midpoint = (new_offer + buyer_offer) / 2
            new_offer = max(new_offer, midpoint * 0.95)
            new_offer = max(new_offer, self.reserve_price)

        # Deceptive: occasionally pull back (raise price)
        if self.personality == SellerPersonality.DECEPTIVE:
            if self._bluff_count > 0 and self._rng.random() < 0.25 and self.offer_history:
                new_offer = max(new_offer, self.offer_history[-1] * 1.03)
                new_offer = max(new_offer, self.reserve_price)
                self._bluff_count = 0

        self.current_offer = round(new_offer, 2)

        # If our computed counteroffer is at or below the buyer's offer, just accept --
        # no rational seller counters below what the buyer already offered.
        if buyer_offer is not None and self.current_offer <= buyer_offer:
            msg = _pick_message(self.personality, "accept", self._rng,
                                item=item, price=buyer_offer)
            return ("accept", buyer_offer, tell, msg)

        self.offer_history.append(self.current_offer)

        # Maybe add pressure message
        pressure_msg = ""
        if self._rng.random() < 0.2 + (round_t / self.max_rounds) * 0.3:
            if self.personality == SellerPersonality.DECEPTIVE or self._pressure_used < 2:
                pressure_msg = " " + _pick_message(self.personality, "pressure", self._rng,
                                                    item=item, price=self.current_offer)
                self._pressure_used += 1

        msg = _pick_message(self.personality, "counter", self._rng,
                            item=item, price=self.current_offer, cost=self.cost) + pressure_msg

        return ("counter", self.current_offer, tell, msg)

    def update_career_info(self, capitulation_rate: float):
        self.buyer_capitulation_rate = capitulation_rate
