"""DDXPlus → symptom text.

DDXPlus (Fansi Tchango et al., 2022) is ~1.3M synthetic patients, each a list
of coded findings ("E_91", "E_55_@_V_89") plus the true pathology. We take a
small, balanced sample and turn the codes into the words a patient would use,
so the rows can sit next to the two Kaggle datasets.

Only symptoms are used. Antecedents (smoking, past illnesses, travel…) are
dropped: in production that history arrives in `chronicDiseases`, not in the
symptom text.
"""

import ast
import csv
import json
import random
import re

import pandas as pd

from .paths import DDX_EVIDENCES, DDX_PATIENTS, DDX_PHRASES

ROWS_PER_CONDITION = 60  # the Symptom2Disease scale (50 per disease)
SEED = 42

# Findings that carry a value: a body location, a description, or a 0–10 scale.
# Templates without "{}" are emitted when the answer is yes / at least 5.
VALUE_TEMPLATES = {
    "E_55": "{} pain",
    "E_57": "pain radiating to the {}",
    "E_54": "{} pain",
    "E_133": "skin problem on the {}",
    "E_130": "{} rash",
    "E_152": "swelling of the {}",
    "E_135": "lesions larger than 1cm",
    "E_131": "peeling lesions",
    "E_136": "itching",
    "E_132": "swollen rash",
    "E_134": "painful rash",
}
_NO_ANSWER = {"NA", "nowhere", "N"}
# The dataset's English for some pain descriptors is a literal translation.
_PAIN_WORDS = {"a knife stroke": "stabbing", "a cramp": "cramping", "a pulse": "pulsating"}
_PARENTHESES = re.compile(r"\s*\([^)]*\)")  # "ankle(R)" → "ankle"


def to_phrases(evidences: list[str], meta: dict, binary_phrases: dict[str, str]) -> list[str]:
    phrases = []
    for item in evidences:
        code, _, value = item.partition("_@_")
        if not value:
            if code in binary_phrases:
                phrases.append(binary_phrases[code])
            continue
        template = VALUE_TEMPLATES.get(code)
        if template is None:
            continue
        if value.startswith("V_"):
            meaning = meta[code]["value_meaning"].get(value, {}).get("en", "NA")
            if meaning in _NO_ANSWER:
                continue
            meaning = _PAIN_WORDS.get(meaning, _PARENTHESES.sub("", meaning).strip())
            phrases.append(template.format(meaning))
        elif float(value) >= 5:
            phrases.append(template)
    return list(dict.fromkeys(phrases))  # left and right side collapse into one


def load_ddx() -> pd.DataFrame:
    meta = json.loads(DDX_EVIDENCES.read_text(encoding="utf-8"))
    binary_phrases = json.loads(DDX_PHRASES.read_text(encoding="utf-8"))

    # One pass, reservoir-sampling ROWS_PER_CONDITION *distinct* symptom
    # profiles per pathology. Without the antecedents many patients of the
    # same condition read identically (laryngospasm has a single symptom), so
    # sampling patients first and de-duplicating later would leave some
    # conditions with one or two rows.
    rng = random.Random(SEED)
    profiles: dict[str, set[tuple[str, ...]]] = {}
    sample: dict[str, list[dict]] = {}
    with DDX_PATIENTS.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            phrases = tuple(to_phrases(ast.literal_eval(row["EVIDENCES"]), meta, binary_phrases))
            pathology = row["PATHOLOGY"]
            seen = profiles.setdefault(pathology, set())
            if not phrases or phrases in seen:
                continue
            seen.add(phrases)
            record = {
                "text": ", ".join(phrases),
                "disease": pathology,
                "source": "ddx",
                "symptoms": "|".join(phrases),
                "age": float(row["AGE"]),
            }
            kept = sample.setdefault(pathology, [])
            if len(kept) < ROWS_PER_CONDITION:
                kept.append(record)
            else:
                slot = rng.randrange(len(seen))
                if slot < ROWS_PER_CONDITION:
                    kept[slot] = record

    return pd.DataFrame.from_records(
        [record for pathology in sorted(sample) for record in sample[pathology]]
    )
