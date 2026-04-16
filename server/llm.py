"""Multi-provider LLM client for BazaarBot.

Supports 5 providers via a unified interface:
- OpenAI (GPT-4o, etc.)
- Anthropic/Claude (via Messages API)
- Google Gemini (via OpenAI-compatible endpoint)
- HuggingFace (via Inference API, OpenAI-compatible)
- xAI/Grok (via OpenAI-compatible endpoint)
"""

from __future__ import annotations

import json
import textwrap
from typing import Optional

import requests
from openai import OpenAI


# ── Provider configs ─────────────────────────────────────────────

PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": [
            "gpt-4o", "gpt-4o-mini",
            "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
            "o4-mini", "o3", "o3-mini",
            "gpt-4-turbo", "gpt-3.5-turbo",
        ],
        "openai_compatible": True,
    },
    "anthropic": {
        "name": "Anthropic (Claude)",
        "base_url": "https://api.anthropic.com/v1",
        "models": [
            "claude-opus-4-20250514",
            "claude-sonnet-4-20250514",
            "claude-sonnet-4-6-20250627",
            "claude-haiku-4-5-20251001",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
        ],
        "openai_compatible": False,
    },
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "models": [
            "gemini-2.5-pro-preview-05-06",
            "gemini-2.5-flash-preview-05-20",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
        ],
        "openai_compatible": True,
    },
    "huggingface": {
        "name": "HuggingFace",
        "base_url": "https://router.huggingface.co/v1",
        "models": [
            "Qwen/Qwen2.5-72B-Instruct",
            "Qwen/Qwen3-235B-A22B",
            "meta-llama/Llama-3.3-70B-Instruct",
            "meta-llama/Llama-4-Scout-17B-16E-Instruct",
            "mistralai/Mistral-Small-24B-Instruct-2501",
            "mistralai/Mixtral-8x7B-Instruct-v0.1",
            "deepseek-ai/DeepSeek-R1",
            "google/gemma-2-27b-it",
        ],
        "openai_compatible": True,
    },
    "grok": {
        "name": "xAI (Grok)",
        "base_url": "https://api.x.ai/v1",
        "models": [
            "grok-3",
            "grok-3-mini",
            "grok-2",
        ],
        "openai_compatible": True,
    },
}


# ── System prompt ────────────────────────────────────────────────

SYSTEM_PROMPT = textwrap.dedent("""\
You are a skilled buyer negotiating at an Indian bazaar. You must get the best price
while being strategic about timing and information.

RULES:
- You have a private budget. Never reveal it.
- The seller's opening price is inflated. Always negotiate down.
- You can: offer a price, accept the seller's price, or walk away.
- Closing early at a good price is better than grinding for a tiny discount.
- In career mode, the seller remembers your patterns. Vary your strategy.

STRATEGY GUIDELINES:
- Start with an offer around 40-50% of the asking price (anchor low).
- Increase offers gradually (5-10% steps).
- Watch the seller's concession speed -- if they're dropping fast, hold firm.
- If the seller barely moves, consider a larger jump to show good faith.
- Don't accept unless the price is well below your budget.
- Walking away is costly but better than overpaying massively.

TELLS TO WATCH:
- If seller has high "deception cue" and "instant" response speed, they may be bluffing.
- If seller's "fidget level" is high but they claim confidence, they're nervous.
- "Erratic" concession patterns suggest a deceptive seller -- hold firm.
- "Front-loaded" concessions mean an impatient seller -- you can wait them out.

OUTPUT FORMAT (strict JSON, nothing else):
{"action": "offer", "price": 35.0, "reasoning": "Anchoring low since seller opened high"}
{"action": "accept", "price": null, "reasoning": "Good deal below 55% of budget"}
{"action": "walk", "price": null, "reasoning": "Seller not budging, better to walk"}

Reply with ONLY the JSON. No explanation, no markdown, no extra text.
""")


def _build_user_prompt(obs: dict, history: list[str]) -> str:
    """Build user prompt from observation state."""
    history_block = "\n".join(history[-8:]) if history else "None"

    career_info = ""
    if obs.get("career_history"):
        ch = obs["career_history"]
        career_info = textwrap.dedent(f"""\
        --- Career History ---
        Episodes completed: {len(ch.get('deals', []))}
        Your capitulation rate: {ch.get('capitulation_rate', 0):.1%}
        Avg surplus captured: {ch.get('avg_normalized_surplus', 0):.1%}
        Avg rounds to close: {ch.get('avg_rounds_to_close', 0):.1f}
        """)

    tells_info = ""
    if obs.get("tells"):
        t = obs["tells"]
        tells_info = textwrap.dedent(f"""\
        --- Seller Tells (read these!) ---
        Verbal urgency: {t.get('verbal_urgency', 0):.0%}
        Confidence: {t.get('verbal_confidence', 0):.0%}
        Deception cue: {t.get('verbal_deception_cue', 0):.0%}
        Fidget level: {t.get('fidget_level', 0):.0%}
        Eye contact: {t.get('eye_contact', 'unknown')}
        Posture: {t.get('posture', 'unknown')}
        Offer speed: {t.get('offer_speed', 'unknown')}
        Concession pattern: {t.get('concession_pattern', 'unknown')}
        Emotional escalation: {t.get('emotional_escalation', 0):.0%}
        """)

    deadline_info = ""
    if obs.get("own_private_deadline"):
        deadline_info = f"YOUR HARD DEADLINE: Round {obs['own_private_deadline']} (seller doesn't know this!)\n"

    return textwrap.dedent(f"""\
    --- Negotiation State ---
    Item: {obs.get('item_name', 'item')}
    Round: {obs['current_round']} / {obs['max_rounds']}
    Rounds remaining: {obs['rounds_remaining']}
    Seller's current ask: {obs.get('opponent_last_offer', 'N/A')}
    Your last offer: {obs.get('own_last_offer', 'N/A')}
    Your private budget: {obs['own_private_budget']}
    Seller's opening price: {obs['seller_asking_price']}
    Seller personality: {obs.get('seller_personality', 'unknown')}
    {deadline_info}\
    Seller's last concession: {obs.get('seller_last_move_delta', 'N/A')} rupees
    Episode: {obs.get('episode_number', 1)} / {obs.get('total_episodes', 1)}

    {tells_info}\
    {career_info}\
    --- Recent History ---
    {history_block}

    Seller says: {obs.get('message', '')}

    Your move (JSON only):
    """)


def _parse_action(text: str, obs: dict) -> dict:
    """Parse LLM response into action dict."""
    # Strip markdown
    if "```" in text:
        text = text.split("```")[1].strip()
        if text.startswith("json"):
            text = text[4:].strip()
    # Find JSON
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        text = text[start:end]
    try:
        return json.loads(text)
    except Exception:
        # Fallback
        return {
            "action": "offer",
            "price": (obs.get("opponent_last_offer") or 50) * 0.7,
            "reasoning": f"[parse error, falling back] raw: {text[:100]}",
        }


# ── Unified call interface ───────────────────────────────────────

def call_llm(
    provider: str,
    api_key: str,
    model: Optional[str],
    obs: dict,
    history: list[str],
) -> dict:
    """Call an LLM provider and return parsed action + reasoning.

    Returns: {"action": str, "price": float|None, "reasoning": str, "raw": str}
    """
    config = PROVIDERS.get(provider)
    if not config:
        raise ValueError(f"Unknown provider: {provider}. Available: {list(PROVIDERS.keys())}")

    model = model or config["models"][0]
    user_prompt = _build_user_prompt(obs, history)

    if provider == "anthropic":
        return _call_anthropic(api_key, model, user_prompt)
    else:
        return _call_openai_compatible(config["base_url"], api_key, model, user_prompt)


def _call_openai_compatible(
    base_url: str, api_key: str, model: str, user_prompt: str
) -> dict:
    """Call any OpenAI-compatible endpoint."""
    client = OpenAI(base_url=base_url, api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=300,
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = _parse_action(raw, {})
        parsed["raw"] = raw
        return parsed
    except Exception as e:
        return {
            "action": "offer",
            "price": 30,
            "reasoning": f"[LLM error: {e}]",
            "raw": str(e),
        }


def _call_anthropic(api_key: str, model: str, user_prompt: str) -> dict:
    """Call Anthropic Messages API directly."""
    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 300,
                "system": SYSTEM_PROMPT,
                "messages": [
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.7,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data["content"][0]["text"].strip()
        parsed = _parse_action(raw, {})
        parsed["raw"] = raw
        return parsed
    except Exception as e:
        return {
            "action": "offer",
            "price": 30,
            "reasoning": f"[Anthropic error: {e}]",
            "raw": str(e),
        }
