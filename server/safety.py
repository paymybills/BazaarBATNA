"""Cost & abuse defenses for the live Sauda HF Inference Endpoint.

The /sell page is exposed to the public during the demo window. A bot loop on
/seller-mode/step would burn HF tokens unbounded. This module gates every HF
call behind:

  1. Hard daily call cap (HF only — ollama/rule are unmetered locally).
  2. Per-IP sliding-window rate limit.
  3. Global concurrent-in-flight cap.
  4. Circuit breaker: if HF errors N times in a row, lock to fallback for K min.
  5. Prompt-size cap (anti-prompt-injection ballooning).

When a gate trips, we silently downgrade to the next backend (ollama → rule).
We never tell the user "you've been rate limited" — the UI just sees a slightly
slower or simpler buyer. The internals are surfaced via /sauda/health for ops.

Counters persist to disk (`runs/safety_state.json`) so a restart doesn't reset
the daily cap and let an attacker get a fresh budget.

All gates default to permissive numbers tuned for "live demo, ~50 humans poking
at it for an hour"; tighten via env-vars for production.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

# ── Tunables ──────────────────────────────────────────────────────────

# Hard cap on total HF calls per UTC day. Trip → flip to ollama for the rest of
# the day. Default 1500 ≈ ~$3-5 of a10g-small at typical token sizes.
MAX_HF_CALLS_PER_DAY = int(os.environ.get("SAUDA_HF_MAX_CALLS_PER_DAY", "1500"))

# Per-IP sliding-window. (window_seconds, max_calls) tuples.
IP_LIMITS: list[tuple[int, int]] = [
    (60,    int(os.environ.get("SAUDA_RL_PER_MIN", "30"))),
    (3600,  int(os.environ.get("SAUDA_RL_PER_HOUR", "200"))),
    (86400, int(os.environ.get("SAUDA_RL_PER_DAY",  "500"))),
]

# Max concurrent in-flight HF calls. Excess gets ollama immediately.
MAX_CONCURRENT_HF = int(os.environ.get("SAUDA_MAX_CONCURRENT_HF", "4"))

# Circuit breaker: trip after N consecutive HF errors, stay tripped for K seconds.
CB_ERROR_THRESHOLD = int(os.environ.get("SAUDA_CB_ERRORS", "3"))
CB_COOLDOWN_SEC    = int(os.environ.get("SAUDA_CB_COOLDOWN", "300"))

# Reject prompts longer than this many chars (anti-injection ballooning).
MAX_PROMPT_CHARS = int(os.environ.get("SAUDA_MAX_PROMPT_CHARS", "4000"))

STATE_FILE = Path(os.environ.get("SAUDA_SAFETY_STATE", "runs/safety_state.json"))


# ── Internal state ────────────────────────────────────────────────────

_lock = threading.Lock()

# IP → deque[float timestamps]
_ip_calls: dict[str, deque[float]] = {}

# Global concurrency counter.
_inflight = 0

# Circuit breaker state.
_consecutive_errors = 0
_cb_open_until: float = 0.0

# Daily counter: { "utc_date": "YYYY-MM-DD", "calls": int }
_daily = {"utc_date": "", "calls": 0}

# Total spend trace for ops (resets on restart, not safety-critical).
_lifetime = {"hf_calls": 0, "hf_errors": 0, "ollama_calls": 0, "rule_calls": 0,
             "blocked_daily": 0, "blocked_ip": 0, "blocked_concurrency": 0,
             "blocked_circuit": 0, "blocked_prompt": 0}


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _load_state() -> None:
    global _daily
    if not STATE_FILE.exists():
        return
    try:
        data = json.loads(STATE_FILE.read_text())
        if isinstance(data, dict) and data.get("utc_date") == _today():
            _daily = {"utc_date": data["utc_date"], "calls": int(data.get("calls", 0))}
    except Exception:
        pass


def _persist_state() -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(_daily))
    except Exception:
        pass


_load_state()


# ── Public API ────────────────────────────────────────────────────────


class HFCallDenied(Exception):
    """Raised when a safety gate refuses an HF call. Caller should fall back."""
    def __init__(self, reason: str, gate: str):
        super().__init__(reason)
        self.reason = reason
        self.gate = gate


def check_prompt_size(text: str) -> None:
    """Reject prompts that are too large to be plausibly normal."""
    if len(text) > MAX_PROMPT_CHARS:
        with _lock:
            _lifetime["blocked_prompt"] += 1
        raise HFCallDenied(
            f"prompt {len(text)} chars > cap {MAX_PROMPT_CHARS}",
            gate="prompt_size",
        )


def acquire_hf_slot(client_ip: Optional[str] = None) -> None:
    """Check all gates and reserve an in-flight slot for an HF call.

    Caller MUST call `release_hf_slot(success=...)` after the call (in finally).
    Raises HFCallDenied if any gate trips.
    """
    global _inflight
    now = time.time()
    today = _today()

    with _lock:
        # 1) Roll over daily counter at UTC midnight.
        if _daily["utc_date"] != today:
            _daily["utc_date"] = today
            _daily["calls"] = 0
            _persist_state()

        # 2) Daily hard cap.
        if _daily["calls"] >= MAX_HF_CALLS_PER_DAY:
            _lifetime["blocked_daily"] += 1
            raise HFCallDenied(
                f"daily HF cap {MAX_HF_CALLS_PER_DAY} reached",
                gate="daily_cap",
            )

        # 3) Circuit breaker.
        if now < _cb_open_until:
            _lifetime["blocked_circuit"] += 1
            raise HFCallDenied(
                f"circuit breaker open for {int(_cb_open_until - now)}s more",
                gate="circuit_breaker",
            )

        # 4) Concurrency.
        if _inflight >= MAX_CONCURRENT_HF:
            _lifetime["blocked_concurrency"] += 1
            raise HFCallDenied(
                f"concurrent in-flight cap {MAX_CONCURRENT_HF} reached",
                gate="concurrency",
            )

        # 5) Per-IP sliding windows.
        if client_ip:
            dq = _ip_calls.setdefault(client_ip, deque())
            for window_s, max_calls in IP_LIMITS:
                cutoff = now - window_s
                while dq and dq[0] < cutoff:
                    dq.popleft()
                count_in_window = sum(1 for t in dq if t >= cutoff)
                if count_in_window >= max_calls:
                    _lifetime["blocked_ip"] += 1
                    raise HFCallDenied(
                        f"ip {client_ip} hit {max_calls}/{window_s}s",
                        gate=f"ip_rate_{window_s}s",
                    )
            dq.append(now)

        # All gates passed — reserve.
        _inflight += 1
        _daily["calls"] += 1
        _lifetime["hf_calls"] += 1
        # Persist every 10 calls to keep disk writes cheap but bounded.
        if _daily["calls"] % 10 == 0:
            _persist_state()


def release_hf_slot(success: bool) -> None:
    """Mark an in-flight HF call done. `success` updates the circuit breaker."""
    global _inflight, _consecutive_errors, _cb_open_until
    with _lock:
        _inflight = max(0, _inflight - 1)
        if success:
            _consecutive_errors = 0
        else:
            _consecutive_errors += 1
            _lifetime["hf_errors"] += 1
            if _consecutive_errors >= CB_ERROR_THRESHOLD:
                _cb_open_until = time.time() + CB_COOLDOWN_SEC


def note_fallback(kind: str) -> None:
    """Track non-HF backend usage (for /sauda/health stats)."""
    with _lock:
        if kind == "ollama":
            _lifetime["ollama_calls"] += 1
        elif kind == "rule":
            _lifetime["rule_calls"] += 1


def stats() -> dict[str, Any]:
    """Snapshot of safety state, surfaced via /sauda/health (ops use only)."""
    with _lock:
        now = time.time()
        return {
            "daily": dict(_daily),
            "daily_cap": MAX_HF_CALLS_PER_DAY,
            "inflight": _inflight,
            "concurrency_cap": MAX_CONCURRENT_HF,
            "circuit_breaker_open": now < _cb_open_until,
            "circuit_breaker_open_for_s": max(0, int(_cb_open_until - now)),
            "consecutive_errors": _consecutive_errors,
            "lifetime": dict(_lifetime),
            "ip_limits": [{"window_s": w, "max_calls": n} for w, n in IP_LIMITS],
            "tracked_ips": len(_ip_calls),
        }
