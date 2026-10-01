"""Evaluate both models on the held-out test split and write reports/.

    python -m src.evaluate

Outputs: reports/metrics.json, reports/metrics.md, and PNG charts
(confusion matrices, risk feature importances) for the defense slides.
Every model number is paired with the rules-engine baseline on the same rows.
"""

import json

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    ConfusionMatrixDisplay,
    accuracy_score,
    classification_report,
    f1_score,
    recall_score,
)

from .engine import Symptom, TriageEngine  # noqa: E402
from .paths import REPORTS, SHORT_INPUTS, SPECIALTY_MODEL, TEST_CSV, TRAIN_CSV  # noqa: E402
from .rules_baseline import reachable_specialties, rules_risk, rules_specialty  # noqa: E402
from .safety import RISK_ORDER  # noqa: E402
from .textutil import to_english  # noqa: E402
from .train_risk import SEVERITY_TEXT, featurize, simulate_requests  # noqa: E402
from .train_specialty import build_pipeline  # noqa: E402

RISK_TEST_SEED = 2024  # different from the training seeds
URGENT = ["HIGH", "CRITICAL"]


def confusion_png(y_true, y_pred, labels, title, path) -> None:
    size = max(6, 0.6 * len(labels) + 2)
    fig, ax = plt.subplots(figsize=(size, size))
    ConfusionMatrixDisplay.from_predictions(
        y_true, y_pred, labels=labels, xticks_rotation=45, cmap="Blues", colorbar=False, ax=ax
    )
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def evaluate_specialty(test: pd.DataFrame, engine: TriageEngine) -> tuple[dict, str]:
    model = engine.specialty_model
    y_true = test["specialty"]
    y_model = pd.Series(model.predict(test["text"]), index=test.index)
    y_rules = test["text"].map(rules_specialty)
    y_system = test["text"].map(engine.route)
    labels = list(model.classes_)

    def scores(pred) -> dict:
        return {
            "accuracy": round(accuracy_score(y_true, pred), 4),
            "macro_f1": round(
                f1_score(y_true, pred, labels=labels, average="macro", zero_division=0), 4
            ),
        }

    def subset(mask) -> dict:
        return {
            "rows": int(mask.sum()),
            "model_accuracy": round(accuracy_score(y_true[mask], y_model[mask]), 4),
            "rules_accuracy": round(accuracy_score(y_true[mask], y_rules[mask]), 4),
        }

    # The rules engine has no keywords for some specialties (e.g. infectious
    # disease), so it can never be right on those rows. Report the fair
    # comparison too: only rows whose specialty the rules are able to answer.
    reachable = reachable_specialties()
    confusion_png(
        y_true, y_model, labels, "Specialty model — held-out test set",
        REPORTS / "specialty_confusion_matrix.png",
    )
    report = classification_report(y_true, y_model, labels=labels, zero_division=0)
    metrics = {
        "test_rows": len(test),
        "classes": labels,
        "model": scores(y_model),
        "rules_baseline": scores(y_rules),
        "full_system": scores(y_system),
        "by_source": {s: subset(test["source"] == s) for s in sorted(test["source"].unique())},
        "rules_reachable_rows": subset(y_true.isin(reachable)),
    }
    return metrics, report


def evaluate_short_inputs(engine: TriageEngine) -> dict:
    """App-style inputs: a symptom name or two, English and Arabic.

    data/short_inputs.csv is hand-written and small; it was also used to
    decide how the engine arbitrates between model and keywords, so treat
    these as development numbers, not a blind test.
    """
    short = pd.read_csv(SHORT_INPUTS)
    acceptable = short["acceptable"].str.split("|")

    def accuracy(predictions) -> float:
        return round(sum(p in ok for p, ok in zip(predictions, acceptable)) / len(short), 4)

    y_model = engine.specialty_model.predict(short["text"].map(to_english))
    y_system = short["text"].map(engine.route)
    risk = short["text"].map(lambda t: engine.triage([Symptom(t)])["riskLevel"])
    return {
        "rows": len(short),
        "rules_accuracy": accuracy(short["text"].map(rules_specialty)),
        "model_accuracy": accuracy(y_model),
        "system_accuracy": accuracy(y_system),
        "system_misses": [
            {"text": t, "predicted": p, "acceptable": ok}
            for t, p, ok in zip(short["text"], y_system, short["acceptable"])
            if p not in ok.split("|")
        ],
        "risk_levels": {c: int((risk == c).sum()) for c in RISK_ORDER},
        "flagged_urgent": short.loc[risk.isin(URGENT), "text"].tolist(),
    }


def unseen_disease_stress_test(full: pd.DataFrame) -> dict:
    """Retrain with one disease removed, then ask for that disease's specialty.

    The normal test set holds new descriptions of diseases the model has
    already seen. This asks the harder question: does it route a condition
    it has NEVER seen to the right department?
    """


    def testable(data: pd.DataFrame) -> list[str]:
        # Only possible where another disease of the same specialty stays in training.
        per_specialty = data.groupby("specialty")["disease"].nunique()
        return sorted(data.loc[data["specialty"].map(per_specialty) > 1, "disease"].unique())

    def predict_held_out(data: pd.DataFrame, disease: str) -> pd.Series:
        """Train on `data` without `disease`; predict that disease's rows."""
        held = data["disease"] == disease
        model = build_pipeline().fit(data.loc[~held, "text"], data.loc[~held, "specialty"])
        return pd.Series(model.predict(data.loc[held, "text"]), index=data.index[held])

    results = []
    correct = pd.Series(False, index=full.index)
    for disease in testable(full):
        predicted = predict_held_out(full, disease)
        truth = full.loc[predicted.index, "specialty"]
        correct[predicted.index] = predicted == truth
        results.append(
            {
                "disease": disease,
                "specialty": truth.iloc[0],
                "sources": "+".join(sorted(full.loc[predicted.index, "source"].unique())),
                "rows": len(predicted),
                "accuracy": round(float((predicted == truth).mean()), 4),
                "most_predicted": predicted.mode().iloc[0],
            }
        )
    rows = sum(r["rows"] for r in results)
    summary = {
        "diseases": len(results),
        "rows": rows,
        "accuracy": round(sum(r["accuracy"] * r["rows"] for r in results) / rows, 4),
        "per_disease": results,
    }

    # Did adding DDXPlus help with never-seen diseases? Controlled comparison:
    # the same held-out Kaggle rows, with and without DDXPlus in training.
    kaggle = full[full["source"] != "ddx"]
    if len(kaggle) < len(full):
        hits_without, compared = 0, []
        for disease in testable(kaggle):
            predicted = predict_held_out(kaggle, disease)
            hits_without += int((predicted == kaggle.loc[predicted.index, "specialty"]).sum())
            compared.extend(predicted.index)
        summary["ddxplus_effect_on_kaggle_rows"] = {
            "diseases": len(testable(kaggle)),
            "rows": len(compared),
            "accuracy_without_ddxplus": round(hits_without / len(compared), 4),
            "accuracy_with_ddxplus": round(float(correct[compared].mean()), 4),
        }
    return summary


def evaluate_risk(test: pd.DataFrame, engine: TriageEngine) -> tuple[dict, str]:
    specialty_model, model, extractor = engine.specialty_model, engine.risk_model, engine.extractor

    requests = simulate_requests(test, RISK_TEST_SEED)
    y_true = pd.Series([r["label"] for r in requests])
    y_model = model.predict(featurize(requests, extractor, specialty_model))
    y_rules = [
        rules_risk(
            f"{r['text']} {SEVERITY_TEXT[r['severity']]}", r["n_symptoms"], r["age"], r["has_chronic"]
        )
        for r in requests
    ]

    def through_engine(r: dict) -> dict:
        """The same request through the whole service: rules + both models."""
        names = r["text"].split(", ") if r["source"] == "dsp" else [r["text"]]
        symptoms = [Symptom(name) for name in names]
        symptoms[0].severity = SEVERITY_TEXT[r["severity"]] or None
        symptoms[0].duration = f"{r['duration']:g} days" if r["duration"] is not None else None
        return engine.triage(
            symptoms, age=r["age"], chronic_diseases="on record" if r["has_chronic"] else None
        )

    def run_all(model_may_declare: bool) -> list[dict]:
        configured = engine.ml_may_declare_emergency
        engine.ml_may_declare_emergency = model_may_declare
        try:
            return [through_engine(r) for r in requests]
        finally:
            engine.ml_may_declare_emergency = configured

    # Both settings of ML_MAY_DECLARE_EMERGENCY, so the report always shows
    # what the switch buys and what it costs.
    rules_only, with_model = run_all(False), run_all(True)
    system = with_model if engine.ml_may_declare_emergency else rules_only
    y_system = [o["riskLevel"] for o in system]

    truly_critical = y_true == "CRITICAL"

    def caught(outputs: list[dict]) -> int:
        return sum(o["riskLevel"] == "CRITICAL" for o, c in zip(outputs, truly_critical) if c)

    model_only = pd.Series([o["riskLevel"] == "CRITICAL" and not o["redFlags"] for o in with_model])
    by_red_flag = pd.Series([bool(o["redFlags"]) for o in with_model])
    false_alarms = y_true[model_only & ~truly_critical]
    emergencies = {
        "ml_may_declare_emergency": engine.ml_may_declare_emergency,
        "true_critical_requests": int(truly_critical.sum()),
        "caught_by_rules_alone": caught(rules_only),
        "caught_with_model": caught(with_model),
        "model_only_emergencies": int(model_only.sum()),
        "model_false_emergencies": len(false_alarms),
        "model_false_emergencies_by_true_label": {
            c: int((false_alarms == c).sum()) for c in RISK_ORDER[:-1]
        },
        "red_flag_emergencies": int(by_red_flag.sum()),
        "red_flag_emergencies_not_truly_critical": int((by_red_flag & ~truly_critical).sum()),
    }

    def scores(pred) -> dict:
        pred = pd.Series(pred)
        recall = recall_score(y_true, pred, labels=RISK_ORDER, average=None, zero_division=0)
        urgent_true, urgent_pred = y_true.isin(URGENT), pred.isin(URGENT)
        return {
            "accuracy": round(accuracy_score(y_true, pred), 4),
            "macro_f1": round(
                f1_score(y_true, pred, labels=RISK_ORDER, average="macro", zero_division=0), 4
            ),
            "recall_per_class": {c: round(float(r), 4) for c, r in zip(RISK_ORDER, recall)},
            # Of the patients who are truly HIGH or CRITICAL, how many did we
            # flag as HIGH or CRITICAL? Missing these is the costly mistake.
            "urgent_recall": round(float((urgent_true & urgent_pred).sum() / urgent_true.sum()), 4),
            # ...and the price paid for it: non-urgent patients told it is urgent.
            "over_triage_rate": round(
                float((~urgent_true & urgent_pred).sum() / (~urgent_true).sum()), 4
            ),
        }

    confusion_png(
        y_true, y_model, RISK_ORDER, "Risk model — held-out test set",
        REPORTS / "risk_confusion_matrix.png",
    )

    importances = pd.Series(model.feature_importances_, index=extractor.feature_names)
    top = importances.sort_values(ascending=False).head(15)
    fig, ax = plt.subplots(figsize=(8, 6))
    top[::-1].plot.barh(ax=ax, color="#2b6cb0")
    ax.set_title("Risk model — top feature importances")
    fig.tight_layout()
    fig.savefig(REPORTS / "risk_feature_importance.png", dpi=150)
    plt.close(fig)

    report = classification_report(y_true, y_model, labels=RISK_ORDER, zero_division=0)
    metrics = {
        "test_rows": len(requests),
        "label_counts": {c: int((y_true == c).sum()) for c in RISK_ORDER},
        "rules_baseline": scores(y_rules),
        "model": scores(y_model),
        "full_system": scores(y_system),
        "emergencies_without_red_flag": emergencies,
        "top_features": {k: round(float(v), 4) for k, v in top.items()},
    }
    return metrics, report


def top_words_table(k: int = 8) -> str:
    """Per specialty, the words with the largest positive coefficients."""
    model = joblib.load(SPECIALTY_MODEL)
    names = model.named_steps["tfidf"].get_feature_names_out()
    clf = model.named_steps["clf"]
    lines = ["| Specialty | Strongest words |", "|---|---|"]
    for specialty, coef in zip(clf.classes_, clf.coef_):
        words = ", ".join(names[i] for i in coef.argsort()[::-1][:k])
        lines.append(f"| {specialty} | {words} |")
    return "\n".join(lines)


def render_markdown(
    train_rows: int, s: dict, u: dict, sh: dict, r: dict, s_report: str, r_report: str
) -> str:
    miss_rows = "\n".join(
        f"| {m['text']} | {m['predicted']} | {m['acceptable'].replace('|', ' / ')} |"
        for m in sh["system_misses"]
    )
    source_rows = "\n".join(
        f"| {name} | {v['rows']} | {v['rules_accuracy']:.1%} | {v['model_accuracy']:.1%} |"
        for name, v in s["by_source"].items()
    )
    reach = s["rules_reachable_rows"]
    unseen_rows = "\n".join(
        f"| {d['disease']} | {d['specialty']} | {d['rows']} | {d['accuracy']:.0%} | {d['most_predicted']} |"
        for d in sorted(u["per_disease"], key=lambda d: -d["accuracy"])
    )
    e = r["emergencies_without_red_flag"]
    k = u.get("ddxplus_effect_on_kaggle_rows")
    ddx_effect = "" if k is None else (
        "Did adding DDXPlus to training help here? Controlled comparison on the same\n"
        f"{k['rows']} held-out rows of the two Kaggle datasets ({k['diseases']} diseases):\n\n"
        "| Training data | Accuracy on never-seen Kaggle diseases |\n|---|---|\n"
        f"| Kaggle datasets only | {k['accuracy_without_ddxplus']:.1%} |\n"
        f"| Kaggle datasets + DDXPlus | {k['accuracy_with_ddxplus']:.1%} |\n"
    )
    false_by_label = ", ".join(
        f"{n} truly {c}" for c, n in e["model_false_emergencies_by_true_label"].items() if n
    )
    columns = ("rules_baseline", "model", "full_system")
    recall_rows = "\n".join(
        f"| {c} recall | " + " | ".join(f"{r[k]['recall_per_class'][c]:.1%}" for k in columns) + " |"
        for c in RISK_ORDER
    )

    def risk_row(title: str, key: str, fmt: str) -> str:
        return f"| {title} | " + " | ".join(format(r[k][key], fmt) for k in columns) + " |"

    return f"""# SmartCare ML — evaluation report

Generated by `python -m src.evaluate`. Trained on {train_rows} rows; unless stated
otherwise, every number below is measured on held-out test rows the models never saw.

## Specialty model (TF-IDF + Logistic Regression)

Test rows: {s['test_rows']} · classes: {len(s['classes'])}

| | Rules engine (baseline) | Trained model | Full system |
|---|---|---|---|
| Accuracy | {s['rules_baseline']['accuracy']:.1%} | **{s['model']['accuracy']:.1%}** | {s['full_system']['accuracy']:.1%} |
| Macro-F1 | {s['rules_baseline']['macro_f1']:.3f} | **{s['model']['macro_f1']:.3f}** | {s['full_system']['macro_f1']:.3f} |

"Full system" = what the service answers: the model, with keyword rules taking
over on short or low-confidence input (see "Short inputs" below).

| Test rows | Rows | Rules accuracy | Model accuracy |
|---|---|---|---|
{source_rows}
| only specialties the rules can answer | {reach['rows']} | {reach['rules_accuracy']:.1%} | {reach['model_accuracy']:.1%} |

`s2d` = Symptom2Disease (patients' own words) · `dsp` = Disease Symptom Prediction
(checklists) · `ddx` = DDXPlus (synthetic patients, findings turned into text).
The rules engine has no keywords for some specialties (infectious disease,
allergy…), so the last row is the like-for-like comparison.

**The `ddx` row flatters the model.** DDXPlus rows are assembled from a fixed
list of phrases (`data/ddxplus_phrases.json`), so test rows share their wording
with training rows. The same conditions described in a patient's own words are
recognized less reliably and with low confidence — `s2d` is the row that
reflects real phrasing.

```
{s_report}
```

![Specialty confusion matrix](specialty_confusion_matrix.png)

### Read this before quoting the accuracy

The test set contains **new descriptions of diseases the model has already
seen** in training. That is the standard evaluation, and it is what the number
above measures. The harder question is whether the model routes a condition it
has never seen. Stress test: remove one disease from training entirely, retrain,
and ask for its specialty — repeated for {u['diseases']} diseases ({u['rows']} rows):

**Accuracy on never-seen diseases: {u['accuracy']:.1%}**

{ddx_effect}
| Held-out disease | Correct specialty | Rows | Accuracy | Most often predicted |
|---|---|---|---|---|
{unseen_rows}

So the model recognizes the conditions it was trained on far better than new
ones. A never-seen disease is routed correctly when its specialty still has
similar diseases in training, and misrouted when it was the only one of its
kind — more diseases per specialty remains the way to improve this.

### Short inputs (how patients actually type in the app)

The datasets describe whole diseases in full sentences. In the app a patient
often enters one or two symptom names. On {sh['rows']} hand-written inputs of that
kind (`data/short_inputs.csv`, English and Arabic):

| | Rules engine | Trained model alone | Full system |
|---|---|---|---|
| Acceptable specialty | {sh['rules_accuracy']:.1%} | {sh['model_accuracy']:.1%} | **{sh['system_accuracy']:.1%}** |

The model alone is weak here — it only knows "headache" as one symptom of malaria
or dengue, not as a complaint in its own right — which is why the service lets
keyword rules answer first when the description is short. This set is small and
was used to design that behavior: a development number, not a blind test.

Still wrong in the full system:

| Input | Answered | Acceptable |
|---|---|---|
{miss_rows}

Risk levels the full system gave these inputs: {', '.join(f"{c} {n}" for c, n in sh['risk_levels'].items())}.
Flagged HIGH/CRITICAL: {', '.join(sh['flagged_urgent']) or 'none'}. On a short input the
risk model may answer MODERATE at most (`assess_risk` in `src/engine.py`): it
learned from full descriptions, and left alone it called single symptoms such as
"acne" or "eye redness" HIGH. Red flags and "severe" still raise a short input.

### What the model learned (largest positive coefficients)

{top_words_table()}

## Risk model (Random Forest on tabular features)

Simulated triage requests built from the test rows: {r['test_rows']}
({', '.join(f"{c} {n}" for c, n in r['label_counts'].items())}).
Labels are **silver labels** (disease acuity table + context rules, see
`src/train_risk.py`) — not clinician-assigned.

"Full system" = the complete service: red-flag rules, both models, rule floors.

| | Rules engine (baseline) | Risk model alone | Full system |
|---|---|---|---|
{risk_row('Accuracy', 'accuracy', '.1%')}
{risk_row('Macro-F1', 'macro_f1', '.3f')}
{risk_row('**Urgent recall** (true HIGH/CRITICAL flagged HIGH/CRITICAL)', 'urgent_recall', '.1%')}
{risk_row('Over-triage (non-urgent flagged HIGH/CRITICAL)', 'over_triage_rate', '.1%')}
{recall_rows}

The full system trades accuracy for safety on purpose: red-flag keywords such as
"chest pain" or "shortness of breath" force CRITICAL even when the underlying
condition is milder. Of {e['red_flag_emergencies']} red-flag emergencies in this test,
{e['red_flag_emergencies_not_truly_critical']} were for requests whose label is below CRITICAL — the
same over-caution the NestJS rules engine has, by design.

### Emergencies without a red flag

`ML_MAY_DECLARE_EMERGENCY = {e['ml_may_declare_emergency']}` in `src/engine.py`: red-flag rules always
win, and the risk model may additionally declare an emergency when no keyword
matched. Both settings, measured on the same {r['test_rows']} requests:

| | Rules alone (switch off) | Rules + model (switch on) |
|---|---|---|
| Truly CRITICAL requests reported as CRITICAL (of {e['true_critical_requests']}) | {e['caught_by_rules_alone']} | **{e['caught_with_model']}** |
| Emergencies declared by the model alone | 0 | {e['model_only_emergencies']} |
| …of which false (label below CRITICAL) | 0 | {e['model_false_emergencies']}{f" ({false_by_label})" if false_by_label else ""} |

"Truly CRITICAL" follows the silver labels: the disease's acuity in
`data/specialty_map.csv`.

```
{r_report}
```

![Risk confusion matrix](risk_confusion_matrix.png)
![Risk feature importances](risk_feature_importance.png)
"""


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    train = pd.read_csv(TRAIN_CSV, keep_default_na=False)
    test = pd.read_csv(TEST_CSV, keep_default_na=False)

    engine = TriageEngine.load()

    specialty, specialty_report = evaluate_specialty(test, engine)
    unseen = unseen_disease_stress_test(pd.concat([train, test], ignore_index=True))
    short = evaluate_short_inputs(engine)
    risk, risk_report = evaluate_risk(test, engine)

    metrics = {
        "train_rows": len(train),
        "specialty": specialty,
        "unseen_disease_stress_test": unseen,
        "short_inputs": short,
        "risk": risk,
    }
    (REPORTS / "metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (REPORTS / "metrics.md").write_text(
        render_markdown(len(train), specialty, unseen, short, risk, specialty_report, risk_report),
        encoding="utf-8",
    )

    s, r = specialty, risk
    print(f"specialty  model acc {s['model']['accuracy']:.3f}  macro-F1 {s['model']['macro_f1']:.3f}"
          f"  | rules acc {s['rules_baseline']['accuracy']:.3f}  | full system acc {s['full_system']['accuracy']:.3f}")
    print(f"  short inputs: rules {short['rules_accuracy']:.3f}  model {short['model_accuracy']:.3f}"
          f"  full system {short['system_accuracy']:.3f}  ({short['rows']} rows)")
    for name, v in s["by_source"].items():
        print(f"  {name}: model {v['model_accuracy']:.3f}  rules {v['rules_accuracy']:.3f}  ({v['rows']} rows)")
    v = s["rules_reachable_rows"]
    print(f"  rules-reachable rows: model {v['model_accuracy']:.3f}  rules {v['rules_accuracy']:.3f}  ({v['rows']} rows)")
    print(f"  never-seen diseases: {unseen['accuracy']:.3f}  ({unseen['diseases']} diseases, {unseen['rows']} rows)")
    effect = unseen.get("ddxplus_effect_on_kaggle_rows")
    if effect:
        print(f"  never-seen Kaggle diseases: {effect['accuracy_without_ddxplus']:.3f} without DDXPlus"
              f" → {effect['accuracy_with_ddxplus']:.3f} with  ({effect['diseases']} diseases, {effect['rows']} rows)")
    e = r["emergencies_without_red_flag"]
    print(f"emergencies: {e['caught_by_rules_alone']}/{e['true_critical_requests']} truly CRITICAL caught by rules alone,"
          f" {e['caught_with_model']} with the model; model-only emergencies {e['model_only_emergencies']},"
          f" false {e['model_false_emergencies']}")
    print(f"  short inputs risk: {short['risk_levels']}")
    for name in ("rules_baseline", "model", "full_system"):
        m = r[name]
        print(f"risk {name:14s} acc {m['accuracy']:.3f}  macro-F1 {m['macro_f1']:.3f}"
              f"  urgent recall {m['urgent_recall']:.3f}  over-triage {m['over_triage_rate']:.3f}")
    print(f"reports written to {REPORTS}")


if __name__ == "__main__":
    main()
