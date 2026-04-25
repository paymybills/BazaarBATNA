"""NLP Tell Extractor — reads seller utterances, returns TellObservation.

Uses a local Ollama model (default: gemma4:e2b) to extract structured signals
from free-text seller messages. Output schema matches TellObservation in
bazaarbot_env/models.py — same fields, same ranges.

The extractor runs as a post-processing step after the seller speaks. For the
rule-based seller it's a cross-check; for the LLM seller it's the primary
tell source.

Usage:
    from nlp.extractor import TellExtractor
    extractor = TellExtractor()
    tells = extractor.extract("bhai last price hai, kal se badhega", history=[...])

Standalone test:
    python nlp/extractor.py
"""

from __future__ import annotations

import json
import re
import textwrap
from typing import Optional
import requests


OLLAMA_URL = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "ministral-3:3b"

# ── Condition vocabulary ──────────────────────────────────────────

# eBay standardized grades → (condition_score, depreciation_score, label)
CONDITION_GRADES: list[tuple[list[str], float, float, str]] = [
    (
        ["new", "sealed", "mint", "mib", "mint in box", "brand new", "unused",
         "box band", "seal pack", "sealed pack", "never opened", "factory sealed"],
        1.0, 0.0, "new",
    ),
    (
        ["like new", "open box", "barely used", "3 months", "6 months",
         "thoda use", "thoda sa use", "bilkul sahi", "almost new", "excellent"],
        0.85, 0.10, "like_new",
    ),
    (
        ["very good", "vgc", "minor scratch", "ek chhota scratch", "small scratch",
         "light scratch", "minor wear", "slight", "good condition"],
        0.70, 0.25, "very_good",
    ),
    (
        ["good", "guc", "some scratches", "few scratches", "normal wear",
         "works perfectly", "fully functional", "theek kaam", "sahi kaam"],
        0.55, 0.40, "good",
    ),
    (
        ["acceptable", "heavy scratch", "dent", "battery low", "battery thodi kam",
         "screen crack", "needs repair", "rough", "worn", "purana hai"],
        0.35, 0.60, "acceptable",
    ),
    (
        ["for parts", "broken", "dead", "not working", "kharab", "kaam nahi karta",
         "damaged", "junk"],
        0.10, 0.90, "junk",
    ),
]


def _condition_from_text(text: str) -> tuple[float, float, str]:
    """Rule-based fast pass for condition signals before LLM extraction."""
    lower = text.lower()
    for keywords, score, dep, label in CONDITION_GRADES:
        for kw in keywords:
            if kw in lower:
                return score, dep, label
    return 1.0, 0.0, "unknown"


# ── Hinglish few-shot examples for the extractor prompt ──────────

HINGLISH_FEW_SHOTS = """
Utterance: "bhai last price hai, kal se price badhega"
Tells: {"verbal_urgency": 0.75, "verbal_confidence": 0.6, "verbal_deception_cue": 0.5, "offer_speed": "instant", "concession_pattern": "stalling", "emotional_escalation": 0.3, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "unknown"}

Utterance: "ek chhota sa scratch hai screen pe, baaki sab bilkul theek hai"
Tells: {"verbal_urgency": 0.1, "verbal_confidence": 0.6, "verbal_deception_cue": 0.2, "offer_speed": "deliberate", "concession_pattern": "steady", "emotional_escalation": 0.0, "condition_score": 0.7, "depreciation_score": 0.25, "condition_label": "very_good"}

Utterance: "abhi teen aur log dekh rahe hain, aaj hi lena padega"
Tells: {"verbal_urgency": 0.8, "verbal_confidence": 0.7, "verbal_deception_cue": 0.75, "offer_speed": "instant", "concession_pattern": "stalling", "emotional_escalation": 0.4, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "unknown"}

Utterance: "battery thodi kam hai, 79% hai, magar charger ke saath deta hoon"
Tells: {"verbal_urgency": 0.2, "verbal_confidence": 0.5, "verbal_deception_cue": 0.1, "offer_speed": "deliberate", "concession_pattern": "steady", "emotional_escalation": 0.0, "condition_score": 0.35, "depreciation_score": 0.6, "condition_label": "acceptable"}

Utterance: "box band hai, seal packed, maine khola bhi nahi"
Tells: {"verbal_urgency": 0.1, "verbal_confidence": 0.8, "verbal_deception_cue": 0.0, "offer_speed": "normal", "concession_pattern": "steady", "emotional_escalation": 0.0, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "new"}
""".strip()

# Chicago HAI examples (English formal negotiations)
CHICAGO_FEW_SHOTS = """
Utterance: "I have another buyer coming in an hour, this is my final offer"
Tells: {"verbal_urgency": 0.7, "verbal_confidence": 0.75, "verbal_deception_cue": 0.65, "offer_speed": "instant", "concession_pattern": "stalling", "emotional_escalation": 0.3, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "unknown"}

Utterance: "Minor scratches on the back, fully functional, battery health 81%"
Tells: {"verbal_urgency": 0.1, "verbal_confidence": 0.6, "verbal_deception_cue": 0.15, "offer_speed": "deliberate", "concession_pattern": "steady", "emotional_escalation": 0.0, "condition_score": 0.55, "depreciation_score": 0.4, "condition_label": "good"}

Utterance: "Okay fine, I can do 4500, but that is absolutely the lowest I'll go"
Tells: {"verbal_urgency": 0.5, "verbal_confidence": 0.55, "verbal_deception_cue": 0.3, "offer_speed": "deliberate", "concession_pattern": "front_loaded", "emotional_escalation": 0.35, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "unknown"}

Utterance: "MIB, never opened, still has the plastic wrap on it"
Tells: {"verbal_urgency": 0.1, "verbal_confidence": 0.85, "verbal_deception_cue": 0.0, "offer_speed": "normal", "concession_pattern": "steady", "emotional_escalation": 0.0, "condition_score": 1.0, "depreciation_score": 0.0, "condition_label": "new"}
""".strip()


EXTRACTION_SYSTEM_PROMPT = textwrap.dedent(f"""\
    You extract structured negotiation signals from a seller's message.
    Output ONLY a single valid JSON object. No prose, no markdown, no explanation.

    Output schema (all fields required):
    {{
      "verbal_urgency": <0.0–1.0, how desperate/pressured the seller sounds>,
      "verbal_confidence": <0.0–1.0, how assertive/firm the seller sounds>,
      "verbal_deception_cue": <0.0–1.0, signs of bluffing: social proof claims, fake scarcity, over-justification>,
      "offer_speed": <"instant"|"normal"|"deliberate">,
      "concession_pattern": <"steady"|"front_loaded"|"stalling"|"erratic">,
      "emotional_escalation": <0.0–1.0, how emotionally charged the message is>,
      "condition_score": <0.0–1.0, item condition from 0=junk to 1=mint. 1.0 if no condition info>,
      "depreciation_score": <0.0–1.0, wear/damage level. 0.0 if no condition info>,
      "condition_label": <"new"|"like_new"|"very_good"|"good"|"acceptable"|"junk"|"unknown">
    }}

    Calibration rules:
    - Social proof ("another buyer", "3 log dekh rahe", "bahut demand hai") → verbal_deception_cue ≥ 0.6
    - "Final price", "last offer", "bilkul nahi jaaunga" → verbal_confidence ≥ 0.7
    - Time pressure claims ("kal se badhega", "aaj hi") → verbal_urgency ≥ 0.65
    - Condition disclosures lower condition_score from 1.0; no disclosure = keep 1.0
    - "Firm" language = verbal_confidence ≥ 0.75; "Soft/flexible" = ≤ 0.35

    Examples (Hinglish):
    {HINGLISH_FEW_SHOTS}

    Examples (English):
    {CHICAGO_FEW_SHOTS}
""")

DEFAULT_TELL = {
    "verbal_urgency": 0.2,
    "verbal_confidence": 0.5,
    "verbal_deception_cue": 0.0,
    "offer_speed": "normal",
    "concession_pattern": "steady",
    "emotional_escalation": 0.0,
    "condition_score": 1.0,
    "depreciation_score": 0.0,
    "condition_label": "unknown",
}

VALID_OFFER_SPEEDS = {"instant", "normal", "deliberate"}
VALID_CONCESSION_PATTERNS = {"steady", "front_loaded", "stalling", "erratic"}
VALID_CONDITION_LABELS = {"new", "like_new", "very_good", "good", "acceptable", "junk", "unknown"}


def _clamp(v, lo=0.0, hi=1.0) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return (lo + hi) / 2


def _parse_extraction(raw: str) -> dict:
    """Parse JSON from LLM output, clamp ranges, fill missing fields."""
    s = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    if "```" in s:
        parts = s.split("```")
        s = parts[1].lstrip("json").strip() if len(parts) >= 2 else s
    start, end = s.find("{"), s.rfind("}") + 1
    if start >= 0 and end > start:
        s = s[start:end]
    try:
        parsed = json.loads(s)
    except Exception:
        return dict(DEFAULT_TELL)

    out = dict(DEFAULT_TELL)
    out["verbal_urgency"] = _clamp(parsed.get("verbal_urgency", out["verbal_urgency"]))
    out["verbal_confidence"] = _clamp(parsed.get("verbal_confidence", out["verbal_confidence"]))
    out["verbal_deception_cue"] = _clamp(parsed.get("verbal_deception_cue", out["verbal_deception_cue"]))
    out["emotional_escalation"] = _clamp(parsed.get("emotional_escalation", out["emotional_escalation"]))
    out["condition_score"] = _clamp(parsed.get("condition_score", out["condition_score"]))
    out["depreciation_score"] = _clamp(parsed.get("depreciation_score", out["depreciation_score"]))

    speed = parsed.get("offer_speed", "normal")
    out["offer_speed"] = speed if speed in VALID_OFFER_SPEEDS else "normal"

    pattern = parsed.get("concession_pattern", "steady")
    out["concession_pattern"] = pattern if pattern in VALID_CONCESSION_PATTERNS else "steady"

    label = parsed.get("condition_label", "unknown")
    out["condition_label"] = label if label in VALID_CONDITION_LABELS else "unknown"

    return out


class TellExtractor:
    """Extracts TellObservation fields from seller free text via Ollama."""

    def __init__(self, model: str = DEFAULT_MODEL, ollama_url: str = OLLAMA_URL):
        self.model = model
        self.ollama_url = ollama_url

    def _call_ollama(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 256},
        }
        try:
            resp = requests.post(self.ollama_url, json=payload, timeout=120)
            resp.raise_for_status()
            return resp.json().get("response", "")
        except Exception as e:
            print(f"[extractor] Ollama call failed: {e}")
            return ""

    def extract(
        self,
        message: str,
        history: Optional[list[str]] = None,
        fast: bool = False,
    ) -> dict:
        """Extract tell signals from a seller utterance.

        Args:
            message: the seller's current utterance
            history: last N turns as strings (for context)
            fast: if True, skip LLM and use rule-based condition extraction only
                  (useful during GRPO rollouts where latency matters)

        Returns:
            dict matching TellObservation field names
        """
        # Fast path: rule-based condition extraction, defaults for everything else
        cond_score, dep_score, cond_label = _condition_from_text(message)
        if fast:
            result = dict(DEFAULT_TELL)
            result["condition_score"] = cond_score
            result["depreciation_score"] = dep_score
            result["condition_label"] = cond_label
            return result

        history_block = ""
        if history:
            recent = history[-3:]
            history_block = "\nRecent conversation:\n" + "\n".join(recent) + "\n"

        user_prompt = (
            f"{history_block}"
            f'\nSeller says: "{message}"\n\n'
            "Extract tells as JSON:"
        )

        full_prompt = EXTRACTION_SYSTEM_PROMPT + "\n\n" + user_prompt
        raw = self._call_ollama(full_prompt)

        if not raw:
            result = dict(DEFAULT_TELL)
            result["condition_score"] = cond_score
            result["depreciation_score"] = dep_score
            result["condition_label"] = cond_label
            return result

        result = _parse_extraction(raw)

        # Rule-based condition always wins over LLM for condition fields.
        # Keyword matching on explicit condition phrases ("minor scratches",
        # "box band", "MIB") is more reliable than LLM inference for this
        # narrow vocabulary. LLM is better at urgency/deception where context
        # and tone matter more than keyword lookup.
        if cond_label != "unknown":
            result["condition_score"] = cond_score
            result["depreciation_score"] = dep_score
            result["condition_label"] = cond_label

        return result

    def batch_extract(self, messages: list[str]) -> list[dict]:
        return [self.extract(m) for m in messages]


# ── Standalone test ───────────────────────────────────────────────

TEST_UTTERANCES = [
    # Hinglish urgency + social proof (deceptive)
    "bhai last price hai, abhi teen aur log dekh rahe hain",
    # Hinglish condition disclosure
    "ek chhota sa scratch hai screen pe, battery 81% hai, baaki sab theek",
    # Hinglish sealed
    "box band hai, seal packed, maine kabhi khola nahi",
    # English deceptive pressure
    "I have another buyer coming in an hour, this is my absolute final offer",
    # English condition
    "Minor scratches on the back panel, fully functional, screen is perfect",
    # English collaborative
    "Look, I'll be honest with you — I paid 8000 for it, I just need 6500 to break even",
    # eBay lingo
    "MIB, never opened, still has factory seal",
    # Impatient
    "6000. Yes or no. I don't have all day.",
]

if __name__ == "__main__":
    extractor = TellExtractor()
    print(f"Using model: {extractor.model}\n")
    print("=" * 60)

    for utt in TEST_UTTERANCES:
        print(f"Utterance: {utt}")
        tells = extractor.extract(utt)
        print(f"  urgency={tells['verbal_urgency']:.2f}  "
              f"confidence={tells['verbal_confidence']:.2f}  "
              f"deception={tells['verbal_deception_cue']:.2f}  "
              f"speed={tells['offer_speed']}")
        print(f"  condition={tells['condition_label']}  "
              f"score={tells['condition_score']:.2f}  "
              f"depreciation={tells['depreciation_score']:.2f}")
        print()
