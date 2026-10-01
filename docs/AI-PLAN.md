# SmartCare AI — Python ML Service Plan

> **Mission statement (say this in the defense):** *"The AI provides assistive risk
> assessment and suggests an appropriate medical specialty. It is not a diagnostic system."*
>
> No LLMs, no subscriptions, no API costs. A small model **we train ourselves** with
> scikit-learn — easy to explain, easy to defend, runs on our own VPS.

---

## 1. What we are building

A tiny **FastAPI microservice** that answers one question:

> "Given the patient's symptoms + basic profile, what is the risk level and which
> specialty should they see?"

The NestJS backend is **already wired for it** (Phase F):

- `POST /api/v1/ai/triage` calls the engine through the `AiProvider` strategy.
- If `AI_SERVICE_URL` is empty → the built-in bilingual **rules engine** answers (works today).
- If `AI_SERVICE_URL` is set (e.g. `http://localhost:8000`) → NestJS POSTs to
  **`{AI_SERVICE_URL}/triage`** and expects the JSON contract below. If the Python
  service is down or slow (>8s), NestJS automatically falls back to the rules engine —
  so the demo can never break.

**The contract (already fixed — the Python side must match it):**

```jsonc
// NestJS → Python           POST /triage
{
  "age": 61,                  // number | null
  "gender": "MALE",           // string | null
  "chronicDiseases": "type 2 diabetes, hypertension",  // string | null
  "symptoms": [
    { "name": "chest pain", "duration": "2 hours", "severity": "severe" }
  ],
  "notes": "pain spreads to my left arm"
}

// Python → NestJS           200 OK
{
  "riskLevel": "CRITICAL",            // LOW | MODERATE | HIGH | CRITICAL
  "suggestedSpecialty": "cardiology", // english lowercase
  "seekEmergencyCare": true,
  "redFlags": ["Chest pain"],
  "reasons": ["Model confidence 0.91 for cardiology", "Red-flag rule matched: chest pain"],
  "advice": "Call emergency services (123) or press SOS now."
}
```

---

## 2. Architecture — two small models + a safety layer

```
            patient text (EN/AR)
                    │
        ┌───────────▼───────────┐
        │ 1. SAFETY LAYER       │  red-flag keyword rules (chest pain, can't
        │    (rules, not ML)    │  breathe, stroke signs…) — ALWAYS wins.
        └───────────┬───────────┘  ML must never downgrade an emergency.
                    │ no red flag
        ┌───────────▼───────────┐
        │ 2. SPECIALTY model    │  TF-IDF + Logistic Regression
        │    (multiclass text   │  input:  symptom text
        │     classification)   │  output: one of ~15 specialties + confidence
        └───────────┬───────────┘
        ┌───────────▼───────────┐
        │ 3. RISK model         │  Gradient-boosted trees / RandomForest
        │    (tabular features) │  features: symptom count, severity words,
        └───────────┬───────────┘  age group, chronic-disease flag, duration
                    │
              JSON response
```

Why this design wins in a defense:

- **Explainable** — logistic regression coefficients literally show *which words*
  pushed the prediction ("'chest' + 'pressure' → cardiology"). No black box.
- **Safe** — a red-flag rule always wins, so an ML mistake can never *remove* an
  emergency. As built, the risk model may also *add* one when no keyword matched
  (it caught the heart-attack and brain-hemorrhage cases whose wording had no
  red-flag phrase — numbers in `smartcare-ml/reports/metrics.md`).
- **Honest** — we can show accuracy / F1 / confusion matrix on a held-out test set.

## 3. Datasets (all free)

| Dataset | What it gives us | Use |
|---|---|---|
| **Symptom2Disease** (Kaggle, ~1,200 rows) | Natural-language symptom descriptions → 24 diseases | Main training set for the specialty model (map disease → specialty with a lookup table we write, e.g. *psoriasis → dermatology*) |
| **Disease Symptom Prediction** (Kaggle, ~4,900 rows) | Symptom checklists → 41 diseases + severity weights | Extra training rows (join symptom names into a sentence) + the severity weights feed the risk model |
| **DDXPlus** (research dataset, ~1.3M synthetic cases) | Age/sex/symptoms → differential diagnosis | Done: ~2,500 sampled patients (60 per condition) add 42 diseases and 3 specialties; its severity rating gives those conditions their acuity |
| **Our own red-flag list** | The one already in `rules.provider.ts` | Port to Python for the safety layer |

The **disease → specialty mapping table** (~40 rows, written by hand with a medical
reference) is itself a deliverable — put it in the appendix of the graduation book.

**Arabic support:** keep the model English-only, and translate Arabic input before
inference with a small offline dictionary of the ~200 most common symptom words
(we already curated the important ones in `rules.provider.ts`). Stretch goal:
swap TF-IDF for multilingual sentence embeddings (`paraphrase-multilingual-MiniLM-L12-v2`,
runs on CPU) — same classifier on top, no retraining pain.

## 4. Repository layout

```
smartcare-ml/
├── data/
│   ├── raw/                     # downloaded CSVs (gitignored)
│   ├── specialty_map.csv        # disease → specialty (hand-written)
│   └── red_flags.json           # ported from rules.provider.ts
├── notebooks/
│   └── 01_explore.ipynb         # EDA: class balance, text lengths
├── src/
│   ├── prepare.py               # clean text, map disease→specialty, split train/test
│   ├── train_specialty.py       # TF-IDF + LogisticRegression → models/specialty.joblib
│   ├── train_risk.py            # feature builder + RandomForest → models/risk.joblib
│   ├── evaluate.py              # accuracy, macro-F1, confusion matrix PNG
│   ├── safety.py                # red-flag rules (mirror of the NestJS engine)
│   └── service.py               # FastAPI app — POST /triage, GET /health
├── models/                      # trained .joblib artifacts (small, committed)
├── tests/
│   └── test_triage.py           # golden cases: chest pain→CRITICAL, rash→dermatology…
└── requirements.txt             # fastapi, uvicorn, scikit-learn, pandas, joblib
```

## 5. The core code, sketched

**Training (train_specialty.py) — this is genuinely all it takes:**

```python
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

pipe = Pipeline([
    ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True)),
    ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
])
pipe.fit(X_train, y_train)              # X = symptom sentences, y = specialty
joblib.dump(pipe, "models/specialty.joblib")
```

**Serving (service.py):**

```python
app = FastAPI(title="SmartCare ML")
specialty_model = joblib.load("models/specialty.joblib")

@app.post("/triage")
def triage(req: TriageInput):
    flags = check_red_flags(req)                    # safety layer first
    if flags:
        return critical_response(flags)
    text = to_english(build_text(req))              # AR dictionary pass
    proba = specialty_model.predict_proba([text])[0]
    specialty = specialty_model.classes_[proba.argmax()]
    risk = risk_model_predict(req)                  # tabular features
    return build_response(risk, specialty, float(proba.max()))
```

**Deploy on the VPS** (same pattern as the backend): `uvicorn src.service:app
--port 8000`, kept alive with PM2 (`pm2 start "uvicorn src.service:app --port 8000"
--name smartcare-ml`), then set `AI_SERVICE_URL=http://localhost:8000` in the
backend `.env` and `pm2 restart smartcare-api`. No nginx change needed — the ML
service is internal-only (never exposed publicly).

## 6. Evaluation — the numbers for the defense slide

- **Specialty model:** accuracy + macro-F1 on a 20% held-out split; confusion
  matrix image (which specialties get confused — usually neurology ↔ internal medicine).
  Target: **>85% accuracy** on Symptom2Disease-derived specialties (realistic for
  TF-IDF + LR on this data).
- **Risk model:** precision/recall per class — we care most about **recall on
  HIGH/CRITICAL** (missing a sick patient is worse than over-warning).
- **Baseline comparison:** the NestJS rules engine IS the baseline. The slide:
  *"rules engine: X% — our trained model: Y%".* That comparison is the whole story.
- **Golden tests:** `pytest` cases pinned forever: "chest pain radiating to arm" must
  return CRITICAL + cardiology no matter what we retrain.

## 7. Work plan & learning path (≈3 weeks, parallel to frontend work)

| Step | Task | You will learn |
|---|---|---|
| 1 (2 days) | Download datasets, explore in a notebook, write `specialty_map.csv` | pandas, class imbalance **[LEARN: kaggle.com/learn/pandas]** |
| 2 (2 days) | `prepare.py`: clean text, map labels, train/test split | text preprocessing, why we NEVER evaluate on training data |
| 3 (2 days) | Train + evaluate the specialty model | TF-IDF, logistic regression, F1, confusion matrix **[LEARN: scikit-learn.org/stable/tutorial]** |
| 4 (2 days) | Feature engineering + risk model | tabular features, RandomForest, recall vs precision trade-off |
| 5 (1 day) | `safety.py` + golden tests | why rules wrap ML in medical software |
| 6 (2 days) | FastAPI `/triage` + pydantic models matching the NestJS contract | FastAPI, pydantic validation **[LEARN: fastapi.tiangolo.com/tutorial]** |
| 7 (1 day) | Arabic dictionary pass + end-to-end test through NestJS Swagger | integration testing |
| 8 (1 day) | Deploy on VPS with PM2, set `AI_SERVICE_URL`, demo | uvicorn, process management |
| Stretch | Multilingual embeddings; retrain script + model versioning | sentence-transformers |

## 8. Defense talking points

1. "We deliberately chose a **transparent model over an LLM**: zero running cost, no
   patient data leaves our server (privacy!), and we can show exactly why every
   prediction was made."
2. "A **rules safety layer overrides the model** — a red-flag rule always wins, and
   the model can only *raise* urgency, never lower it. We measured what rules alone
   missed before letting the model declare an emergency on its own."
3. "The system **degrades gracefully**: if the ML service dies mid-demo, the same
   endpoint silently answers from the rules engine" (yes, you can kill it live 😄).
4. "Assistive, never diagnostic — every response carries the disclaimer, and every
   triage is saved as an `AI_INITIAL` assessment for a real doctor to review."
