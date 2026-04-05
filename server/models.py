"""Pydantic models for BazaarBot negotiation environment."""

from __future__ import annotations

import enum
from typing import Optional

from pydantic import BaseModel, Field


class ActionType(str, enum.Enum):
    OFFER = "offer"
    ACCEPT = "accept"
    WALK = "walk"


class DealOutcome(str, enum.Enum):
    DEAL = "deal"
    WALK = "walk"
    EXPIRED = "expired"


class DealRecord(BaseModel):
    """Summary of a completed negotiation episode."""
    episode: int
    outcome: DealOutcome
    agreed_price: Optional[float] = None
    rounds_taken: int
    buyer_surplus: float = 0.0
    normalized_surplus: float = 0.0
    buyer_capitulated: bool = False  # accepted near seller anchor


class CareerHistory(BaseModel):
    """Rolling window of past deal outcomes for career mode."""
    deals: list[DealRecord] = Field(default_factory=list)
    capitulation_rate: float = 0.0
    avg_normalized_surplus: float = 0.0
    avg_rounds_to_close: float = 0.0
    opponent_avg_offer_velocity: float = 0.0


class BazaarObservation(BaseModel):
    """What the buyer agent sees each step."""
    # Current negotiation state
    current_round: int = 0
    max_rounds: int = 8
    own_last_offer: Optional[float] = None
    opponent_last_offer: Optional[float] = None
    own_private_deadline: Optional[int] = None  # hidden from seller
    own_private_budget: float = 100.0  # hidden from seller
    rounds_remaining: int = 8
    seller_last_move_delta: Optional[float] = None  # how much seller conceded

    # Item info
    item_name: str = "item"
    seller_asking_price: float = 0.0  # the anchor / opening ask

    # Career history (populated in career mode)
    episode_number: int = 1
    total_episodes: int = 1
    career_history: Optional[CareerHistory] = None

    # Status
    done: bool = False
    deal_outcome: Optional[DealOutcome] = None
    message: str = ""


class BazaarAction(BaseModel):
    """Buyer's action each step."""
    action: ActionType
    price: Optional[float] = None  # required for offer, ignored for accept/walk


class BazaarReward(BaseModel):
    """Reward signal returned each step."""
    reward: float = 0.0
    terminal: bool = False
    components: dict[str, float] = Field(default_factory=dict)


class TaskConfig(BaseModel):
    """Configuration for a specific task variant."""
    name: str
    difficulty: str
    description: str
    max_steps: int = 8
    total_episodes: int = 1
    buyer_budget: float = 100.0
    seller_cost: float = 30.0
    seller_anchor_multiplier: float = 2.0
    seller_concession_rate: float = 0.08
    buyer_deadline: Optional[int] = None  # hard deadline round
    seller_inventory: int = 1
    seller_batna_probability: float = 0.1
    enable_career: bool = False
    success_threshold: float = 0.3


class EnvironmentState(BaseModel):
    """Full serializable state for state() endpoint."""
    task_name: str
    episode: int
    total_episodes: int
    current_round: int
    max_rounds: int
    done: bool
    buyer_budget: float
    seller_cost: float
    seller_anchor: float
    offer_history: list[dict] = Field(default_factory=list)
    career_history: Optional[CareerHistory] = None
    cumulative_reward: float = 0.0
