"""Python port of the NestJS rules engine's specialty + risk logic.

Two uses: the baseline the trained models are compared against in
evaluate.py, and the keyword routing the engine falls back on when the
specialty model is unsure.
"""

import json
import re
from functools import lru_cache

from .paths import SPECIALTY_KEYWORDS
from .safety import check_red_flags, has_severe_word, rule_floor
from .textutil import normalize

DEFAULT_SPECIALTY = "internal medicine"


@lru_cache(maxsize=1)
def _specialty_rules() -> tuple[tuple[str, tuple[str, ...]], ...]:
    raw = json.loads(SPECIALTY_KEYWORDS.read_text(encoding="utf-8"))
    return tuple(
        (r["specialty"], tuple(normalize(k) for k in r["keywords"])) for r in raw
    )


def reachable_specialties() -> set[str]:
    """Every specialty the rules engine is able to answer."""
    return {specialty for specialty, _ in _specialty_rules()} | {DEFAULT_SPECIALTY}


def rules_specialty(text: str) -> str:
    """Exactly what the NestJS engine does: first rule with a substring hit."""
    haystack = normalize(text)
    for specialty, keywords in _specialty_rules():
        if any(k in haystack for k in keywords):
            return specialty
    return DEFAULT_SPECIALTY


def rules_risk(
    text: str, n_symptoms: int, age: float | None, has_chronic: bool
) -> str:
    if check_red_flags(text):
        return "CRITICAL"
    return rule_floor(n_symptoms, has_severe_word(text), age, has_chronic)[0]


@lru_cache(maxsize=1)
def _keyword_patterns() -> tuple[tuple[re.Pattern, int, str], ...]:
    patterns = []
    for specialty, keywords in _specialty_rules():
        for keyword in keywords:
            # English keywords are stems ("urin", "dizz"): anchor them to the
            # start of a word. Arabic words carry glued prefixes, so those
            # stay plain substring matches.
            anchor = r"\b" if keyword.isascii() else ""
            patterns.append((re.compile(anchor + re.escape(keyword)), len(keyword), specialty))
    return tuple(patterns)


def keyword_specialty(text: str) -> str | None:
    """Keyword routing for the engine: same table, stricter matching.

    Plain first-substring matching sends "heartburn" to cardiology ("heart")
    and "pain during…" to urology ("urin"). Here a keyword must start a word
    and the longest matching keyword wins.
    """
    haystack = normalize(text)
    best: tuple[int, str] | None = None
    for pattern, length, specialty in _keyword_patterns():
        if (best is None or length > best[0]) and pattern.search(haystack):
            best = (length, specialty)
    return best[1] if best else None
