"""Build the train/test split from the raw datasets.

    python -m src.prepare

- Symptom2Disease: natural-language descriptions, used as-is.
- Disease Symptom Prediction: symptom checklists, joined into a sentence.
  Its 4,920 rows are only ~300 distinct checklists repeated many times, so
  we DEDUPLICATE BEFORE SPLITTING — otherwise copies of a test row would sit
  in the training set and the reported accuracy would be meaningless.
- DDXPlus: synthetic patients as coded findings, sampled and turned into
  symptom text by src/ddxplus.py. It triples the number of diseases, which
  is what lets the model route conditions it was not trained on.
- Disease labels are mapped to a specialty and an acuity level through
  data/specialty_map.csv.
"""

import json
import re

import pandas as pd
from sklearn.model_selection import train_test_split

from .ddxplus import load_ddx
from .features import clean_symptom
from .paths import (
    DDX_PATIENTS,
    DSP_CSV,
    DSP_SEVERITY_CSV,
    PROCESSED,
    S2D_CSV,
    SPECIALTY_MAP,
    SYMPTOM_WEIGHTS,
    TEST_CSV,
    TRAIN_CSV,
)

TEST_SIZE = 0.2
SEED = 42


# The datasets spell (and misspell) some diseases differently, and DDXPlus
# names a few conditions the Kaggle sets already have. One name per disease
# matters: the "never-seen disease" test in evaluate.py removes a disease by
# name, and a second copy under another name would leak it back in.
DISEASE_ALIASES = {
    "(vertigo) paroymsal positional vertigo": "paroxysmal positional vertigo",
    "dimorphic hemmorhoids(piles)": "hemorrhoids",
    "dimorphic hemorrhoids": "hemorrhoids",
    "gerd": "gastroesophageal reflux disease",
    "osteoarthristis": "osteoarthritis",
    "peptic ulcer diseae": "peptic ulcer disease",
    "aids": "hiv / aids",
    "hiv (initial infection)": "hiv / aids",
    "urti": "common cold",
    "possible nstemi / stemi": "heart attack",
    "bronchospasm / acute asthma exacerbation": "bronchial asthma",
    "larygospasm": "laryngospasm",
    "guillain-barré syndrome": "guillain-barre syndrome",
}


def disease_key(name: str) -> str:
    key = re.sub(r"\s+", " ", name).strip().lower()
    return DISEASE_ALIASES.get(key, key)


def load_s2d() -> pd.DataFrame:
    df = pd.read_csv(S2D_CSV)
    return pd.DataFrame(
        {
            "text": df["text"].str.strip(),
            "disease": df["label"].map(disease_key),
            "source": "s2d",
            "symptoms": "",
        }
    )


def load_dsp() -> pd.DataFrame:
    df = pd.read_csv(DSP_CSV)
    symptom_cols = [c for c in df.columns if c.startswith("Symptom_")]
    symptoms = df[symptom_cols].apply(
        lambda row: [clean_symptom(s) for s in row.dropna()], axis=1
    )
    return pd.DataFrame(
        {
            "text": symptoms.map(", ".join),
            "disease": df["Disease"].map(disease_key),
            "source": "dsp",
            "symptoms": symptoms.map("|".join),
        }
    )


def symptom_weights(dsp: pd.DataFrame) -> dict[str, int]:
    """Severity weight (1–7) for every symptom that occurs in the checklists."""
    severity = pd.read_csv(DSP_SEVERITY_CSV)
    # The two CSVs spell a few names differently ('foul_smell_of urine' vs
    # 'foul_smell_ofurine'), so join on the name with separators removed.
    squash = lambda s: re.sub(r"[\s_]+", "", s.lower())  # noqa: E731
    by_key = dict(zip(severity["Symptom"].map(squash), severity["weight"]))
    vocab = sorted({s for row in dsp["symptoms"] for s in row.split("|")})
    missing = [s for s in vocab if squash(s) not in by_key]
    if missing:
        print(f"  no severity weight for {missing} — using the median")
    median = int(severity["weight"].median())
    return {s: int(by_key.get(squash(s), median)) for s in vocab}


def main() -> None:
    mapping = pd.read_csv(SPECIALTY_MAP).set_index("disease")
    dsp = load_dsp()
    weights = symptom_weights(dsp)

    parts = [load_s2d(), dsp]
    if DDX_PATIENTS.exists():
        ddx = load_ddx()
        ddx["disease"] = ddx["disease"].map(disease_key)
        parts.append(ddx)
    else:
        print("WARNING: DDXPlus not found (run `python -m src.download_data`) — "
              "preparing the two Kaggle datasets only.")

    df = pd.concat(parts, ignore_index=True)
    unmapped = sorted(set(df["disease"]) - set(mapping.index))
    if unmapped:
        raise SystemExit(f"Diseases missing from specialty_map.csv: {unmapped}")
    df["specialty"] = df["disease"].map(mapping["specialty"])
    df["acuity"] = df["disease"].map(mapping["acuity"])

    before = len(df)
    df = df.drop_duplicates(subset="text").reset_index(drop=True)
    print(f"rows: {before} raw → {len(df)} after removing duplicate texts")

    # Stratify on source+disease so every dataset and every disease appear on
    # each side of the split in the same proportion. A disease with a single
    # distinct description cannot be split — it goes to training.
    strata = df["source"] + "|" + df["disease"]
    single = strata.map(strata.value_counts()) < 2
    train, test = train_test_split(
        df[~single], test_size=TEST_SIZE, random_state=SEED, stratify=strata[~single]
    )
    train = pd.concat([train, df[single]])
    if single.any():
        print(f"  only one distinct text, kept in training: {sorted(strata[single])}")

    PROCESSED.mkdir(parents=True, exist_ok=True)
    train.to_csv(TRAIN_CSV, index=False)
    test.to_csv(TEST_CSV, index=False)
    SYMPTOM_WEIGHTS.write_text(json.dumps(weights, indent=2), encoding="utf-8")

    print(f"train: {len(train)}  test: {len(test)}  symptoms in vocabulary: {len(weights)}")
    print("\nrows per source:")
    print(df["source"].value_counts().to_string())
    print("\nrows per specialty (train / test):")
    counts = pd.DataFrame(
        {"train": train["specialty"].value_counts(), "test": test["specialty"].value_counts()}
    ).fillna(0).astype(int)
    print(counts.sort_values("train", ascending=False).to_string())
    print("\nrows per acuity:")
    print(df["acuity"].value_counts().to_string())
    print(f"\ndiseases: {df['disease'].nunique()}  specialties: {df['specialty'].nunique()}")


if __name__ == "__main__":
    main()
