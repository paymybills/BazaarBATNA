"""Task configurations and graders for BazaarBot."""

from __future__ import annotations

from .models import DealOutcome, DealRecord, TaskConfig


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
}


# ── Graders ───────────────────────────────────────────────────────

def grade_single_deal(results: list[DealRecord], task: TaskConfig) -> float:
    """Grade single deal: (budget - agreed_price) / (budget - cost), clamped [0,1]. 0 on walk/no-deal."""
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
    """Grade asymmetric: surplus_score * deadline_bonus.

    deadline_bonus = 1.0 if closed before round 5, 0.5 if after, 0 if walk.
    """
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
    """Grade career: mean normalized surplus over 10 episodes, weighted by round efficiency."""
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

        # Round efficiency: deals closed faster score higher
        efficiency = max(0.0, 1.0 - (deal.rounds_taken / rounds_per_ep) * 0.3)
        weighted_scores.append(norm_surplus * efficiency)

    score = sum(weighted_scores) / max(len(weighted_scores), 1)
    return max(0.0, min(1.0, score))


GRADERS = {
    "single_deal": grade_single_deal,
    "asymmetric_pressure": grade_asymmetric_pressure,
    "career_10": grade_career_10,
}
