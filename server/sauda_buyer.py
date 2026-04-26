"""Live Sauda buyer endpoints for the /sell page.

Two backends:
  - "hf"      → POST to a Hugging Face Inference Endpoint (production)
  - "ollama"  → POST to a local ollama server (fallback / dev)

Configuration via env-vars:
  SAUDA_BACKEND        — "hf" (default), "ollama", or "rule" (skip LLM)
  SAUDA_HF_URL         — full HF Inference Endpoint URL, e.g.
                         "https://abc123.us-east-1.aws.endpoints.huggingface.cloud"
  SAUDA_HF_TOKEN       — HF token with read access to the endpoint
  SAUDA_OLLAMA_URL     — ollama base URL (default http://localhost:11434)
  SAUDA_OLLAMA_MODEL   — ollama tag (default "bestdealbot")

Both paths render the buyer's observation through the same prompt the eval
harness uses (DEFAULT_SYSTEM_PROMPT + format_observation), parse the action
via parse_action, and apply the same Bayesian seller-tell steering as the
v2 evaluation runs. Result: the /sell page sees the exact same buyer the
research numbers are based on, just exposed over HTTP instead of in-process.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import requests

from bazaarbot_env import (
    DEFAULT_SYSTEM_PROMPT,
    format_observation,
    parse_action,
    steer_bayesian_action,
)


# ── Helpers ─────────────────────────────────────────────────────────


def _build_prompt(obs_dict: dict[str, Any]) -> tuple[str, str]:
    """Return (system, user) messages for chat-style backends."""
    return DEFAULT_SYSTEM_PROMPT, format_observation(obs_dict)


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int = 30) -> dict:
    resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


# ── HF Inference Endpoint backend ────────────────────────────────────


def _hf_chat(system: str, user: str, *, max_new_tokens: int = 96, temperature: float = 0.6) -> str:
    """POST to a HF Inference Endpoint serving a text-generation model.

    Endpoints accept either OpenAI-compatible chat completions OR HF native
    text-generation payloads depending on how they're deployed. We send the
    OpenAI-compatible shape first since modern HF endpoints support it.
    """
    url = os.environ.get("SAUDA_HF_URL", "").rstrip("/")
    token = os.environ.get("SAUDA_HF_TOKEN") or os.environ.get("HF_TOKEN")
    if not url or not token:
        raise RuntimeError("SAUDA_HF_URL and SAUDA_HF_TOKEN must be set")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Try OpenAI-compatible chat completions endpoint first
    chat_url = url + "/v1/chat/completions"
    chat_payload = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_new_tokens,
        "temperature": temperature,
        "top_p": 0.9,
    }
    try:
        data = _post_json(chat_url, chat_payload, headers)
        return data["choices"][0]["message"]["content"]
    except Exception:
        pass

    # Fall back to HF native text-generation
    payload = {
        "inputs": f"{system}\n\n{user}\n",
        "parameters": {
            "max_new_tokens": max_new_tokens,
            "temperature": temperature,
            "top_p": 0.9,
            "return_full_text": False,
        },
    }
    data = _post_json(url, payload, headers)
    if isinstance(data, list) and data and "generated_text" in data[0]:
        return data[0]["generated_text"]
    if isinstance(data, dict) and "generated_text" in data:
        return data["generated_text"]
    raise RuntimeError(f"Unexpected HF endpoint response shape: {str(data)[:200]}")


# ── Ollama backend ───────────────────────────────────────────────────


def _ollama_chat(system: str, user: str, *, max_new_tokens: int = 96, temperature: float = 0.6) -> str:
    """POST to a local ollama server."""
    host = os.environ.get("SAUDA_OLLAMA_URL", "http://localhost:11434").rstrip("/")
    model = os.environ.get("SAUDA_OLLAMA_MODEL", "bestdealbot")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {
            "temperature": temperature,
            "top_p": 0.9,
            "num_predict": max_new_tokens,
        },
    }
    data = _post_json(f"{host}/api/chat", payload, {}, timeout=60)
    return data.get("message", {}).get("content", "")


# ── Public entrypoint ────────────────────────────────────────────────


def sauda_action(
    obs_dict: dict[str, Any],
    *,
    backend: Optional[str] = None,
    use_steering: bool = True,
) -> dict[str, Any]:
    """Get a buyer action from Sauda v2.

    Returns dict with keys: action ("offer"|"accept"|"walk"), price (float|None),
    message (str), backend (str echoing which path served), error (str if any).

    Never raises — falls back to a conservative offer if the LLM is unreachable
    or returns garbage. The /sell page is interactive and a 500 mid-demo is
    worse than a dumb fallback.
    """
    chosen = (backend or os.environ.get("SAUDA_BACKEND") or "hf").lower()
    system, user = _build_prompt(obs_dict)

    text = ""
    err: Optional[str] = None
    served_by = chosen
    try:
        if chosen == "hf":
            text = _hf_chat(system, user)
        elif chosen == "ollama":
            text = _ollama_chat(system, user)
        elif chosen == "rule":
            text = ""  # forces fallback path below
        else:
            raise RuntimeError(f"unknown SAUDA_BACKEND: {chosen}")
    except Exception as e:
        err = f"{chosen} backend failed: {type(e).__name__}: {str(e)[:160]}"
        served_by = f"{chosen}+fallback"

    fallback_price = float(obs_dict.get("own_private_budget") or 100) * 0.3
    if text:
        action = parse_action(text, fallback_price=fallback_price)
        action.pop("_parse_error", None)
    else:
        # Conservative rule-based fallback: open at 35% of ask, escalate by round.
        ask = float(obs_dict.get("seller_asking_price") or obs_dict.get("opponent_last_offer") or 100)
        rnd = int(obs_dict.get("current_round") or 0)
        last = obs_dict.get("own_last_offer")
        if last is None:
            price = round(ask * 0.35, 2)
        else:
            price = round(float(last) + (ask - float(last)) * 0.25, 2)
        action = {"action": "offer", "price": price, "message": ""}

    if use_steering:
        try:
            action = steer_bayesian_action(obs_dict, action)
        except Exception:
            pass

    out: dict[str, Any] = {
        "action": str(action.get("action", "offer")),
        "price": action.get("price"),
        "message": action.get("message") or "",
        "backend": served_by,
    }
    if err:
        out["error"] = err
    return out


def health() -> dict[str, Any]:
    """Quick reachability probe for both backends. Used by /sauda/health."""
    out: dict[str, Any] = {
        "active_backend": (os.environ.get("SAUDA_BACKEND") or "hf").lower(),
        "hf_configured": bool(os.environ.get("SAUDA_HF_URL")) and bool(
            os.environ.get("SAUDA_HF_TOKEN") or os.environ.get("HF_TOKEN")
        ),
        "ollama_url": os.environ.get("SAUDA_OLLAMA_URL", "http://localhost:11434"),
        "ollama_model": os.environ.get("SAUDA_OLLAMA_MODEL", "bestdealbot"),
    }
    # Probe HF (skip if not configured)
    if out["hf_configured"]:
        try:
            url = os.environ["SAUDA_HF_URL"].rstrip("/")
            token = os.environ.get("SAUDA_HF_TOKEN") or os.environ["HF_TOKEN"]
            r = requests.get(url + "/health", headers={"Authorization": f"Bearer {token}"}, timeout=5)
            out["hf_ok"] = r.status_code < 500
            out["hf_status"] = r.status_code
        except Exception as e:
            out["hf_ok"] = False
            out["hf_error"] = f"{type(e).__name__}: {str(e)[:120]}"
    # Probe Ollama
    try:
        host = out["ollama_url"]
        r = requests.get(f"{host}/api/tags", timeout=3)
        out["ollama_ok"] = r.status_code == 200
        if r.status_code == 200:
            tags = [m.get("name", "") for m in r.json().get("models", [])]
            out["ollama_has_model"] = out["ollama_model"] in tags or any(
                t.startswith(out["ollama_model"]) for t in tags
            )
    except Exception as e:
        out["ollama_ok"] = False
        out["ollama_error"] = f"{type(e).__name__}: {str(e)[:120]}"
    return out
