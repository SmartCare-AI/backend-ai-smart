"""Stretch-goal experiment: multilingual sentence embeddings instead of TF-IDF.

    pip install sentence-transformers        # ~1 GB with PyTorch; NOT a runtime dependency
    python -m src.experiment_embeddings      # → reports/embeddings_experiment.md

Same classifier (logistic regression), same train/test split, same checks as
evaluate.py — only the text representation changes. The service does not use
this; the report records whether it would be worth the heavier deployment.
"""

import json
import time

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score

from .paths import REPORTS, SHORT_INPUTS, TEST_CSV, TRAIN_CSV
from .textutil import to_english
from .train_specialty import SEED, build_pipeline

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
_ARABIC = r"[؀-ۿ]"


def classifier() -> LogisticRegression:
    return LogisticRegression(C=10, max_iter=2000, class_weight="balanced", random_state=SEED)


def unseen_accuracy(fit_predict, data: pd.DataFrame) -> float:
    """Leave-one-disease-out, as in evaluate.unseen_disease_stress_test."""
    per_specialty = data.groupby("specialty")["disease"].nunique()
    testable = sorted(data.loc[data["specialty"].map(per_specialty) > 1, "disease"].unique())
    hits = rows = 0
    for disease in testable:
        held = (data["disease"] == disease).to_numpy()
        predicted = fit_predict(~held, held)
        hits += int((predicted == data.loc[held, "specialty"].to_numpy()).sum())
        rows += int(held.sum())
    return hits / rows


def main() -> None:
    from sentence_transformers import SentenceTransformer

    train = pd.read_csv(TRAIN_CSV, keep_default_na=False)
    test = pd.read_csv(TEST_CSV, keep_default_na=False)
    short = pd.read_csv(SHORT_INPUTS)
    acceptable = short["acceptable"].str.split("|")
    arabic = short["text"].str.contains(_ARABIC)
    full = pd.concat([train, test], ignore_index=True)

    encoder = SentenceTransformer(MODEL_NAME, device="cpu")
    started = time.perf_counter()
    E_full = encoder.encode(full["text"].tolist(), batch_size=64, normalize_embeddings=True)
    encode_seconds = time.perf_counter() - started
    E_train, E_test = E_full[: len(train)], E_full[len(train):]
    # Multilingual model: Arabic goes in as written, no dictionary.
    E_short = encoder.encode(short["text"].tolist(), normalize_embeddings=True)

    started = time.perf_counter()
    for text in short["text"].head(20):
        encoder.encode([text], normalize_embeddings=True)
    ms_per_request = (time.perf_counter() - started) / 20 * 1000

    emb = classifier().fit(E_train, train["specialty"])
    tfidf = build_pipeline().fit(train["text"], train["specialty"])

    def short_accuracy(predictions, mask=None) -> float:
        hits = [p in ok for p, ok in zip(predictions, acceptable)]
        return float(np.mean(hits if mask is None else np.array(hits)[mask.to_numpy()]))

    def source_accuracy(predictions) -> dict:
        return {
            s: round(accuracy_score(test.loc[test["source"] == s, "specialty"],
                                    predictions[(test["source"] == s).to_numpy()]), 4)
            for s in sorted(test["source"].unique())
        }

    emb_test, tfidf_test = emb.predict(E_test), tfidf.predict(test["text"])
    emb_short = emb.predict(E_short)
    tfidf_short = tfidf.predict(short["text"].map(to_english))

    def emb_fit_predict(fit, held):
        return classifier().fit(E_full[fit], full.loc[fit, "specialty"]).predict(E_full[held])

    def tfidf_fit_predict(fit, held):
        model = build_pipeline().fit(full.loc[fit, "text"], full.loc[fit, "specialty"])
        return model.predict(full.loc[held, "text"])

    def block(test_pred, short_pred, fit_predict) -> dict:
        return {
            "test_accuracy": round(accuracy_score(test["specialty"], test_pred), 4),
            "test_macro_f1": round(f1_score(test["specialty"], test_pred, average="macro"), 4),
            "test_accuracy_by_source": source_accuracy(test_pred),
            "short_inputs_accuracy": round(short_accuracy(short_pred), 4),
            "short_inputs_english": round(short_accuracy(short_pred, ~arabic), 4),
            "short_inputs_arabic": round(short_accuracy(short_pred, arabic), 4),
            "unseen_disease_accuracy": round(unseen_accuracy(fit_predict, full), 4),
        }

    results = {
        "embedding_model": MODEL_NAME,
        "embedding_dimensions": int(E_full.shape[1]),
        "encode_seconds_for_all_rows": round(encode_seconds, 1),
        "encode_ms_per_request_cpu": round(ms_per_request, 1),
        "short_inputs": {"rows": len(short), "arabic_rows": int(arabic.sum())},
        "tfidf": block(tfidf_test, tfidf_short, tfidf_fit_predict),
        "embeddings": block(emb_test, emb_short, emb_fit_predict),
    }
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "embeddings_experiment.json").write_text(json.dumps(results, indent=2), encoding="utf-8")

    t, e = results["tfidf"], results["embeddings"]

    def row(title: str, key: str) -> str:
        return f"| {title} | {t[key]:.1%} | {e[key]:.1%} |"

    by_source = "\n".join(
        f"| Held-out test rows — `{s}` | {t['test_accuracy_by_source'][s]:.1%} | {e['test_accuracy_by_source'][s]:.1%} |"
        for s in t["test_accuracy_by_source"]
    )
    markdown = f"""# Experiment — multilingual sentence embeddings vs TF-IDF

Generated by `python -m src.experiment_embeddings`. The stretch goal of
docs/AI-PLAN.md: replace TF-IDF with `{MODEL_NAME}` ({results['embedding_dimensions']}-dimensional
sentence vectors, runs on CPU) and keep the same logistic-regression classifier.
Both columns are the **specialty model alone** — no keyword rules, no safety layer.

| | TF-IDF (in production) | Sentence embeddings |
|---|---|---|
{row('Held-out test rows — accuracy', 'test_accuracy')}
{by_source}
{row('Never-seen diseases (leave-one-disease-out)', 'unseen_disease_accuracy')}
{row(f"Short app-style inputs ({results['short_inputs']['rows']} rows)", 'short_inputs_accuracy')}
{row('…English', 'short_inputs_english')}
{row(f"…Arabic ({results['short_inputs']['arabic_rows']} rows; TF-IDF sees the dictionary translation, embeddings the raw Arabic)", 'short_inputs_arabic')}

Cost of the embeddings column: PyTorch and a ~470 MB model on the server, and
about {results['encode_ms_per_request_cpu']:.0f} ms of CPU per request to encode the text (measured here; TF-IDF takes
about 1 ms). It also loses the per-word explanation ("key terms") that the
linear TF-IDF model gives for free.
"""
    (REPORTS / "embeddings_experiment.md").write_text(markdown, encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
