"""Rule-based seller opponent for BazaarBot.

The seller is a credible counterparty that:
- Anchors at cost * multiplier
- Concedes by a fixed percentage per round, scaled by inventory pressure
- Has a stochastic BATNA (outside option) that arrives with probability p per round
- Adapts concession rate based on buyer capitulation history (career mode)
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field


@dataclass
class SellerState:
    cost: float = 30.0
    anchor: float = 60.0  # opening ask = cost * anchor_multiplier
    base_concession_rate: float = 0.08
    inventory: int = 1
    initial_inventory: int = 1
    batna_probability: float = 0.1  # prob of outside option arriving per round
    reserve_price: float = 0.0  # minimum acceptable (computed from cost)
    current_offer: float = 0.0
    round_number: int = 0
    max_rounds: int = 8
    # Career adaptation
    buyer_capitulation_rate: float = 0.0  # from career history
    # Internal tracking
    offer_history: list[float] = field(default_factory=list)
    batna_triggered: bool = False

    def __post_init__(self):
        self.reserve_price = self.cost * 1.05  # 5% above cost minimum
        self.current_offer = self.anchor

    @property
    def inventory_pressure(self) -> float:
        """Higher inventory = more desperate to sell."""
        if self.initial_inventory <= 1:
            return 0.5
        return self.inventory / self.initial_inventory

    @property
    def effective_concession_rate(self) -> float:
        """Concession rate adjusted by inventory pressure and buyer history."""
        rate = self.base_concession_rate
        # More inventory pressure = faster concession
        rate *= (1.0 + 0.5 * self.inventory_pressure)
        # If buyer capitulates often, concede less (exploit them)
        rate *= (1.0 - 0.3 * self.buyer_capitulation_rate)
        return min(rate, 0.25)  # cap at 25% per round

    def compute_counteroffer(self, round_t: int) -> float:
        """Concession formula: anchor * (1 - concession_rate * t)."""
        t_frac = round_t / max(self.max_rounds, 1)
        concession = self.effective_concession_rate * round_t
        offer = self.anchor * (1.0 - concession)
        # Never go below reserve
        offer = max(offer, self.reserve_price)
        return round(offer, 2)

    def respond(self, buyer_offer: float | None, round_t: int) -> tuple[str, float]:
        """Seller's response to a buyer action.

        Returns (action, price):
            ("counter", price) - seller makes counteroffer
            ("accept", price) - seller accepts buyer's offer
            ("walk", 0) - seller walks (BATNA triggered or timeout)
        """
        self.round_number = round_t

        # Check BATNA - outside option
        if random.random() < self.batna_probability * (round_t / self.max_rounds):
            # BATNA more likely later in negotiation
            if buyer_offer is None or buyer_offer < self.reserve_price * 0.9:
                self.batna_triggered = True
                return ("walk", 0.0)

        # If buyer made an offer
        if buyer_offer is not None:
            # Accept if offer >= current ask (or close enough)
            if buyer_offer >= self.current_offer * 0.98:
                return ("accept", buyer_offer)
            # Accept if offer is above reserve and we're running out of time
            time_pressure = round_t / self.max_rounds
            if buyer_offer >= self.reserve_price and time_pressure > 0.75:
                # More likely to accept as deadline approaches
                accept_prob = (buyer_offer - self.reserve_price) / (self.anchor - self.reserve_price)
                accept_prob *= time_pressure
                if random.random() < accept_prob:
                    return ("accept", buyer_offer)

        # Make counteroffer
        new_offer = self.compute_counteroffer(round_t)
        # Ensure we're moving toward buyer (if buyer has offered)
        if buyer_offer is not None and len(self.offer_history) > 0:
            last = self.offer_history[-1]
            midpoint = (new_offer + buyer_offer) / 2
            # Don't concede past midpoint too fast
            new_offer = max(new_offer, midpoint * 0.95)
            new_offer = max(new_offer, self.reserve_price)

        self.current_offer = round(new_offer, 2)
        self.offer_history.append(self.current_offer)
        return ("counter", self.current_offer)

    def update_career_info(self, capitulation_rate: float):
        """Update seller's knowledge of buyer behavior from career history."""
        self.buyer_capitulation_rate = capitulation_rate
