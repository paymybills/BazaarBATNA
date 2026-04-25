"""LLM-as-judge for negotiation transcripts.

Given two buyer rollouts on the same episode (same listing, same seller, same
seed), classifies which buyer played better.

Used to build DPO preference pairs (chosen, rejected) without human labelers.
This is technically RLAIF rather than RLHF, but the standard approach in
recent literature.

Default judge: Claude via the Anthropic API (cheap, strong at structured output).
Fallback: heuristic comparison on buyer_share if API key is missing.

Usage:
    from eval.judge import compare_rollouts

    label = compare_rollouts(
        listing={...}, brief={...},
        rollout_a=[{role, message, price, ...}, ...],
        rollout_b=[...],
    )
    # → {"winner": "a"|"b"|"tie", "reason": str}
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Literal


def _format_transcript(transcript: list[dict[str, Any]]) -> str:
    """Render a transcript for the judge prompt."""
    lines = []
    for turn in transcript:
        role = turn.get("role", "?")
        msg = str(turn.get("message", "")).strip()
        price = turn.get("price")
        action = turn.get("action")
        meta = []
        if action:
            meta.append(f"action={action}")
        if price is not None:
            meta.append(f"price=${price:.0f}")
        meta_s = f"  [{', '.join(meta)}]" if meta else ""
        lines.append(f"{role}: {msg}{meta_s}")
    return "\n".join(lines)


def _heuristic_compare(
    rollout_a: list[dict[str, Any]],
    rollout_b: list[dict[str, Any]],
    buyer_budget: float,
    seller_cost: float,
) -> dict[str, Any]:
    """Fallback when no API key: compare on buyer_share."""

    def share(rollout):
        # Agreed price: whoever (buyer or seller) emits action=accept first.
        # If buyer accepts → agreed is the most recent SELLER price (seller's
        # last counter that buyer agreed to). If seller accepts → agreed is
        # the most recent BUYER offer (buyer's last offer that seller accepted).
        agreed = None
        for i, t in enumerate(rollout):
            if t.get("action") != "accept":
                continue
            who = t.get("role")
            other = "seller" if who == "buyer" else "buyer"
            for prev in reversed(rollout[:i + 1]):
                if prev.get("role") == other and prev.get("price") is not None:
                    agreed = float(prev["price"])
                    break
            # Fallback: if accepter has a price, use it (some sellers emit
            # price on accept turn).
            if agreed is None and t.get("price") is not None:
                agreed = float(t["price"])
            break
        if agreed is None:
            return None
        zopa = buyer_budget - seller_cost
        if zopa <= 0:
            return None
        return (buyer_budget - agreed) / zopa

    sa, sb = share(rollout_a), share(rollout_b)

    if sa is None and sb is None:
        # Soft fallback: neither closed, but we can still rank by who pushed
        # the seller's final counter lower (= would have been a better deal).
        def final_seller_price(rollout):
            last = None
            for t in rollout:
                if t.get("role") == "seller" and t.get("price") is not None:
                    last = float(t["price"])
            return last
        pa, pb = final_seller_price(rollout_a), final_seller_price(rollout_b)
        if pa is None or pb is None:
            return {"winner": "tie", "reason": "Both rollouts failed to close, no seller prices."}
        if abs(pa - pb) < buyer_budget * 0.02:
            return {"winner": "tie", "reason": f"Both failed to close at similar prices: A=${pa:.0f}, B=${pb:.0f}"}
        if pa < pb:
            return {"winner": "a", "reason": f"Both failed to close, A drove seller lower (${pa:.0f} vs ${pb:.0f})"}
        return {"winner": "b", "reason": f"Both failed to close, B drove seller lower (${pb:.0f} vs ${pa:.0f})"}
    if sa is None:
        return {"winner": "b", "reason": "A failed to close, B closed."}
    if sb is None:
        return {"winner": "a", "reason": "B failed to close, A closed."}
    if abs(sa - sb) < 0.05:
        return {"winner": "tie", "reason": f"Close shares: A={sa:.2f}, B={sb:.2f}"}
    if sa > sb:
        return {"winner": "a", "reason": f"A captured more surplus ({sa:.2f} vs {sb:.2f})"}
    return {"winner": "b", "reason": f"B captured more surplus ({sb:.2f} vs {sa:.2f})"}


def _claude_compare(
    listing: dict[str, Any],
    brief: dict[str, Any],
    rollout_a: list[dict[str, Any]],
    rollout_b: list[dict[str, Any]],
    api_key: str,
    model: str = "claude-haiku-4-5",
) -> dict[str, Any]:
    """Use Claude to judge which buyer played better."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""You are judging two negotiation transcripts for the same listing.
Both buyers negotiated against the same seller. Pick which buyer played better.

A "better" buyer:
- Closed the deal (didn't walk or expire) — most important
- Captured more bargaining surplus (paid less, given seller's reservation)
- Pushed back on bluffs/urgency without folding
- Justified offers with concrete reasoning, not random numbers
- Did NOT capitulate immediately or give away their budget

LISTING: {listing.get('title', '?')} (asking ${brief.get('asking_price', '?')})
SELLER PERSONA: {brief.get('persona', 'default')}

=== ROLLOUT A ===
{_format_transcript(rollout_a)}

=== ROLLOUT B ===
{_format_transcript(rollout_b)}

Respond with JSON only:
{{"winner": "a" | "b" | "tie", "reason": "<one sentence explanation>"}}
"""

    resp = client.messages.create(
        model=model,
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.content[0].text.strip()
    # Extract JSON
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {"winner": "tie", "reason": f"judge parse failed: {text[:100]}"}
    try:
        parsed = json.loads(match.group(0))
        winner = parsed.get("winner", "tie").lower().strip()
        if winner not in {"a", "b", "tie"}:
            winner = "tie"
        return {"winner": winner, "reason": str(parsed.get("reason", ""))[:200]}
    except json.JSONDecodeError:
        return {"winner": "tie", "reason": "judge JSON parse failed"}


def compare_rollouts(
    listing: dict[str, Any],
    brief: dict[str, Any],
    rollout_a: list[dict[str, Any]],
    rollout_b: list[dict[str, Any]],
    *,
    judge: Literal["claude", "heuristic"] | None = None,
) -> dict[str, Any]:
    """Pick which of two transcripts shows better buyer play.

    Returns: {"winner": "a"|"b"|"tie", "reason": str}
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if judge is None:
        judge = "claude" if api_key else "heuristic"

    if judge == "claude" and api_key:
        try:
            return _claude_compare(listing, brief, rollout_a, rollout_b, api_key)
        except Exception as e:
            print(f"  ! Claude judge failed ({e}), falling back to heuristic")

    return _heuristic_compare(
        rollout_a, rollout_b,
        buyer_budget=float(brief.get("asking_price", 100)) * 1.05,
        seller_cost=float(brief.get("reservation_price", 78)),
    )
