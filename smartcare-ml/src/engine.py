"""Triage engine: safety rules → specialty model → risk model → response.

Kept free of FastAPI so it can be unit-tested and evaluated directly.
"""

import re
from dataclasses import dataclass

import joblib
import numpy as np

from .features import FeatureExtractor, parse_duration_days, severity_level
from .paths import RISK_MODEL, SPECIALTY_MODEL
from .rules_baseline import DEFAULT_SPECIALTY, keyword_specialty
from .safety import check_red_flags, max_risk, rule_floor
from .textutil import to_english

# Below this probability the specialty model is treated as "unsure". On the
# held-out test set ~1% of predictions fall below it.
MIN_SPECIALTY_CONFIDENCE = 0.30

# 99% of the training descriptions are longer than this many words; anything
# shorter is "short input", where keyword rules are consulted first — unless
# it lists at least CHECKLIST_ITEMS separate symptoms.
SHORT_INPUT_WORDS = 8
CHECKLIST_ITEMS = 3
_WORD = re.compile(r"[^\W\d_]+")

# Red-flag rules always win, and the risk model may ALSO declare an emergency
# when no red-flag keyword matched — so ML can add emergencies, never remove
# one. The original plan left this to the rules alone; it was switched on
# after measuring what that missed (reports/metrics.md, "Emergencies without
# a red flag").
ML_MAY_DECLARE_EMERGENCY = True

EMERGENCY_ADVICE = (
    "Your symptoms may be serious. Call emergency services (123 in Egypt) "
    "or press the SOS button now."
)


def _is_short(complaint: str) -> bool:
    # A checklist of several symptoms is evidence the models were trained on,
    # however few words it takes.
    n_items = sum(1 for part in complaint.split(",") if part.strip())
    return len(_WORD.findall(complaint)) <= SHORT_INPUT_WORDS and n_items < CHECKLIST_ITEMS


@dataclass
class Symptom:
    name: str
    duration: str | None = None
    severity: str | None = None


class TriageEngine:
    def __init__(
        self,
        specialty_model,
        risk_bundle: dict,
        ml_may_declare_emergency: bool = ML_MAY_DECLARE_EMERGENCY,
    ):
        self.ml_may_declare_emergency = ml_may_declare_emergency
        self.specialty_model = specialty_model
        self.risk_model = risk_bundle["model"]
        self.extractor = FeatureExtractor(
            risk_bundle["symptom_weights"], risk_bundle["specialties"]
        )
        if list(specialty_model.classes_) != self.extractor.specialties:
            raise RuntimeError(
                "risk.joblib was trained against a different specialty model — "
                "rerun `python -m src.train_risk`."
            )

    @classmethod
    def load(cls) -> "TriageEngine":
        return cls(joblib.load(SPECIALTY_MODEL), joblib.load(RISK_MODEL))

    @property
    def specialties(self) -> list[str]:
        return list(self.specialty_model.classes_)

    def top_terms(self, text: str, specialty: str, k: int = 3) -> list[str]:
        """The words that pushed the linear model toward `specialty`."""
        tfidf = self.specialty_model.named_steps["tfidf"]
        clf = self.specialty_model.named_steps["clf"]
        row = list(clf.classes_).index(specialty)
        contribution = tfidf.transform([text]).multiply(clf.coef_[row]).toarray()[0]
        best = np.argsort(contribution)[::-1][:k]
        names = tfidf.get_feature_names_out()
        return [names[i] for i in best if contribution[i] > 0]

    def choose_specialty(self, complaint: str, raw: str, proba) -> tuple[str, str]:
        """(specialty, reason): arbitrate between the model and keyword rules.

        The model learned from full descriptions; a two-word complaint is
        outside what it has seen, and there the keyword rules are more
        reliable (see "Short inputs" in reports/metrics.md). So:
          descriptive input → model, then keywords, then the default;
          short input       → keywords, then model, then the default.
        """
        tfidf = self.specialty_model.named_steps["tfidf"]
        known_words = tfidf.transform([complaint]).nnz > 0
        best = int(proba.argmax())
        guess, confidence = self.specialty_model.classes_[best], float(proba[best])
        model_ok = known_words and confidence >= MIN_SPECIALTY_CONFIDENCE
        # Prefer the translation: Arabic keywords are substring matches and looser.
        keyword = keyword_specialty(complaint) or keyword_specialty(raw)
        is_short = _is_short(complaint)

        if model_ok and not (is_short and keyword):
            reason = f"Model confidence {confidence:.2f} for {guess}"
            terms = self.top_terms(complaint, guess)
            if terms:
                reason += f" (key terms: {', '.join(terms)})"
            return guess, reason + "."
        if keyword:
            why = "Short description" if model_ok else f"Model unsure (confidence {confidence:.2f})"
            return keyword, f"{why} — keyword rule suggests {keyword}."
        return DEFAULT_SPECIALTY, (
            f"Model unsure (confidence {confidence:.2f}) and no keyword rule matched — "
            f"defaulting to {DEFAULT_SPECIALTY}."
        )

    def assess_risk(self, complaint: str, vector: list[float]) -> tuple[str, str]:
        """(level, reason) from the risk model, before the rule floor is applied.

        The model was trained on full descriptions, so it is only trusted
        with the upper levels when it gets one:
          nothing it recognizes → no opinion (the rule floor decides);
          short input           → MODERATE at most;
          full description      → any level, CRITICAL if the switch allows.
        Rules are unaffected: a red flag or "severe" still raises any input.
        """
        tfidf = self.specialty_model.named_steps["tfidf"]
        if not self.extractor.match(complaint) and tfidf.transform([complaint]).nnz == 0:
            return "LOW", "The risk model recognizes none of the words used — level set by the rules alone."

        proba = self.risk_model.predict_proba([vector])[0]
        predicted = self.risk_model.classes_[int(proba.argmax())]
        confidence = float(proba.max())
        if predicted in ("HIGH", "CRITICAL") and _is_short(complaint):
            return "MODERATE", (
                f"Risk model leaned {predicted}, but a short description is not enough to call "
                "it urgent — reported as MODERATE."
            )
        if predicted == "CRITICAL":
            if self.ml_may_declare_emergency:
                return "CRITICAL", (
                    "No red-flag keyword matched, but the risk model recognizes a possibly "
                    f"life-threatening picture (confidence {confidence:.2f})."
                )
            return "HIGH", (
                "Risk model flagged a possibly critical picture — reported as HIGH "
                "because only red-flag rules may declare an emergency."
            )
        return predicted, f"Risk model predicted {predicted} (confidence {confidence:.2f})."

    def route(self, text: str) -> str:
        """Specialty routing only, without the red-flag override (for evaluate.py)."""
        complaint = to_english(text)
        proba = self.specialty_model.predict_proba([complaint])[0]
        return self.choose_specialty(complaint, text, proba)[0]

    def triage(
        self,
        symptoms: list[Symptom],
        age: float | None = None,
        chronic_diseases: str | None = None,
        notes: str | None = None,
    ) -> dict:
        notes = notes or ""
        # Same haystack as the NestJS engine, plus its English translation so
        # Arabic phrasings outside the keyword list are still caught.
        raw = " \n ".join([f"{s.name} {s.severity or ''}" for s in symptoms] + [notes])
        english = to_english(raw)
        complaint = to_english(" , ".join([s.name for s in symptoms] + [notes]))

        severity = severity_level(english)
        duration = parse_duration_days(
            to_english(" , ".join(s.duration or "" for s in symptoms)), english
        )
        has_chronic = bool(chronic_diseases and chronic_diseases.strip())

        # 1. Safety layer — always evaluated first, always wins.
        flags = check_red_flags(raw, english)
        floor, floor_reasons = rule_floor(len(symptoms), severity == 3, age, has_chronic)

        if flags:
            labels = [f.label for f in flags]
            return self._response(
                risk="CRITICAL",
                specialty=flags[0].specialty,
                emergency=True,
                red_flags=labels,
                reasons=[f"Red-flag rule matched: {', '.join(labels)}.", *floor_reasons],
            )

        # 2. Specialty model (routing).
        specialty_proba = self.specialty_model.predict_proba([complaint])[0]
        specialty, specialty_reason = self.choose_specialty(complaint, raw, specialty_proba)

        # 3. Risk model, never below the rule floor.
        vector = self.extractor.vector(
            complaint, severity, duration, age, has_chronic, specialty_proba
        )
        predicted, risk_reason = self.assess_risk(complaint, vector)
        risk = max_risk(predicted, floor)

        return self._response(
            risk=risk,
            specialty=specialty,
            emergency=risk == "CRITICAL",
            red_flags=[],
            reasons=[specialty_reason, risk_reason, *floor_reasons],
        )

    @staticmethod
    def _response(
        risk: str, specialty: str, emergency: bool, red_flags: list[str], reasons: list[str]
    ) -> dict:
        if emergency:
            advice = EMERGENCY_ADVICE
        elif risk == "HIGH":
            advice = (
                "Please book an appointment as soon as possible — we suggest the "
                f"{specialty} department."
            )
        else:
            advice = (
                f"Your answers suggest the {specialty} department. This is an assistive "
                "assessment, not a diagnosis — a doctor will evaluate you."
            )
        return {
            "riskLevel": risk,
            "suggestedSpecialty": specialty,
            "seekEmergencyCare": emergency,
            "redFlags": red_flags,
            "reasons": reasons,
            "advice": advice,
        }
