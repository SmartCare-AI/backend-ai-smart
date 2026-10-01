"""Tabular feature builder for the risk model.

One code path for training and serving: free text in, a fixed-length numeric
vector out. Symptoms are recognized by phrase-matching against the vocabulary
of the Disease Symptom Prediction dataset, whose severity weights (1–7) are
the core signal, alongside patient context and the specialty model's output.
"""

import re

from .safety import has_severe_word, is_vulnerable_age
from .textutil import normalize

# Everyday wording → vocabulary symptom (names as in the dataset, spaces not underscores).
ALIASES = {
    "fever": "mild fever",
    "temperature": "mild fever",
    "stomach ache": "stomach pain",
    "stomachache": "stomach pain",
    "tummy pain": "stomach pain",
    "throwing up": "vomiting",
    "vomit": "vomiting",
    "diarrhea": "diarrhoea",
    "short of breath": "breathlessness",
    "shortness of breath": "breathlessness",
    "difficulty breathing": "breathlessness",
    "tired": "fatigue",
    "tiredness": "fatigue",
    "exhausted": "fatigue",
    "dizzy": "dizziness",
    "rash": "skin rash",
    "itchy": "itching",
    "itch": "itching",
    "palpitation": "palpitations",
    "racing heart": "fast heart rate",
    "sore throat": "throat irritation",
    "blurry vision": "blurred and distorted vision",
    "blurred vision": "blurred and distorted vision",
    "burning urination": "burning micturition",
    "frequent urination": "polyuria",
    "coughing": "cough",
    "sneezing": "continuous sneezing",
    "stuffy nose": "congestion",
    "body pain": "muscle pain",
    "body ache": "muscle pain",
    "weakness on one side": "weakness of one body side",
    "blood in stool": "bloody stool",
    "yellow skin": "yellowish skin",
    "yellow eyes": "yellowing of eyes",
    "no appetite": "loss of appetite",
    "swollen joints": "swelling joints",
    "pimples": "pus filled pimples",
    "headaches": "headache",
    "rashes": "skin rash",
    "feverish": "mild fever",
    "nauseous": "nausea",
    "perspiring": "sweating",
    "sweaty": "sweating",
    "acid reflux": "acidity",
    "heartburn": "acidity",
    "neck hurts": "neck pain",
    "trouble breathing": "breathlessness",
    "hard to breathe": "breathlessness",
    "lost my appetite": "loss of appetite",
    "lost appetite": "loss of appetite",
    "lost weight": "weight loss",
    "losing weight": "weight loss",
    "gained weight": "weight gain",
    "mucus": "phlegm",
    "muscle aches": "muscle pain",
    "muscle ache": "muscle pain",
    "painful urination": "burning micturition",
    "watery eyes": "watering from eyes",
    "red eyes": "redness of eyes",
    "anxious": "anxiety",
    "depressed": "depression",
    "constipated": "constipation",
    "dehydrated": "dehydration",
    "bruises": "bruising",
    "blisters": "blister",
    "cramp": "cramps",
}

BASE_FEATURES = [
    "n_matched",
    "weight_sum",
    "weight_max",
    "weight_mean",
    "severity_level",
    "duration_days",
    "duration_known",
    "age",
    "age_known",
    "age_vulnerable",
    "has_chronic",
]

_NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "couple of": 2, "few": 3, "several": 4,
}
_UNIT_DAYS = {"hour": 1 / 24, "hr": 1 / 24, "day": 1, "week": 7, "wk": 7, "month": 30, "year": 365, "yr": 365}
_DURATION = re.compile(
    r"\b(\d+(?:\.\d+)?|" + "|".join(_NUMBER_WORDS) + r")\s*(hour|hr|day|week|wk|month|year|yr)s?\b"
)


def clean_symptom(name: str) -> str:
    """'dischromic _patches' → 'dischromic patches'."""
    return re.sub(r"[\s_]+", " ", name).strip().lower()


def severity_level(*texts: str | None) -> int:
    """0 unknown · 1 mild · 2 moderate · 3 severe (highest mentioned wins)."""
    haystack = normalize(" ".join(t for t in texts if t))
    if has_severe_word(haystack):
        return 3
    if "moderate" in haystack:
        return 2
    if "mild" in haystack:
        return 1
    return 0


def parse_duration_days(*texts: str | None) -> float | None:
    """Longest duration mentioned, in days: '2 hours' → 0.083, 'a week' → 7."""
    haystack = normalize(" ".join(t for t in texts if t))
    days = [
        float(_NUMBER_WORDS.get(amount, amount if amount[0].isdigit() else 1)) * _UNIT_DAYS[unit]
        for amount, unit in _DURATION.findall(haystack)
    ]
    if "yesterday" in haystack:
        days.append(1.0)
    return max(days) if days else None


class FeatureExtractor:
    def __init__(self, symptom_weights: dict[str, int], specialties: list[str]):
        self.weights = dict(symptom_weights)
        self.vocab = sorted(self.weights)
        self.specialties = list(specialties)
        self.feature_names = (
            BASE_FEATURES
            + [f"specialty:{s}" for s in self.specialties]
            + [f"has:{s}" for s in self.vocab]
        )
        phrases = {s: s for s in self.vocab}
        phrases.update({a: s for a, s in ALIASES.items() if s in self.weights})
        self._patterns = [
            (re.compile(r"\b" + re.escape(phrase) + r"\b"), symptom)
            for phrase, symptom in phrases.items()
        ]

    def match(self, english_text: str) -> set[str]:
        """Vocabulary symptoms mentioned in (already English) text."""
        haystack = normalize(english_text)
        return {symptom for pattern, symptom in self._patterns if pattern.search(haystack)}

    def vector(
        self,
        english_text: str,
        severity: int,
        duration_days: float | None,
        age: float | None,
        has_chronic: bool,
        specialty_proba,
    ) -> list[float]:
        """`specialty_proba`: the specialty model's probabilities for this text,
        in `self.specialties` order — which body system is involved is a
        strong hint of how urgent a symptom profile is."""
        matched = self.match(english_text)
        weights = [self.weights[s] for s in matched]
        base = [
            len(matched),
            sum(weights),
            max(weights, default=0),
            sum(weights) / len(weights) if weights else 0.0,
            severity,
            duration_days if duration_days is not None else -1.0,
            float(duration_days is not None),
            age if age is not None else -1.0,
            float(age is not None),
            float(is_vulnerable_age(age)),
            float(has_chronic),
        ]
        return base + [float(p) for p in specialty_proba] + [float(s in matched) for s in self.vocab]
