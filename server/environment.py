"""Core BazaarBot negotiation environment."""

from __future__ import annotations

import copy
import math
import random
from typing import Optional

from .models import (
    ActionType,
    BazaarAction,
    BazaarObservation,
    BazaarReward,
    CareerHistory,
    DealOutcome,
    DealRecord,
    EnvironmentState,
    SellerPersonalityType,
    TaskConfig,
    TellObservation,
)
from .seller import SellerPersonality, SellerState, SellerTell


def _tell_to_model(tell: SellerTell | None) -> TellObservation | None:
    if tell is None:
        return None
    return TellObservation(
        verbal_urgency=round(tell.verbal_urgency, 3),
        verbal_confidence=round(tell.verbal_confidence, 3),
        verbal_deception_cue=round(tell.verbal_deception_cue, 3),
        price_rounding=tell.price_rounding,
        offer_speed=tell.offer_speed,
        concession_pattern=tell.concession_pattern,
        fidget_level=round(tell.fidget_level, 3),
        eye_contact=tell.eye_contact,
        posture=tell.posture,
        repeat_phrases=tell.repeat_phrases,
        topic_changes=tell.topic_changes,
        emotional_escalation=round(tell.emotional_escalation, 3),
    )


class BazaarEnvironment:
    """Negotiation environment implementing step/reset/state."""

    def __init__(self, task: TaskConfig, seed: Optional[int] = None):
        self.task = task
        self.rng = random.Random(seed)
        if seed is not None:
            random.seed(seed)

        # Episode tracking
        self.current_episode = 0
        self.total_episodes = task.total_episodes
        self.career_history = CareerHistory()

        # Per-episode state
        self.seller: Optional[SellerState] = None
        self.current_round = 0
        self.done = False
        self.buyer_budget = task.buyer_budget
        self.remaining_bankroll = task.buyer_budget * task.total_episodes
        self.offer_history: list[dict] = []
        self.cumulative_reward = 0.0
        self.step_rewards: list[float] = []
        self.tells_history: list[TellObservation] = []

        # Stalling detection
        self._repeated_offers = 0
        self._last_buyer_offer: Optional[float] = None

        # Episode results for career grading
        self.episode_results: list[DealRecord] = []

        # Snapshot for counterfactual replay
        self._snapshots: dict[int, dict] = {}

        # Items for variety
        self._items = [
            "handwoven silk scarf", "brass table lamp", "leather messenger bag",
            "ceramic tea set", "sandalwood incense box", "hand-painted pottery",
            "embroidered cushion cover", "copper water bottle", "jute tote bag",
            "wooden chess set",
        ]

    def _snapshot(self):
        """Save a snapshot of environment state for counterfactual replay."""
        self._snapshots[self.current_round] = {
            "seller": copy.deepcopy(self.seller),
            "offer_history": copy.deepcopy(self.offer_history),
            "done": self.done,
            "cumulative_reward": self.cumulative_reward,
            "step_rewards": list(self.step_rewards),
            "repeated_offers": self._repeated_offers,
            "last_buyer_offer": self._last_buyer_offer,
            "current_round": self.current_round,
        }

    def restore_snapshot(self, round_num: int) -> bool:
        """Restore environment to state at given round. Returns False if no snapshot."""
        snap = self._snapshots.get(round_num)
        if snap is None:
            return False
        self.seller = copy.deepcopy(snap["seller"])
        self.offer_history = copy.deepcopy(snap["offer_history"])
        self.done = snap["done"]
        self.cumulative_reward = snap["cumulative_reward"]
        self.step_rewards = list(snap["step_rewards"])
        self._repeated_offers = snap["repeated_offers"]
        self._last_buyer_offer = snap["last_buyer_offer"]
        self.current_round = snap["current_round"]
        return True

    def reset(self) -> BazaarObservation:
        """Reset for next episode."""
        self.current_episode += 1
        self.current_round = 0
        self.done = False
        self.offer_history = []
        self.step_rewards = []
        self.tells_history = []
        self._repeated_offers = 0
        self._last_buyer_offer = None
        self._snapshots = {}

        # Map personality enum
        personality = SellerPersonality(self.task.seller_personality.value)

        # Create seller for this episode
        seller_anchor = self.task.seller_cost * self.task.seller_anchor_multiplier
        self.seller = SellerState(
            cost=self.task.seller_cost,
            anchor=seller_anchor,
            base_concession_rate=self.task.seller_concession_rate,
            inventory=self.task.seller_inventory,
            initial_inventory=self.task.seller_inventory,
            batna_probability=self.task.seller_batna_probability,
            max_rounds=self.task.max_steps if self.task.total_episodes == 1 else self.task.max_steps // self.task.total_episodes,
            personality=personality,
            _rng=self.rng,
        )

        # Career mode: update seller with buyer history
        if self.task.enable_career and self.career_history.deals:
            self.seller.update_career_info(self.career_history.capitulation_rate)

        item = self._items[(self.current_episode - 1) % len(self._items)]

        from .seller import _pick_message
        open_msg = _pick_message(
            personality, "open", self.rng,
            item=item, price=self.seller.anchor, cost=self.task.seller_cost,
        )

        obs = BazaarObservation(
            current_round=0,
            max_rounds=self.seller.max_rounds,
            own_last_offer=None,
            opponent_last_offer=self.seller.anchor,
            own_private_deadline=self.task.buyer_deadline,
            own_private_budget=self.buyer_budget,
            rounds_remaining=self.seller.max_rounds,
            seller_last_move_delta=None,
            item_name=item,
            seller_asking_price=self.seller.anchor,
            seller_personality=self.task.seller_personality,
            episode_number=self.current_episode,
            total_episodes=self.total_episodes,
            career_history=self.career_history if self.task.enable_career else None,
            done=False,
            message=f'Seller opens: "{open_msg}"',
        )

        self.offer_history.append({
            "round": 0,
            "actor": "seller",
            "action": "open",
            "price": self.seller.anchor,
        })

        self._snapshot()
        return obs

    def step(self, action: BazaarAction) -> tuple[BazaarObservation, BazaarReward]:
        """Process buyer action and return new observation + reward."""
        if self.done:
            obs = self._make_obs(message="Negotiation already concluded.")
            obs.done = True
            return obs, BazaarReward(reward=0.0, terminal=True)

        self._snapshot()
        self.current_round += 1
        reward_components: dict[str, float] = {}
        penalty = 0.0

        # Validate action
        if action.action == ActionType.OFFER:
            if action.price is None:
                action.price = self.buyer_budget * 0.5
            if action.price < 0 or action.price > self.buyer_budget:
                penalty -= 0.2
                reward_components["out_of_range_penalty"] = -0.2
                action.price = max(0, min(action.price, self.buyer_budget))

            if self._last_buyer_offer is not None and abs(action.price - self._last_buyer_offer) < 0.5:
                self._repeated_offers += 1
                if self._repeated_offers >= 3:
                    penalty -= 0.1
                    reward_components["stalling_penalty"] = -0.1
            else:
                self._repeated_offers = 0
            self._last_buyer_offer = action.price

        # Record buyer action
        self.offer_history.append({
            "round": self.current_round,
            "actor": "buyer",
            "action": action.action.value,
            "price": action.price,
        })

        # Process action
        if action.action == ActionType.WALK:
            return self._handle_walk(reward_components, penalty)
        elif action.action == ActionType.ACCEPT:
            return self._handle_accept(reward_components, penalty)
        else:
            return self._handle_offer(action.price, reward_components, penalty)

    def _handle_walk(self, components: dict, penalty: float) -> tuple[BazaarObservation, BazaarReward]:
        self.done = True
        walk_penalty = -0.3
        components["walk_penalty"] = walk_penalty
        total = walk_penalty + penalty

        self._record_deal(DealOutcome.WALK, None, self.current_round)

        obs = self._make_obs(message="You walk away from the deal.")
        obs.done = True
        obs.deal_outcome = DealOutcome.WALK

        reward = BazaarReward(reward=total, terminal=True, components=components)
        self.step_rewards.append(total)
        self.cumulative_reward += total
        return obs, reward

    def _handle_accept(self, components: dict, penalty: float) -> tuple[BazaarObservation, BazaarReward]:
        if self.seller is None or not self.seller.offer_history:
            obs = self._make_obs(message="No seller offer to accept yet. Make an offer first.")
            reward = BazaarReward(reward=-0.1 + penalty, terminal=False, components={"invalid_accept": -0.1})
            self.step_rewards.append(reward.reward)
            self.cumulative_reward += reward.reward
            return obs, reward

        agreed_price = self.seller.current_offer
        return self._finalize_deal(agreed_price, components, penalty, buyer_accepted=True)

    def _handle_offer(self, price: float, components: dict, penalty: float) -> tuple[BazaarObservation, BazaarReward]:
        assert self.seller is not None

        seller_action, seller_price, tell, msg = self.seller.respond(price, self.current_round)

        # Record tell
        tell_model = _tell_to_model(tell)
        if tell_model and self.task.enable_tells:
            self.tells_history.append(tell_model)

        if seller_action == "accept":
            self.offer_history.append({
                "round": self.current_round,
                "actor": "seller",
                "action": "accept",
                "price": price,
            })
            return self._finalize_deal(price, components, penalty, buyer_accepted=False, message=msg)

        elif seller_action == "walk":
            self.done = True
            components["seller_walked"] = -0.2
            self._record_deal(DealOutcome.WALK, None, self.current_round)

            obs = self._make_obs(message=f'Seller: "{msg}"')
            obs.done = True
            obs.deal_outcome = DealOutcome.WALK
            obs.tells = tell_model if self.task.enable_tells else None

            total = -0.2 + penalty
            reward = BazaarReward(reward=total, terminal=True, components=components)
            self.step_rewards.append(total)
            self.cumulative_reward += total
            return obs, reward

        else:  # counter
            self.offer_history.append({
                "round": self.current_round,
                "actor": "seller",
                "action": "counter",
                "price": seller_price,
            })

            # Partial progress reward
            initial_gap = self.seller.anchor - 0
            current_gap = abs(seller_price - price)
            if len(self.offer_history) >= 4:
                prev_seller = [h["price"] for h in self.offer_history if h["actor"] == "seller" and h["price"] is not None]
                prev_buyer = [h["price"] for h in self.offer_history if h["actor"] == "buyer" and h["price"] is not None]
                if len(prev_seller) >= 2 and len(prev_buyer) >= 2:
                    old_gap = abs(prev_seller[-2] - prev_buyer[-2])
                    gap_reduction = old_gap - current_gap
                    if gap_reduction > 0 and initial_gap > 0:
                        progress = 0.05 * (gap_reduction / initial_gap)
                        components["gap_narrowing"] = round(progress, 4)

            # Check if max rounds exceeded
            rounds_per_ep = self.seller.max_rounds
            if self.current_round >= rounds_per_ep:
                self.done = True
                self._record_deal(DealOutcome.EXPIRED, None, self.current_round)

                obs = self._make_obs(message="Time's up. No deal reached.")
                obs.done = True
                obs.deal_outcome = DealOutcome.EXPIRED
                obs.tells = tell_model if self.task.enable_tells else None
                components["expired_penalty"] = -0.15
                total = sum(components.values()) + penalty
                reward = BazaarReward(reward=total, terminal=True, components=components)
                self.step_rewards.append(total)
                self.cumulative_reward += total
                return obs, reward

            # Seller delta
            seller_delta = None
            seller_offers = [h["price"] for h in self.offer_history if h["actor"] == "seller" and h["price"] is not None]
            if len(seller_offers) >= 2:
                seller_delta = round(seller_offers[-2] - seller_offers[-1], 2)

            total = sum(components.values()) + penalty
            obs = self._make_obs(message=f'Seller: "{msg}"')
            obs.opponent_last_offer = seller_price
            obs.own_last_offer = price
            obs.seller_last_move_delta = seller_delta
            obs.rounds_remaining = rounds_per_ep - self.current_round
            obs.tells = tell_model if self.task.enable_tells else None

            reward = BazaarReward(reward=total, terminal=False, components=components)
            self.step_rewards.append(total)
            self.cumulative_reward += total
            return obs, reward

    def _finalize_deal(
        self, agreed_price: float, components: dict, penalty: float,
        buyer_accepted: bool, message: str | None = None,
    ) -> tuple[BazaarObservation, BazaarReward]:
        self.done = True
        assert self.seller is not None

        budget = self.buyer_budget
        cost = self.seller.cost
        surplus = budget - agreed_price
        max_surplus = budget - cost
        normalized_surplus = surplus / max_surplus if max_surplus > 0 else 0
        normalized_surplus = max(0, min(1, normalized_surplus))

        alpha, beta = 0.3, 2.5
        t_frac = self.current_round / max(self.seller.max_rounds, 1)
        time_discount = math.exp(-alpha * math.exp(beta * t_frac))

        rep_leak = 0.0
        if self.task.enable_career and len(self.career_history.deals) >= 3:
            cap_rate = self.career_history.capitulation_rate
            rep_leak = -0.1 * cap_rate
            components["reputation_leak"] = rep_leak

        capitulated = agreed_price > self.seller.anchor * 0.85

        terminal_reward = normalized_surplus * time_discount
        components["surplus"] = round(normalized_surplus, 4)
        components["time_discount"] = round(time_discount, 4)
        components["terminal_reward"] = round(terminal_reward, 4)

        total = terminal_reward + rep_leak + penalty
        total = max(0, min(1, total))

        self._record_deal(DealOutcome.DEAL, agreed_price, self.current_round, capitulated)
        self.remaining_bankroll -= agreed_price

        if message is None:
            msg = f"Deal! Agreed at {agreed_price:.0f} rupees."
            if buyer_accepted:
                msg = f"You accept the seller's offer of {agreed_price:.0f} rupees."
        else:
            msg = message

        obs = self._make_obs(message=msg)
        obs.done = True
        obs.deal_outcome = DealOutcome.DEAL

        reward = BazaarReward(reward=round(total, 4), terminal=True, components=components)
        self.step_rewards.append(total)
        self.cumulative_reward += total
        return obs, reward

    def _record_deal(self, outcome: DealOutcome, agreed_price: Optional[float], rounds: int, capitulated: bool = False):
        surplus = 0.0
        norm_surplus = 0.0
        if agreed_price is not None:
            surplus = self.buyer_budget - agreed_price
            max_surplus = self.buyer_budget - self.task.seller_cost
            norm_surplus = surplus / max_surplus if max_surplus > 0 else 0

        record = DealRecord(
            episode=self.current_episode,
            outcome=outcome,
            agreed_price=agreed_price,
            rounds_taken=rounds,
            buyer_surplus=surplus,
            normalized_surplus=norm_surplus,
            buyer_capitulated=capitulated,
        )
        self.career_history.deals.append(record)
        self.episode_results.append(record)

        deals = self.career_history.deals
        k = min(len(deals), 10)
        recent = deals[-k:]
        cap_count = sum(1 for d in recent if d.buyer_capitulated)
        self.career_history.capitulation_rate = cap_count / k

        completed = [d for d in recent if d.outcome == DealOutcome.DEAL]
        if completed:
            self.career_history.avg_normalized_surplus = sum(d.normalized_surplus for d in completed) / len(completed)
            self.career_history.avg_rounds_to_close = sum(d.rounds_taken for d in completed) / len(completed)

    def _make_obs(self, message: str = "") -> BazaarObservation:
        rounds_per_ep = self.seller.max_rounds if self.seller else self.task.max_steps
        return BazaarObservation(
            current_round=self.current_round,
            max_rounds=rounds_per_ep,
            own_last_offer=self._last_buyer_offer,
            opponent_last_offer=self.seller.current_offer if self.seller else None,
            own_private_deadline=self.task.buyer_deadline,
            own_private_budget=self.buyer_budget,
            rounds_remaining=max(0, rounds_per_ep - self.current_round),
            seller_last_move_delta=None,
            item_name=self._items[(self.current_episode - 1) % len(self._items)] if self.current_episode > 0 else "item",
            seller_asking_price=self.seller.anchor if self.seller else 0,
            seller_personality=self.task.seller_personality,
            episode_number=self.current_episode,
            total_episodes=self.total_episodes,
            career_history=self.career_history if self.task.enable_career else None,
            done=self.done,
            message=message,
        )

    def get_state(self) -> EnvironmentState:
        return EnvironmentState(
            task_name=self.task.name,
            episode=self.current_episode,
            total_episodes=self.total_episodes,
            current_round=self.current_round,
            max_rounds=self.seller.max_rounds if self.seller else self.task.max_steps,
            done=self.done,
            buyer_budget=self.buyer_budget,
            seller_cost=self.task.seller_cost,
            seller_anchor=self.seller.anchor if self.seller else 0,
            seller_personality=self.task.seller_personality,
            offer_history=self.offer_history,
            career_history=self.career_history if self.task.enable_career else None,
            cumulative_reward=self.cumulative_reward,
            tells_history=self.tells_history,
        )

    @property
    def all_episodes_done(self) -> bool:
        return self.current_episode >= self.total_episodes and self.done
