"""Train the specialty model: symptom text → medical specialty.

    python -m src.train_specialty

TF-IDF + Logistic Regression — a linear model, so every prediction can be
explained by the words that pushed it (see engine.top_terms).
"""

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline

from .paths import MODELS, SPECIALTY_MODEL, TRAIN_CSV
from .textutil import normalize

SEED = 42


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "tfidf",
                # Dropping filler words costs nothing measurable and keeps the
                # "key terms" explanations clinical ("chills", not "and my").
                TfidfVectorizer(
                    preprocessor=normalize,
                    stop_words="english",
                    ngram_range=(1, 2),
                    min_df=2,
                    sublinear_tf=True,
                ),
            ),
            (
                "clf",
                LogisticRegression(
                    C=10, max_iter=1000, class_weight="balanced", random_state=SEED
                ),
            ),
        ]
    )


def main() -> None:
    train = pd.read_csv(TRAIN_CSV)
    X, y = train["text"], train["specialty"]

    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    scores = cross_val_score(build_pipeline(), X, y, cv=folds, scoring="f1_macro")
    print(f"5-fold CV macro-F1 on the training set: {scores.mean():.3f} ± {scores.std():.3f}")

    pipe = build_pipeline().fit(X, y)
    MODELS.mkdir(exist_ok=True)
    joblib.dump(pipe, SPECIALTY_MODEL, compress=3)
    print(f"trained on {len(train)} rows, {len(pipe.classes_)} specialties → {SPECIALTY_MODEL.name}")


if __name__ == "__main__":
    main()
