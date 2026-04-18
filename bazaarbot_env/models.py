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


class SellerPersonalityType(str, enum.Enum):
    DEFAULT = "default"
    DECEPTIVE = "deceptive"
    IMPATIENT = "impatient"
    COLLABORATIVE = "collaborative"


# ── Tell model (observable signals) ──────────────────────────────

class TellObservation(BaseModel):
    """Observable seller tells -- poker/game-theory inspired signals.

    These are noisy correlates of the seller's hidden state.
    A smart agent learns to read patterns across rounds.
    """
    verbal_urgency: float = 0.0
    verbal_confidence: float = 0.5
    verbal_deception_cue: float = 0.0
    price_rounding: str = "round"
    offer_speed: str = "normal"
    concession_pattern: str = "steady"
    fidget_level: float = 0.0
    eye_contact: str = "steady"
    posture: str = "neutral"
    repeat_phrases: int = 0
    topic_changes: int = 0
    emotional_escalation: float = 0.0


class DealRecord(BaseModel):
    """Summary of a completed negotiation episode."""
    episode: int
    outcome: DealOutcome
    agreed_price: Optional[float] = None
    rounds_taken: int
    buyer_surplus: float = 0.0
    normalized_surplus: float = 0.0
    buyer_capitulated: bool = False


class CareerHistory(BaseModel):
    """Rolling window of past deal outcomes for career mode."""
    deals: list[DealRecord] = Field(default_factory=list)
    capitulation_rate: float = 0.0
    avg_normalized_surplus: float = 0.0
    avg_rounds_to_close: float = 0.0
    opponent_avg_offer_velocity: float = 0.0


class BazaarObservation(BaseModel):
    """What the buyer agent sees each step."""
    current_round: int = 0
    max_rounds: int = 8
    own_last_offer: Optional[float] = None
    opponent_last_offer: Optional[float] = None
    own_private_deadline: Optional[int] = None
    own_private_budget: float = 100.0
    rounds_remaining: int = 8
    seller_last_move_delta: Optional[float] = None

    # Item info
    item_name: str = "item"
    seller_asking_price: float = 0.0

    # Seller personality (visible to buyer)
    seller_personality: SellerPersonalityType = SellerPersonalityType.DEFAULT

    # Observable tells
    tells: Optional[TellObservation] = None

    # Career history
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
    price: Optional[float] = None


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
    buyer_deadline: Optional[int] = None
    seller_inventory: int = 1
    seller_batna_probability: float = 0.1
    enable_career: bool = False
    success_threshold: float = 0.3
    seller_personality: SellerPersonalityType = SellerPersonalityType.DEFAULT
    enable_tells: bool = True
    # Multi-buyer mode
    num_buyers: int = 1
    enable_coalition: bool = False


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
    seller_personality: SellerPersonalityType = SellerPersonalityType.DEFAULT
    offer_history: list[dict] = Field(default_factory=list)
    career_history: Optional[CareerHistory] = None
    cumulative_reward: float = 0.0
    tells_history: list[TellObservation] = Field(default_factory=list)


# ── Multi-buyer models ──────────────────────────────────────────

class BuyerIdentity(BaseModel):
    """Identity of a buyer in multi-buyer mode."""
    buyer_id: str
    name: str = "Buyer"
    is_human: bool = False


class ArenaAction(BaseModel):
    """Action in multi-buyer arena."""
    buyer_id: str
    action: ActionType
    price: Optional[float] = None
    # Coalition signals (visible to other buyers)
    signal: Optional[str] = None  # "cooperate", "compete", "bluff"


class ArenaObservation(BaseModel):
    """What a buyer sees in multi-buyer mode."""
    buyer_id: str
    negotiation: BazaarObservation
    # What other buyers are doing (imperfect info)
    other_buyers_visible: list[dict] = Field(default_factory=list)
    # Coalition state
    coalition_signals: list[dict] = Field(default_factory=list)
    # Market info
    seller_attention: str = "you"  # who the seller is currently focused on


class ArenaState(BaseModel):
    """Full state of a multi-buyer arena."""
    arena_id: str
    buyers: list[BuyerIdentity] = Field(default_factory=list)
    seller_personality: SellerPersonalityType = SellerPersonalityType.DEFAULT
    current_round: int = 0
    max_rounds: int = 12
    done: bool = False
    # Per-buyer negotiation states
    buyer_states: dict[str, dict] = Field(default_factory=dict)
    winner: Optional[str] = None
    deal_price: Optional[float] = None


# ── Leaderboard models ──────────────────────────────────────────

class LeaderboardEntry(BaseModel):
    agent_name: str
    task: str
    score: float
    episodes_completed: int
    timestamp: str
    metadata: dict = Field(default_factory=dict)


class LeaderboardResponse(BaseModel):
    entries: list[LeaderboardEntry] = Field(default_factory=list)
    total: int = 0


# ── Counterfactual models ───────────────────────────────────────

class CounterfactualRequest(BaseModel):
    """Request to replay from a decision point with a different action."""
    session_id: str = "default"
    from_round: int
    alternative_action: ActionType
    alternative_price: Optional[float] = None


class CounterfactualResult(BaseModel):
    """Result of a counterfactual replay."""
    original_outcome: Optional[DealOutcome] = None
    original_price: Optional[float] = None
    original_score: float = 0.0
    counterfactual_outcome: Optional[DealOutcome] = None
    counterfactual_price: Optional[float] = None
    counterfactual_score: float = 0.0
    divergence_round: int = 0
    counterfactual_history: list[dict] = Field(default_factory=list)
