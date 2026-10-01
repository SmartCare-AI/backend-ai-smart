"""Text normalization and the offline Arabic → English dictionary pass.

The models are English-only. Arabic input is translated word-by-word (longest
phrase first) with a small hand-curated dictionary before inference — no
network call, no translation model.
"""

import json
import re
from functools import lru_cache

from .paths import AR_EN_DICTIONARY

_AR_DIACRITICS = re.compile(r"[ً-ْٰـ]")
_AR_ALEF = re.compile(r"[أإآٱ]")
_AR_WORD = re.compile(r"^[ء-ي]+$")
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_PUNCT = re.compile(r"([،؛؟,.;:!?()\[\]\n\r/-])")
_PAIN_IN = re.compile(r"\bpain in (?:the |my )?([a-z]+)\b")

# Clitics glued to an Arabic word: "and the", "with the", "the", "and"...
_AR_PREFIXES = ("وال", "بال", "لل", "ال", "و", "ب", "ل")
_MAX_PHRASE = 4


def normalize_arabic(text: str) -> str:
    """Fold spelling variants so 'ألم' / 'الم' and 'حكة' / 'حكه' compare equal."""
    text = _AR_DIACRITICS.sub("", text)
    text = _AR_ALEF.sub("ا", text)
    return text.replace("ى", "ي").replace("ة", "ه").translate(_AR_DIGITS)


def normalize(text: str) -> str:
    """Lowercase, straighten apostrophes, fold Arabic variants, squeeze spaces."""
    text = text.lower().replace("’", "'").replace("_", " ")
    return re.sub(r"\s+", " ", normalize_arabic(text)).strip()


@lru_cache(maxsize=1)
def _dictionary() -> dict[str, str]:
    raw = json.loads(AR_EN_DICTIONARY.read_text(encoding="utf-8"))
    return {normalize(ar): en for ar, en in raw.items()}


def _lookup_word(word: str, table: dict[str, str]) -> str | None:
    """Single Arabic word: exact, then minus a prefix clitic and/or 'my' suffix."""
    if word in table:
        return table[word]
    candidates = [word]
    for prefix in _AR_PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) >= 2:
            candidates.append(word[len(prefix):])
    for candidate in candidates:
        if candidate in table:
            return table[candidate]
        if candidate.endswith("ي") and candidate[:-1] in table:
            return table[candidate[:-1]]
    return None


def to_english(text: str) -> str:
    """Dictionary pass. English text passes through unchanged (normalized)."""
    table = _dictionary()
    tokens = _PUNCT.sub(r" \1 ", normalize(text)).split()
    out: list[str] = []
    i = 0
    while i < len(tokens):
        if not _AR_WORD.match(tokens[i]):
            out.append(tokens[i])
            i += 1
            continue
        for size in range(min(_MAX_PHRASE, len(tokens) - i), 1, -1):
            phrase = " ".join(tokens[i : i + size])
            if phrase in table:
                out.append(table[phrase])
                i += size
                break
        else:
            # Unknown Arabic words are kept: harmless to TF-IDF, and red-flag
            # matching on the raw text still sees them.
            out.append(_lookup_word(tokens[i], table) or tokens[i])
            i += 1
    english = " ".join(out)
    # Arabic word order: "pain in knee" → "knee pain" (how the training data says it).
    return _PAIN_IN.sub(r"\1 pain", english)
