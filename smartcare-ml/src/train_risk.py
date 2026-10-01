"""Train the risk model: tabular features → LOW / MODERATE / HIGH / CRITICAL.

    python -m src.train_risk        (after src.train_specialty)

IMPORTANT — where the labels come from. No public dataset carries a triage
risk level, so the labels are "silver" labels, not clinician-assigned:

  1. each disease has an acuity in data/specialty_map.csv (hand-written for
     the Kaggle diseases, DDXPlus's own severity rating for its conditions);
  2. patient context the datasets lack (chronic conditions, reported
     severity, duration, and age outside DDXPlus) is sampled at random;
  3. `silver_label` combines the two with the rules engine's risk floors.

The model never sees the disease — it has to recover the risk from the
symptom profile and the context, which is what it will get in production.
"""

import json

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold

from .features import FeatureExtractor
from .paths import MODELS, RISK_MODEL, SPECIALTY_MODEL, SYMPTOM_WEIGHTS, TRAIN_CSV
from .safety import RISK_ORDER, is_vulnerable_age, max_risk
from .train_specialty import build_pipeline

SEED = 42
VARIANTS_PER_ROW = {"dsp": 8, "s2d": 3, "ddx": 2}
SYMPTOM_DROPOUT = 0.2
SEVERITY_TEXT = {0: "", 1: "mild", 2: "moderate", 3: "severe"}


def silver_label(
    acuity: str, severity: int, age: float | None, has_chronic: bool, duration_days: float | None
) -> str:
    """Disease acuity, raised by patient context (same floors as the rules engine)."""
    risk = acuity
    # Patient calls it severe → at least HIGH.
    if severity == 3:
        risk = max_risk(risk, "HIGH")
    # Vulnerable patients (≤5, ≥65, or chronic illness) → at least MODERATE.
    if is_vulnerable_age(age) or has_chronic:
        risk = max_risk(risk, "MODERATE")
    # Something minor that has not cleared in two weeks deserves a visit.
    if duration_days is not None and duration_days >= 14:
        risk = max_risk(risk, "MODERATE")
    return risk


def simulate_requests(rows: pd.DataFrame, seed: int) -> list[dict]:
    """Expand each prepared row into several simulated triage requests."""
    rng = np.random.default_rng(seed)
    requests = []
    for row in rows.itertuples(index=False):
        for _ in range(VARIANTS_PER_ROW[row.source]):
            if row.symptoms:
                # Patients rarely report the full textbook checklist.
                symptoms = row.symptoms.split("|")
                kept = [s for s in symptoms if rng.random() > SYMPTOM_DROPOUT] or symptoms[:1]
                # dsp rows are entered as separate symptoms; a DDXPlus row is
                # one patient's description, entered as a single text.
                text, n_symptoms = ", ".join(kept), len(kept) if row.source == "dsp" else 1
            else:
                text, n_symptoms = row.text, 1

            severity = int(rng.choice(4, p=[0.40, 0.20, 0.25, 0.15]))
            # DDXPlus patients come with a real age; the Kaggle rows do not.
            known_age = str(getattr(row, "age", "")).strip()
            age = float(known_age) if known_age else float(rng.integers(1, 91))
            if rng.random() < 0.15:
                age = None  # no date of birth on the profile
            has_chronic = bool(rng.random() < 0.25)
            duration = (
                None
                if rng.random() < 0.30
                else float(rng.choice([0.1, 0.5, 1, 2, 3, 5, 7, 14, 21, 30, 90]))
            )
            requests.append(
                {
                    "text": text,
                    "severity": severity,
                    "duration": duration,
                    "age": age,
                    "has_chronic": has_chronic,
                    "n_symptoms": n_symptoms,
                    "source": row.source,
                    "label": silver_label(row.acuity, severity, age, has_chronic, duration),
                }
            )
    return requests


def featurize(requests: list[dict], extractor: FeatureExtractor, specialty_model) -> np.ndarray:
    proba = specialty_model.predict_proba([r["text"] for r in requests])
    return np.array(
        [
            extractor.vector(r["text"], r["severity"], r["duration"], r["age"], r["has_chronic"], p)
            for r, p in zip(requests, proba)
        ]
    )


def load_symptom_weights() -> dict[str, int]:
    return json.loads(SYMPTOM_WEIGHTS.read_text(encoding="utf-8"))


def main() -> None:
    train = pd.read_csv(TRAIN_CSV, keep_default_na=False)
    specialties = list(joblib.load(SPECIALTY_MODEL).classes_)
    extractor = FeatureExtractor(load_symptom_weights(), specialties)

    # The specialty model's probabilities are features here. On rows it was
    # trained on they would be unrealistically confident, so each fold's
    # features come from a specialty model that never saw that fold.
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    X_parts, labels = [], []
    for k, (fit_idx, held_idx) in enumerate(folds.split(train, train["specialty"])):
        fold_model = build_pipeline().fit(
            train["text"].iloc[fit_idx], train["specialty"].iloc[fit_idx]
        )
        assert list(fold_model.classes_) == specialties
        requests = simulate_requests(train.iloc[held_idx], SEED + k)
        X_parts.append(featurize(requests, extractor, fold_model))
        labels += [r["label"] for r in requests]
    X, y = np.vstack(X_parts), pd.Series(labels)

    model = RandomForestClassifier(
        n_estimators=300,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=SEED,
        n_jobs=-1,
    ).fit(X, y)
    # Serving predicts one request at a time; a thread pool only adds latency.
    model.set_params(n_jobs=1)

    MODELS.mkdir(exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "symptom_weights": extractor.weights,
            "specialties": specialties,
            "feature_names": extractor.feature_names,
        },
        RISK_MODEL,
        compress=3,
    )
    print(f"trained on {len(y)} simulated requests → {RISK_MODEL.name}")
    print("label balance:")
    print(y.value_counts().reindex(RISK_ORDER).to_string())


if __name__ == "__main__":
    main()
