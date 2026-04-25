"""LLM-backed seller for BazaarBATNA.

Implements docs/SELLER_HANDOFF.md interface:
    LLMSeller(listing, role_brief, model).open() -> str
    LLMSeller(...).respond(history, buyer_message, buyer_offer) -> SellerReply

Designed to run on a single 16GB GPU (Kaggle T4) at 4-bit. Default model is
Gemma-3-4B-Instruct (~3GB at 4-bit), which fits with headroom. Larger models
(e.g. gemma-2-9b-it) work too on T4 at 4-bit.

Hard rules enforced in code (not just prompt):
    1. Never accept below reservation
    2. Never leak reservation price in messages
    3. Counter offers always >= reservation
    4. Counter must improve on previous counter (monotone toward buyer)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal, TypedDict


class HistoryTurn(TypedDict):
    role: Literal["seller", "buyer"]
    message: str
    price: float | None


class SellerReply(TypedDict):
    message: str
    action: Literal["counter", "accept", "walk"]
    price: float | None


# ── Persona prompt fragments ────────────────────────────────────────
PERSONA_GUIDANCE = {
    "default": "Stay balanced. Concede in moderate steps. Justify price with item details.",
    "firm": "Concede slowly. Defend your asking price with specific details from the listing.",
    "flexible": "Be warm and willing to deal, but still profit-seeking — don't capitulate.",
    "deceptive": "Use bluffs about other interested buyers and time pressure to push the price up.",
}


# ── Lazy model bundle cache ─────────────────────────────────────────
@dataclass
class _Bundle:
    tokenizer: Any
    model: Any


_MODEL_CACHE: dict[str, _Bundle] = {}


def _load_bundle(model_name: str) -> _Bundle:
    """Load + cache a 4-bit quantized model. Lazy import keeps the file usable
    on machines without torch installed (e.g. lint, doc generation)."""
    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    torch.backends.cuda.matmul.allow_tf32 = True

    tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    kwargs: dict[str, Any] = {"device_map": "auto", "trust_remote_code": True}
    if torch.cuda.is_available():
        kwargs["torch_dtype"] = torch.bfloat16
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    else:
        kwargs["torch_dtype"] = torch.float32

    model = AutoModelForCausalLM.from_pretrained(model_name, **kwargs)
    model.config.use_cache = True

    bundle = _Bundle(tokenizer=tokenizer, model=model)
    _MODEL_CACHE[model_name] = bundle
    return bundle


# ── Helpers ─────────────────────────────────────────────────────────
def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace("$", "").replace(",", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _extract_json(text: str) -> dict[str, Any] | None:
    """Best-effort JSON parser for LLM output."""
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        return None
    raw = match.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Common failure modes: single quotes, trailing commas
        s = raw.replace("'", '"')
        s = re.sub(r",\s*\}", "}", s)
        s = re.sub(r",\s*\]", "]", s)
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return None


def _chat(
    model_name: str,
    system: str,
    user: str,
    max_new_tokens: int = 200,
    temperature: float = 0.3,
) -> str:
    import torch

    bundle = _load_bundle(model_name)
    tok = bundle.tokenizer

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    if hasattr(tok, "apply_chat_template"):
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    else:
        prompt = f"[SYSTEM]\n{system}\n\n[USER]\n{user}\n\n[ASSISTANT]\n"

    inputs = tok(prompt, return_tensors="pt", truncation=True, max_length=2048).to(bundle.model.device)
    gen_kwargs: dict[str, Any] = {
        "max_new_tokens": max_new_tokens,
        "pad_token_id": tok.eos_token_id,
    }
    if temperature > 0:
        gen_kwargs.update({"do_sample": True, "temperature": temperature, "top_p": 0.9})
    else:
        gen_kwargs["do_sample"] = False

    with torch.inference_mode():
        out = bundle.model.generate(**inputs, **gen_kwargs)
    new_tokens = out[0][inputs["input_ids"].shape[1]:]
    return tok.decode(new_tokens, skip_special_tokens=True).strip()


def generate_structured_reply(
    model: str,
    system: str,
    user: str,
    max_new_tokens: int = 200,
    temperature: float = 0.3,
) -> dict[str, Any] | None:
    """Public helper used by eval/seller_quality.py for the persona judge."""
    return _extract_json(_chat(model, system, user, max_new_tokens, temperature))


# ── LLMSeller ───────────────────────────────────────────────────────
class LLMSeller:
    """Gemma-backed seller with hard reservation/leak guards."""

    def __init__(
        self,
        listing: dict,
        role_brief: dict,
        model: str = "google/gemma-4-E4B",
    ):
        self.listing = listing
        self.role_brief = role_brief
        self.model = model

        self.title = str(listing.get("title") or "this item")
        self.category = str(listing.get("category") or "item")
        desc = listing.get("description") or ""
        if isinstance(desc, list):
            desc = " ".join(str(x) for x in desc)
        self.description = str(desc)[:1400]  # cap for prompt budget

        asking = _to_float(role_brief.get("asking_price"))
        if asking is None:
            asking = _to_float(listing.get("price")) or 100.0
        self.asking = float(asking)

        reservation = _to_float(role_brief.get("reservation_price"))
        if reservation is None:
            reservation = self.asking * 0.78
        self.reservation = max(1.0, min(float(reservation), self.asking * 0.97))

        persona = str(role_brief.get("persona", "default")).lower().strip()
        self.persona = persona if persona in PERSONA_GUIDANCE else "default"

        self._last_counter = self.asking

    # ── Prompt construction ─────────────────────────────────────
    def _system_prompt(self) -> str:
        return (
            "You are a Craigslist seller negotiating with a buyer. "
            "Stay grounded in the listing — only reference details from it. "
            "Never reveal your reservation price or minimum. "
            "Never accept below your reservation. "
            "Keep replies short and human (1-3 sentences). "
            f"Persona: {self.persona}. {PERSONA_GUIDANCE[self.persona]}\n\n"
            f"LISTING TITLE: {self.title}\n"
            f"CATEGORY: {self.category}\n"
            f"DESCRIPTION: {self.description}\n"
            f"ASKING PRICE: {self.asking:.2f}\n"
        )

    # ── Sanitization & guards ───────────────────────────────────
    def _sanitize(self, text: str) -> str:
        text = (text or "").strip()
        if not text:
            text = "I'm open to serious offers, but not at that price."
        # Redact any leak of the reservation price
        for token in {f"{self.reservation:.2f}", f"{self.reservation:.1f}", f"{self.reservation:.0f}"}:
            text = re.sub(rf"\b{re.escape(token)}\b", "my minimum", text)
        if len(text) > 320:
            text = text[:317].rstrip() + "..."
        return text

    def _next_counter(self, buyer_offer: float | None) -> float:
        """Concede toward buyer but never below reservation."""
        if buyer_offer is None:
            return round(max(self.reservation, self._last_counter), 2)
        gap = max(0.0, self._last_counter - buyer_offer)
        step = max(self.asking * 0.03, gap * 0.35)
        candidate = max(self._last_counter - step, self.reservation)
        return round(candidate, 2)

    def _heuristic_reply(self, buyer_offer: float | None) -> SellerReply:
        if buyer_offer is None:
            return {"message": "What's your offer?", "action": "counter", "price": round(self._last_counter, 2)}
        if buyer_offer >= self.asking:
            return {"message": "Sounds good. Deal.", "action": "accept", "price": round(buyer_offer, 2)}
        if buyer_offer < self.reservation * 0.8:
            return {"message": "That's too low for this listing.", "action": "walk", "price": None}
        counter = self._next_counter(buyer_offer)
        self._last_counter = counter
        return {"message": f"I can do {counter:.0f}.", "action": "counter", "price": counter}

    # ── Public API ──────────────────────────────────────────────
    def open(self) -> str:
        parsed = generate_structured_reply(
            self.model,
            self._system_prompt(),
            'Output JSON only: {"message": "<one short opening line>"}.',
            max_new_tokens=120,
            temperature=0.4,
        )
        if parsed and isinstance(parsed.get("message"), str):
            return self._sanitize(parsed["message"])
        return self._sanitize(f"Selling {self.title} at {self.asking:.0f}.")

    def respond(
        self,
        history: list[HistoryTurn],
        buyer_message: str,
        buyer_offer: float | None,
    ) -> SellerReply:
        fallback = self._heuristic_reply(buyer_offer)

        # Compact recent history for the prompt
        lines = []
        for turn in history[-8:]:
            who = turn.get("role", "buyer")
            msg = str(turn.get("message", "")).strip()
            px = turn.get("price")
            px_part = "" if px is None else f" [${float(px):.2f}]"
            lines.append(f"{who}: {msg}{px_part}")
        history_block = "\n".join(lines) if lines else "(empty)"

        user_prompt = (
            'Return JSON only: {"message": str, "action": "counter|accept|walk", "price": number|null}.\n\n'
            f"Conversation:\n{history_block}\n\n"
            f"Buyer just said: {buyer_message}\n"
            f"Buyer offer: {buyer_offer}\n\n"
            "Rules: never accept below reservation; never reveal reservation; stay grounded in the listing."
        )

        parsed = generate_structured_reply(
            self.model,
            self._system_prompt(),
            user_prompt,
            max_new_tokens=240,
            temperature=0.35,
        )

        if not parsed:
            out: dict[str, Any] = dict(fallback)
        else:
            action = str(parsed.get("action", fallback["action"])).lower().strip()
            if action not in {"counter", "accept", "walk"}:
                action = fallback["action"]
            message = self._sanitize(str(parsed.get("message", fallback["message"])))
            price = _to_float(parsed.get("price"))
            out = {"message": message, "action": action, "price": price}

        # ── Hard guards ──────────────────────────────────────────
        if out["action"] == "accept":
            accept_at = buyer_offer if buyer_offer is not None else _to_float(out.get("price"))
            if accept_at is None or float(accept_at) < self.reservation:
                # Block illegal accept; rewrite as a counter
                out["action"] = "counter"
                out["price"] = self._next_counter(buyer_offer)
                out["message"] = self._sanitize(f"Can't go that low. I can do {out['price']:.0f}.")
            else:
                out["price"] = round(float(accept_at), 2)

        elif out["action"] == "counter":
            price = _to_float(out.get("price"))
            if price is None:
                price = self._next_counter(buyer_offer)
            price = max(float(price), self.reservation)

            # Counter must improve on buyer's offer (otherwise just accept it)
            if buyer_offer is not None and price <= float(buyer_offer):
                if float(buyer_offer) >= self.reservation:
                    out["action"] = "accept"
                    out["price"] = round(float(buyer_offer), 2)
                    out["message"] = self._sanitize("Alright, let's do it.")
                else:
                    price = max(self.reservation, float(buyer_offer) + max(1.0, self.asking * 0.02))
                    out["price"] = round(float(price), 2)
            else:
                out["price"] = round(float(price), 2)

            self._last_counter = float(out["price"])

        else:  # walk
            out["price"] = None

        out["message"] = self._sanitize(str(out["message"]))
        return out  # type: ignore[return-value]
