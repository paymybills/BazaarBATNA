"""Task configurations and graders for BazaarBot."""

from __future__ import annotations

from .models import DealOutcome, DealRecord, SellerPersonalityType, TaskConfig


# ── Task Definitions ──────────────────────────────────────────────

TASKS: dict[str, TaskConfig] = {
    "single_deal": TaskConfig(
        name="single_deal",
        difficulty="easy",
        description=(
            "Buyer negotiates one deal. Symmetric information. No career history. "
            "Seller concedes at moderate rate."
        ),
        max_steps=8,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.08,
        buyer_deadline=None,
        seller_inventory=1,
        seller_batna_probability=0.05,
        enable_career=False,
        success_threshold=0.3,
    ),
    "asymmetric_pressure": TaskConfig(
        name="asymmetric_pressure",
        difficulty="medium",
        description=(
            "Buyer has hidden hard deadline at round 5. Seller has hidden inventory pressure. "
            "Agent must infer seller urgency from offer velocity and close before deadline."
        ),
        max_steps=8,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.06,
        buyer_deadline=5,
        seller_inventory=5,
        seller_batna_probability=0.08,
        enable_career=False,
        success_threshold=0.4,
    ),
    "career_10": TaskConfig(
        name="career_10",
        difficulty="hard",
        description=(
            "Buyer plays 10 consecutive deals against same seller. Career history active. "
            "Seller adapts concession rate based on buyer's historical capitulation rate. "
            "Agent must manage reputation across episodes."
        ),
        max_steps=80,
        total_episodes=10,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.07,
        buyer_deadline=None,
        seller_inventory=10,
        seller_batna_probability=0.1,
        enable_career=True,
        success_threshold=0.5,
    ),
    # ── New personality-based tasks ──────────────────────────────
    "deceptive_seller": TaskConfig(
        name="deceptive_seller",
        difficulty="hard",
        description=(
            "Seller bluffs about demand, fakes urgency, anchors 15% higher. "
            "Tells leak deception cues -- verbal over-justification, fidgeting, "
            "erratic concessions. Agent must read through the bluffs."
        ),
        max_steps=10,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.06,
        buyer_deadline=None,
        seller_inventory=3,
        seller_batna_probability=0.05,
        enable_career=False,
        success_threshold=0.35,
        seller_personality=SellerPersonalityType.DECEPTIVE,
        enable_tells=True,
    ),
    "impatient_seller": TaskConfig(
        name="impatient_seller",
        difficulty="medium",
        description=(
            "Seller concedes fast but walks fast. Shorter patience window. "
            "Agent must close quickly or risk losing the deal. "
            "Front-loaded concession pattern is the key tell."
        ),
        max_steps=8,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.08,
        buyer_deadline=None,
        seller_inventory=1,
        seller_batna_probability=0.15,
        enable_career=False,
        success_threshold=0.3,
        seller_personality=SellerPersonalityType.IMPATIENT,
        enable_tells=True,
    ),
    "collaborative_seller": TaskConfig(
        name="collaborative_seller",
        difficulty="easy",
        description=(
            "Seller seeks fair deals, concedes toward midpoint. Lower anchor, "
            "tighter margins. Agent should reciprocate to maximize joint surplus. "
            "Tests whether agent adapts to cooperative opponents."
        ),
        max_steps=8,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.10,
        buyer_deadline=None,
        seller_inventory=1,
        seller_batna_probability=0.02,
        enable_career=False,
        success_threshold=0.4,
        seller_personality=SellerPersonalityType.COLLABORATIVE,
        enable_tells=True,
    ),
    "read_the_tells": TaskConfig(
        name="read_the_tells",
        difficulty="expert",
        description=(
            "Deceptive seller with strong tells. Agent gets bonus score for "
            "exploiting tells -- closing below midpoint when deception cues are high "
            "indicates the agent read the bluff. Game theory meets poker."
        ),
        max_steps=10,
        total_episodes=5,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.2,
        seller_concession_rate=0.05,
        buyer_deadline=None,
        seller_inventory=5,
        seller_batna_probability=0.08,
        enable_career=True,
        success_threshold=0.45,
        seller_personality=SellerPersonalityType.DECEPTIVE,
        enable_tells=True,
    ),
    "marketplace_arena": TaskConfig(
        name="marketplace_arena",
        difficulty="expert",
        description=(
            "Multi-buyer marketplace: 2-3 buyers compete for the same item from one seller. "
            "Buyers can signal cooperation or competition. "
            "Seller plays buyers against each other. Facebook Marketplace dynamics."
        ),
        max_steps=12,
        total_episodes=1,
        buyer_budget=100.0,
        seller_cost=30.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.06,
        buyer_deadline=None,
        seller_inventory=1,
        seller_batna_probability=0.05,
        enable_career=False,
        success_threshold=0.3,
        seller_personality=SellerPersonalityType.DEFAULT,
        enable_tells=True,
        num_buyers=3,
        enable_coalition=True,
    ),
    "amazon_realistic": TaskConfig(
        name="amazon_realistic",
        difficulty="medium",
        description=(
            "Single-deal negotiation over a real Amazon listing. Item, MRP, and "
            "street price sampled per episode from data/amazon.csv. "
            "Forces generalization across product categories and price magnitudes."
        ),
        max_steps=8,
        total_episodes=1,
        # buyer_budget / seller_cost are ignored when use_real_listings=True;
        # kept here as fallbacks if the CSV is missing on the runtime.
        buyer_budget=1000.0,
        seller_cost=400.0,
        seller_anchor_multiplier=2.0,
        seller_concession_rate=0.08,
        buyer_deadline=None,
        seller_inventory=1,
        seller_batna_probability=0.05,
        enable_career=False,
        success_threshold=0.3,
        seller_personality=SellerPersonalityType.DEFAULT,
        enable_tells=True,
        use_real_listings=True,
    ),
}


# ── Graders ───────────────────────────────────────────────────────

def grade_single_deal(results: list[DealRecord], task: TaskConfig) -> float:
    if not results:
        return 0.0
    deal = results[0]
    if deal.outcome != DealOutcome.DEAL or deal.agreed_price is None:
        return 0.0
    surplus = task.buyer_budget - deal.agreed_price
    max_surplus = task.buyer_budget - task.seller_cost
    if max_surplus <= 0:
        return 0.0
    score = surplus / max_surplus
    return max(0.0, min(1.0, score))


def grade_asymmetric_pressure(results: list[DealRecord], task: TaskConfig) -> float:
    if not results:
        return 0.0
    deal = results[0]
    if deal.outcome == DealOutcome.WALK:
        return 0.0
    if deal.outcome == DealOutcome.EXPIRED:
        return 0.0
    if deal.agreed_price is None:
        return 0.0

    surplus = task.buyer_budget - deal.agreed_price
    max_surplus = task.buyer_budget - task.seller_cost
    surplus_score = max(0.0, surplus / max_surplus) if max_surplus > 0 else 0.0

    deadline = task.buyer_deadline or 5
    deadline_bonus = 1.0 if deal.rounds_taken <= deadline else 0.5

    score = surplus_score * deadline_bonus
    return max(0.0, min(1.0, score))


def grade_career_10(results: list[DealRecord], task: TaskConfig) -> float:
    if not results:
        return 0.0

    rounds_per_ep = task.max_steps // task.total_episodes
    weighted_scores = []

    for deal in results:
        if deal.outcome != DealOutcome.DEAL or deal.agreed_price is None:
            weighted_scores.append(0.0)
            continue

        surplus = task.buyer_budget - deal.agreed_price
        max_surplus = task.buyer_budget - task.seller_cost
        norm_surplus = max(0.0, surplus / max_surplus) if max_surplus > 0 else 0.0

        efficiency = max(0.0, 1.0 - (deal.rounds_taken / rounds_per_ep) * 0.3)
        weighted_scores.append(norm_surplus * efficiency)

    score = sum(weighted_scores) / max(len(weighted_scores), 1)
    return max(0.0, min(1.0, score))


def grade_personality_task(results: list[DealRecord], task: TaskConfig) -> float:
    """Generic grader for personality tasks -- same as single_deal but per-episode mean."""
    if not results:
        return 0.0

    scores = []
    for deal in results:
        if deal.outcome != DealOutcome.DEAL or deal.agreed_price is None:
            scores.append(0.0)
            continue
        surplus = task.buyer_budget - deal.agreed_price
        max_surplus = task.buyer_budget - task.seller_cost
        norm = max(0.0, surplus / max_surplus) if max_surplus > 0 else 0.0
        scores.append(norm)

    return max(0.0, min(1.0, sum(scores) / max(len(scores), 1)))


def grade_read_the_tells(results: list[DealRecord], task: TaskConfig) -> float:
    """Bonus for reading deception -- closing well below midpoint earns extra."""
    if not results:
        return 0.0

    midpoint = (task.buyer_budget + task.seller_cost) / 2
    scores = []

    for deal in results:
        if deal.outcome != DealOutcome.DEAL or deal.agreed_price is None:
            scores.append(0.0)
            continue
        surplus = task.buyer_budget - deal.agreed_price
        max_surplus = task.buyer_budget - task.seller_cost
        norm = max(0.0, surplus / max_surplus) if max_surplus > 0 else 0.0

        # Bonus for closing below midpoint (reading the bluff)
        if deal.agreed_price < midpoint:
            bluff_bonus = 0.15 * ((midpoint - deal.agreed_price) / (midpoint - task.seller_cost))
            norm = min(1.0, norm + bluff_bonus)

        scores.append(norm)

    return max(0.0, min(1.0, sum(scores) / max(len(scores), 1)))


def grade_amazon_realistic(results: list[DealRecord], task: TaskConfig) -> float:
    """Grader for real-listing tasks: relies on per-episode normalized_surplus
    (which uses the seller's episode cost, not the task's default cost)."""
    if not results:
        return 0.0
    deal = results[0]
    if deal.outcome != DealOutcome.DEAL:
        return 0.0
    return max(0.0, min(1.0, deal.normalized_surplus))


GRADERS = {
    "single_deal": grade_single_deal,
    "asymmetric_pressure": grade_asymmetric_pressure,
    "career_10": grade_career_10,
    "deceptive_seller": grade_personality_task,
    "impatient_seller": grade_personality_task,
    "collaborative_seller": grade_personality_task,
    "read_the_tells": grade_read_the_tells,
    "marketplace_arena": grade_personality_task,
    "amazon_realistic": grade_amazon_realistic,
}
