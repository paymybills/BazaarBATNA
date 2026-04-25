"""LLM-backed seller. Stub — teammate will implement.

See docs/SELLER_HANDOFF.md for the full spec.
"""

from typing import Literal, TypedDict


class HistoryTurn(TypedDict):
    role: Literal["seller", "buyer"]
    message: str
    price: float | None


class SellerReply(TypedDict):
    message: str
    action: Literal["counter", "accept", "walk"]
    price: float | None


class LLMSeller:
    """Replace the body. Keep the signatures."""

    def __init__(
        self,
        listing: dict,
        role_brief: dict,
        model: str = "gemma2:9b",
    ):
        self.listing = listing
        self.role_brief = role_brief
        self.model = model

    def open(self) -> str:
        title = self.listing.get("title", "this item")
        price = self.role_brief.get("asking_price", "?")
        return f"Selling {title}. Asking ${price}. Serious offers only."

    def respond(
        self,
        history: list[HistoryTurn],
        buyer_message: str,
        buyer_offer: float | None,
    ) -> SellerReply:
        asking = self.role_brief.get("asking_price", 0)
        reservation = self.role_brief.get("reservation_price", asking * 0.78)

        if buyer_offer is None:
            return {
                "message": "Make me an actual offer.",
                "action": "counter",
                "price": asking,
            }
        if buyer_offer >= asking:
            return {"message": "Deal.", "action": "accept", "price": buyer_offer}
        if buyer_offer < reservation * 0.7:
            return {
                "message": "That's not even close. Pass.",
                "action": "walk",
                "price": None,
            }
        midpoint = (asking + buyer_offer) / 2
        return {
            "message": f"I can do ${midpoint:.0f}. That's where I'm at.",
            "action": "counter",
            "price": midpoint,
        }
