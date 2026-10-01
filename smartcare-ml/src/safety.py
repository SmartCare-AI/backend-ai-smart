"""Safety layer — explicit clinical rules that wrap the ML models.

Mirror of the NestJS rules engine (src/ai/providers/rules.provider.ts):
the same red-flag keywords and the same risk floors. The models may raise
a risk level; they can never lower one that a rule set.
"""

import json
from dataclasses import dataclass
from functools import lru_cache

from .paths import RED_FLAGS
from .textutil import normalize

RISK_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"]

SEVERE_WORDS = ["severe", "unbearable", "worst", "extreme", "شديد", "لا يحتمل", "قوي جدا"]


def max_risk(a: str, b: str) -> str:
    return a if RISK_ORDER.index(a) >= RISK_ORDER.index(b) else b


@dataclass(frozen=True)
class RedFlag:
    label: str
    specialty: str
    keywords: tuple[str, ...]


@lru_cache(maxsize=1)
def load_red_flags() -> tuple[RedFlag, ...]:
    raw = json.loads(RED_FLAGS.read_text(encoding="utf-8"))
    return tuple(
        RedFlag(f["label"], f["specialty"], tuple(normalize(k) for k in f["keywords"]))
        for f in raw
    )


def check_red_flags(*texts: str) -> list[RedFlag]:
    """Presentations that warrant emergency care regardless of anything else.

    Substring matching, like the NestJS engine — over-triggering is the safe
    direction for an emergency rule.
    """
    haystack = " \n ".join(normalize(t) for t in texts if t)
    return [f for f in load_red_flags() if any(k in haystack for k in f.keywords)]


def has_severe_word(text: str) -> bool:
    haystack = normalize(text)
    return any(normalize(w) in haystack for w in SEVERE_WORDS)


def is_vulnerable_age(age: float | None) -> bool:
    return age is not None and (age >= 65 or age <= 5)


def rule_floor(
    n_symptoms: int, severe: bool, age: float | None, has_chronic: bool
) -> tuple[str, list[str]]:
    """Minimum risk level from the non-red-flag rules, with the reasons why."""
    risk = "LOW"
    reasons: list[str] = []
    if severe:
        risk = max_risk(risk, "HIGH")
        reasons.append("Symptoms described as severe.")
    if n_symptoms >= 3:
        risk = max_risk(risk, "MODERATE")
        reasons.append(f"{n_symptoms} symptoms reported at once.")
    if is_vulnerable_age(age):
        risk = max_risk(risk, "MODERATE")
        reasons.append(f"Patient age ({age:g}) is a vulnerable group.")
    if has_chronic:
        risk = max_risk(risk, "MODERATE")
        reasons.append("Chronic conditions on record.")
    return risk, reasons
