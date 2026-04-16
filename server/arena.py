"""Multi-buyer arena for BazaarBot.

Simulates a marketplace where multiple buyers compete for the same item.
Inspired by Facebook Marketplace dynamics -- one seller, multiple interested
buyers, with information asymmetry about competing offers.

Game-theoretic elements:
- Common value auction dynamics (all buyers value the item similarly)
- Winner's curse mitigation (don't overpay just to win)
- Coalition signaling (buyers can signal cooperation)
- Seller plays buyers against each other (anchoring to best offer)
"""

from __future__ import annotations

import random
from typing import Optional

from .models import (
    ActionType,
    ArenaAction,
    ArenaObservation,
    ArenaState,
    BazaarAction,
    BazaarObservation,
    BuyerIdentity,
    DealOutcome,
    SellerPersonalityType,
    TaskConfig,
    TellObservation,
)
from .environment import BazaarEnvironment, _tell_to_model
from .seller import SellerPersonality, SellerState, _compute_tells, _pick_message


class MultiBuyerArena:
    """Arena where multiple buyers negotiate with one seller.

    The seller sees all offers and can:
    - Pit buyers against each other ("someone offered more")
    - Accept the best offer
    - Raise anchor based on competing bids
    """

    def __init__(self, task: TaskConfig, seed: Optional[int] = None):
        self.task = task
        self.rng = random.Random(seed)
        self.arena_id = f"arena_{seed or 'default'}"

        self.num_buyers = max(2, task.num_buyers)
        self.buyers: list[BuyerIdentity] = []
        self.buyer_envs: dict[str, BazaarEnvironment] = {}
        self.buyer_offers: dict[str, list[dict]] = {}
        self.coalition_signals: list[dict] = []

        self.current_round = 0
        self.max_rounds = task.max_steps
        self.done = False
        self.winner: Optional[str] = None
        self.deal_price: Optional[float] = None

        # Shared seller state
        self.seller: Optional[SellerState] = None
        self._best_offer: float = 0.0
        self._best_buyer: Optional[str] = None

    def add_buyer(self, buyer_id: str, name: str = "Buyer", is_human: bool = False) -> BuyerIdentity:
        if len(self.buyers) >= self.num_buyers:
            raise ValueError(f"Arena full: max {self.num_buyers} buyers")
        buyer = BuyerIdentity(buyer_id=buyer_id, name=name, is_human=is_human)
        self.buyers.append(buyer)

        # Create a private environment for this buyer
        env = BazaarEnvironment(self.task, seed=hash(buyer_id) % 10000)
        self.buyer_envs[buyer_id] = env
        self.buyer_offers[buyer_id] = []
        return buyer

    def reset(self) -> dict[str, ArenaObservation]:
        """Reset arena and return initial observations for all buyers."""
        self.current_round = 0
        self.done = False
        self.winner = None
        self.deal_price = None
        self.coalition_signals = []
        self._best_offer = 0.0
        self._best_buyer = None

        personality = SellerPersonality(self.task.seller_personality.value)
        seller_anchor = self.task.seller_cost * self.task.seller_anchor_multiplier

        self.seller = SellerState(
            cost=self.task.seller_cost,
            anchor=seller_anchor,
            base_concession_rate=self.task.seller_concession_rate,
            inventory=self.task.seller_inventory,
            initial_inventory=self.task.seller_inventory,
            batna_probability=0.0,  # no BATNA in arena -- buyers are the BATNA
            max_rounds=self.max_rounds,
            personality=personality,
            _rng=self.rng,
        )

        item = "handwoven silk scarf"  # fixed item for arena

        observations = {}
        for buyer in self.buyers:
            bid = buyer.buyer_id
            obs = ArenaObservation(
                buyer_id=bid,
                negotiation=BazaarObservation(
                    current_round=0,
                    max_rounds=self.max_rounds,
                    own_last_offer=None,
                    opponent_last_offer=self.seller.anchor,
                    own_private_budget=self.task.buyer_budget,
                    rounds_remaining=self.max_rounds,
                    item_name=item,
                    seller_asking_price=self.seller.anchor,
                    seller_personality=self.task.seller_personality,
                    done=False,
                    message=f'Seller: "This {item}? {self.seller.anchor:.0f} rupees. '
                            f'I have {len(self.buyers)} people interested."',
                ),
                other_buyers_visible=[
                    {"buyer_id": b.buyer_id, "name": b.name, "status": "browsing"}
                    for b in self.buyers if b.buyer_id != bid
                ],
                seller_attention="all",
            )
            observations[bid] = obs
            self.buyer_offers[bid] = []

        return observations

    def step(self, actions: dict[str, ArenaAction]) -> dict[str, ArenaObservation]:
        """Process all buyer actions for this round.

        All buyers submit actions simultaneously (sealed-bid style per round).
        Seller responds to the best offer.
        """
        if self.done:
            return {bid: self._make_done_obs(bid) for bid in self.buyer_offers}

        self.current_round += 1

        # Collect signals
        for bid, action in actions.items():
            if action.signal:
                self.coalition_signals.append({
                    "round": self.current_round,
                    "buyer_id": bid,
                    "signal": action.signal,
                })

        # Process each buyer's offer
        round_offers: dict[str, float] = {}
        for bid, action in actions.items():
            if action.action == ActionType.WALK:
                self.buyer_offers[bid].append({
                    "round": self.current_round,
                    "action": "walk",
                    "price": None,
                })
                continue

            if action.action == ActionType.ACCEPT:
                price = self.seller.current_offer
            else:
                price = action.price or (self.task.buyer_budget * 0.5)

            round_offers[bid] = price
            self.buyer_offers[bid].append({
                "round": self.current_round,
                "action": action.action.value,
                "price": price,
            })

        # Find best offer this round
        if round_offers:
            best_bid = max(round_offers, key=round_offers.get)
            best_price = round_offers[best_bid]

            if best_price > self._best_offer:
                self._best_offer = best_price
                self._best_buyer = best_bid

        # Seller decides
        observations = {}
        assert self.seller is not None

        # Check if seller accepts best offer
        if self._best_offer >= self.seller.current_offer * 0.98:
            self.done = True
            self.winner = self._best_buyer
            self.deal_price = self._best_offer

            for buyer in self.buyers:
                bid = buyer.buyer_id
                won = bid == self.winner
                obs = self._make_arena_obs(
                    bid,
                    message=(
                        f'Seller: "SOLD to {self.winner} for {self.deal_price:.0f} rupees!"'
                        if won else
                        f'Seller: "Sorry, sold to another buyer for {self.deal_price:.0f}."'
                    ),
                    done=True,
                    outcome=DealOutcome.DEAL if won else DealOutcome.WALK,
                )
                observations[bid] = obs
            return observations

        # Time pressure: seller more likely to accept near end
        if self._best_offer > 0 and self.current_round >= self.max_rounds * 0.75:
            accept_prob = (self._best_offer - self.seller.reserve_price) / (self.seller.anchor - self.seller.reserve_price)
            accept_prob *= self.current_round / self.max_rounds
            if self.rng.random() < accept_prob:
                self.done = True
                self.winner = self._best_buyer
                self.deal_price = self._best_offer

                for buyer in self.buyers:
                    bid = buyer.buyer_id
                    won = bid == self.winner
                    obs = self._make_arena_obs(
                        bid,
                        message=(
                            f'Seller: "Alright, {self.deal_price:.0f} it is. Deal!"'
                            if won else
                            f'Seller: "Sorry, I went with another offer."'
                        ),
                        done=True,
                        outcome=DealOutcome.DEAL if won else DealOutcome.WALK,
                    )
                    observations[bid] = obs
                return observations

        # Seller counters -- uses best offer to anchor higher
        new_offer = self.seller.compute_counteroffer(self.current_round)
        if self._best_offer > 0:
            # Pull counteroffer up toward best buyer offer
            new_offer = max(new_offer, (new_offer + self._best_offer) / 2 * 0.95)
            new_offer = max(new_offer, self.seller.reserve_price)
        self.seller.current_offer = round(new_offer, 2)
        self.seller.offer_history.append(self.seller.current_offer)

        # Check expired
        if self.current_round >= self.max_rounds:
            self.done = True
            for buyer in self.buyers:
                bid = buyer.buyer_id
                obs = self._make_arena_obs(
                    bid,
                    message='Seller: "Time\'s up. No deal today."',
                    done=True,
                    outcome=DealOutcome.EXPIRED,
                )
                observations[bid] = obs
            return observations

        # Build per-buyer observations
        tell = _compute_tells(self.seller, self._best_offer, self.current_round, self.rng)
        tell_model = _tell_to_model(tell)

        for buyer in self.buyers:
            bid = buyer.buyer_id
            # Seller reveals different info to each buyer
            other_interest = f"I have {len(round_offers)} offers on the table"
            if self._best_buyer and self._best_buyer != bid:
                other_interest += f". Someone offered more than you"

            counter_msg = f'{self.seller.current_offer:.0f} rupees. {other_interest}.'

            obs = self._make_arena_obs(
                bid,
                message=f'Seller: "{counter_msg}"',
                tell=tell_model,
            )
            observations[bid] = obs

        return observations

    def _make_arena_obs(
        self,
        buyer_id: str,
        message: str = "",
        done: bool = False,
        outcome: Optional[DealOutcome] = None,
        tell: Optional[TellObservation] = None,
    ) -> ArenaObservation:
        assert self.seller is not None
        my_offers = self.buyer_offers.get(buyer_id, [])
        last_offer = my_offers[-1]["price"] if my_offers and my_offers[-1]["price"] else None

        return ArenaObservation(
            buyer_id=buyer_id,
            negotiation=BazaarObservation(
                current_round=self.current_round,
                max_rounds=self.max_rounds,
                own_last_offer=last_offer,
                opponent_last_offer=self.seller.current_offer,
                own_private_budget=self.task.buyer_budget,
                rounds_remaining=max(0, self.max_rounds - self.current_round),
                item_name="handwoven silk scarf",
                seller_asking_price=self.seller.anchor,
                seller_personality=self.task.seller_personality,
                done=done or self.done,
                deal_outcome=outcome,
                message=message,
                tells=tell if self.task.enable_tells else None,
            ),
            other_buyers_visible=[
                {
                    "buyer_id": b.buyer_id,
                    "name": b.name,
                    "status": "negotiating" if self.buyer_offers.get(b.buyer_id) else "browsing",
                    "rounds_active": len(self.buyer_offers.get(b.buyer_id, [])),
                }
                for b in self.buyers if b.buyer_id != buyer_id
            ],
            coalition_signals=[
                s for s in self.coalition_signals
                if s["round"] == self.current_round
            ],
            seller_attention=self._best_buyer or "all",
        )

    def _make_done_obs(self, buyer_id: str) -> ArenaObservation:
        return self._make_arena_obs(
            buyer_id,
            message="Arena closed.",
            done=True,
        )

    def get_state(self) -> ArenaState:
        return ArenaState(
            arena_id=self.arena_id,
            buyers=self.buyers,
            seller_personality=self.task.seller_personality,
            current_round=self.current_round,
            max_rounds=self.max_rounds,
            done=self.done,
            buyer_states={
                bid: {
                    "offers": offers,
                    "total_offers": len(offers),
                    "last_price": offers[-1]["price"] if offers else None,
                }
                for bid, offers in self.buyer_offers.items()
            },
            winner=self.winner,
            deal_price=self.deal_price,
        )
