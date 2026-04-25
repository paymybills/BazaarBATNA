"""Keyword/phrase patterns for inline span-level tell highlighting.

Used by the /highlight endpoint to show users which exact phrases in their
message triggered which tell signal — Grammarly-style underlining in the
chat bubble.

Patterns mined from data/indian_negotiations.jsonl seller turns by strategy.
Hand-curated and grouped by tell signal:

    urgency:   "kal se", "abhi", "jaldi", "today only", "final price"
    deception: "teen aur log dekh rahe", "other buyers", "kabhi nahi"
    confidence: "market rate", "best price", "fixed price"
    condition: "box pack", "scratch", "battery 81%", "abhi naya"

Each pattern has:
    - regex (case-insensitive, word-bounded where useful)
    - signal it triggers (urgency / deception / confidence / condition)
    - score it adds to that signal (0-1)
    - one-line explanation shown in the hover card

The frontend uses these to wrap matched spans in <mark> tags.
"""

from __future__ import annotations

import re
from typing import Literal, NamedTuple

Signal = Literal["urgency", "deception", "confidence", "condition"]


class Pattern(NamedTuple):
    pattern: re.Pattern[str]
    signal: Signal
    score: float
    explanation: str
    """Human-readable label for the hover card."""


def _p(regex: str, signal: Signal, score: float, explanation: str) -> Pattern:
    return Pattern(re.compile(regex, re.IGNORECASE), signal, score, explanation)


PATTERNS: list[Pattern] = [
    # ── URGENCY ──────────────────────────────────────────────────
    _p(r"\bkal\s+se\b", "urgency", 0.6, "Time pressure: 'price changes tomorrow'"),
    _p(r"\babhi\b(?!\s+nahi)", "urgency", 0.4, "Hindi 'right now' — pushes immediate decision"),
    _p(r"\bjaldi\b", "urgency", 0.6, "Hindi 'quickly' — explicit urgency"),
    _p(r"\btoday\s+only\b", "urgency", 0.7, "Time pressure: limited window"),
    _p(r"\bfinal\s+price\b", "urgency", 0.5, "Anchoring: 'this is final, no negotiation'"),
    _p(r"\blast\s+price\b", "urgency", 0.5, "Anchoring: claims this is the bottom"),
    _p(r"\bfix(?:ed)?\s+(?:hai|price)\b", "urgency", 0.4, "Position commitment: 'price is fixed'"),
    _p(r"\bno\s+(?:more\s+)?negotiation\b", "urgency", 0.7, "Closes the door on further bargaining"),
    _p(r"\btime\s+waste\b", "urgency", 0.5, "Impatience signal"),
    _p(r"\bimmediately\b", "urgency", 0.4, "Demands same-instant action"),
    _p(r"\bsend\s+(?:the\s+)?money\b", "urgency", 0.5, "Pushing toward immediate transaction"),

    # ── DECEPTION ────────────────────────────────────────────────
    # The classic: "teen aur log dekh rahe" (three other people are looking)
    _p(r"\bteen\s+aur\s+log\b", "deception", 0.8,
       "External-incentive bluff: claims multiple competing buyers (CaSiNo deception cue)"),
    _p(r"\bother\s+(?:people|buyers?)\s+(?:are\s+)?looking\b", "deception", 0.8,
       "External-incentive bluff: claims competing buyers"),
    _p(r"\bothers\s+are\s+looking\b", "deception", 0.8, "External-incentive bluff"),
    _p(r"\bkoi\s+aur\s+(?:buyer|log)\b", "deception", 0.7, "Claims another buyer is interested"),
    _p(r"\baur\s+log\s+(?:bhi\s+)?dekh\b", "deception", 0.7, "Claims more people watching"),
    _p(r"\bdemand\s+(?:zyada|high)\b", "deception", 0.4, "Claims market demand to justify price"),
    _p(r"\bmarket\s+(?:mein\s+)?(?:bahut\s+)?demand\b", "deception", 0.4, "Claims market demand"),
    _p(r"\bbest\s+price\b", "deception", 0.3, "Self-praise — soft anchoring"),

    # ── CONFIDENCE ───────────────────────────────────────────────
    _p(r"\bmarket\s+rate\b", "confidence", 0.6, "Confidence: anchoring to external price reference"),
    _p(r"\bmarket\s+mein\s+iski\b", "confidence", 0.5, "Confidence: market positioning"),
    _p(r"\bnahi\s+ho(?:\s+payega)?\b", "confidence", 0.6, "Firm refusal: 'won't happen'"),
    _p(r"\bmushkil\s+hai\b", "confidence", 0.4, "Mild firmness: 'difficult'"),
    _p(r"\bisse\s+(?:upar|kam)\s+nahi\b", "confidence", 0.7, "Hard floor/ceiling commitment"),
    _p(r"\bnot?\s+(?:lower|higher)\b", "confidence", 0.6, "Position commitment"),

    # ── CONDITION ────────────────────────────────────────────────
    _p(r"\bbox\s+(?:band|pack|sealed?)\b", "condition", 0.95, "Item is sealed / new in box"),
    _p(r"\bseal\s+packed?\b", "condition", 0.95, "New, factory-sealed"),
    _p(r"\babhi\s+box\s+se\s+nikala\b", "condition", 0.9, "Just unboxed — like new"),
    _p(r"\b(?:bilkul\s+)?naya\b", "condition", 0.85, "Hindi 'brand new'"),
    _p(r"\b(?:like\s+new|mint)\b", "condition", 0.85, "Like-new condition"),
    _p(r"\bbarely\s+used\b", "condition", 0.8, "Lightly used"),
    _p(r"\bek\s+(?:chhota\s+)?scratch\b", "condition", 0.55, "Minor scratch — visible wear"),
    _p(r"\b(?:minor\s+)?scratch(?:es)?\b", "condition", 0.55, "Minor cosmetic damage"),
    _p(r"\bdent\b", "condition", 0.5, "Dent — moderate wear"),
    _p(r"\bchip(?:ped)?\b", "condition", 0.5, "Chipped — visible damage"),
    _p(r"\bscreen\s+(?:replaced|change)\b", "condition", 0.35,
       "Screen replacement — depreciation indicator"),
    _p(r"\bbattery\s+(?:health\s+)?(\d{2,3})\s*%?\b", "condition", 0.4,
       "Battery health disclosure — wear indicator"),
    _p(r"\b(\d{1,2})\s*(?:saal|year)s?\s+(?:purana|old)\b", "condition", 0.5,
       "Age disclosure"),
    _p(r"\bkabhi\s+giraya\s+nahi\b", "condition", 0.85, "Never dropped — careful owner"),
    _p(r"\boriginal\s+(?:box|charger|warranty)\b", "condition", 0.75,
       "Has original accessories"),
    _p(r"\bwarranty\b", "condition", 0.7, "Has warranty"),
    _p(r"\bperfect\s+condition\b", "condition", 0.85, "Perfect condition claim"),
    _p(r"\bworking\s+condition\b", "condition", 0.7, "Functional but unspecified wear"),
]


class Match(NamedTuple):
    start: int
    end: int
    text: str
    signal: Signal
    score: float
    explanation: str


def find_matches(message: str) -> list[Match]:
    """Find all pattern matches in `message`. Returns char-offset spans."""
    matches: list[Match] = []
    for pat in PATTERNS:
        for m in pat.pattern.finditer(message):
            matches.append(
                Match(
                    start=m.start(),
                    end=m.end(),
                    text=m.group(0),
                    signal=pat.signal,
                    score=pat.score,
                    explanation=pat.explanation,
                )
            )
    return matches


def aggregate_signals(matches: list[Match]) -> dict[str, float]:
    """Roll up per-signal max score across matches."""
    rolled: dict[str, float] = {}
    for m in matches:
        rolled[m.signal] = max(rolled.get(m.signal, 0.0), m.score)
    return rolled
