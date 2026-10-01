"""Golden cases — pinned forever, no matter what we retrain.

    pytest
"""

import csv
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.engine import Symptom, TriageEngine
from src.features import parse_duration_days, severity_level
from src.paths import RED_FLAGS, ROOT, SHORT_INPUTS, SPECIALTY_KEYWORDS
from src.safety import RISK_ORDER
from src.service import app
from src.textutil import to_english

client = TestClient(app)

RULES_PROVIDER_TS = ROOT.parent / "src" / "ai" / "providers" / "rules.provider.ts"
RESPONSE_KEYS = {"riskLevel", "suggestedSpecialty", "seekEmergencyCare", "redFlags", "reasons", "advice"}


def triage(*names: str, **extra) -> dict:
    payload = {"age": None, "gender": None, "chronicDiseases": None, "notes": None}
    payload.update(extra)
    payload["symptoms"] = [{"name": n} for n in names] + payload.get("symptoms", [])
    response = client.post("/triage", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def at_least(result: dict, level: str) -> bool:
    return RISK_ORDER.index(result["riskLevel"]) >= RISK_ORDER.index(level)


# --- contract ---------------------------------------------------------------


def test_health():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert "cardiology" in body["specialties"]


def test_contract_example_from_the_plan():
    result = client.post(
        "/triage",
        json={
            "age": 61,
            "gender": "MALE",
            "chronicDiseases": "type 2 diabetes, hypertension",
            "symptoms": [{"name": "chest pain", "duration": "2 hours", "severity": "severe"}],
            "notes": "pain spreads to my left arm",
        },
    ).json()
    assert set(result) == RESPONSE_KEYS
    assert result["riskLevel"] == "CRITICAL"
    assert result["suggestedSpecialty"] == "cardiology"
    assert result["seekEmergencyCare"] is True
    assert result["redFlags"] == ["Chest pain"]
    assert result["reasons"] and all(isinstance(r, str) for r in result["reasons"])
    assert "emergency" in result["advice"].lower()


def test_missing_optional_fields_are_accepted():
    response = client.post("/triage", json={"symptoms": [{"name": "headache"}]})
    assert response.status_code == 200
    assert set(response.json()) == RESPONSE_KEYS


# --- safety layer: ML must never downgrade an emergency ------------------------


def test_chest_pain_radiating_to_arm_is_critical_cardiology():
    result = triage("chest pain radiating to arm")
    assert (result["riskLevel"], result["suggestedSpecialty"]) == ("CRITICAL", "cardiology")
    assert result["seekEmergencyCare"] is True


RED_FLAG_CASES = [
    (flag["label"], keyword)
    for flag in json.loads(RED_FLAGS.read_text(encoding="utf-8"))
    for keyword in flag["keywords"]
]


@pytest.mark.parametrize("label,keyword", RED_FLAG_CASES)
def test_every_red_flag_keyword_is_critical(label, keyword):
    # Buried in an otherwise mild story, in the symptom name and in the notes.
    for result in (
        triage(f"mild itching and {keyword} since morning"),
        triage("runny nose", notes=f"also {keyword}"),
    ):
        assert result["riskLevel"] == "CRITICAL"
        assert result["seekEmergencyCare"] is True
        assert label in result["redFlags"]


@pytest.mark.parametrize(
    "text,label",
    [
        ("ألم في الصدر", "Chest pain"),
        ("وجع في صدري", "Chest pain"),
        ("مش قادر اتنفس", "Difficulty breathing"),
        ("نزيف شديد", "Severe bleeding"),
    ],
)
def test_arabic_emergencies(text, label):
    result = triage(text)
    assert result["riskLevel"] == "CRITICAL"
    assert label in result["redFlags"]


HEART_ATTACK_WITHOUT_KEYWORDS = ["vomiting", "breathlessness", "sweating"]


def test_model_declares_an_emergency_no_red_flag_keyword_catches():
    # A heart-attack checklist from the dataset, minus "chest pain".
    result = triage(*HEART_ATTACK_WITHOUT_KEYWORDS)
    assert result["redFlags"] == []
    assert result["riskLevel"] == "CRITICAL"
    assert result["seekEmergencyCare"] is True
    assert "emergency" in result["advice"].lower()


def test_emergency_switch_off_reports_high_instead():
    rules_only = TriageEngine.load()
    rules_only.ml_may_declare_emergency = False
    result = rules_only.triage([Symptom(name) for name in HEART_ATTACK_WITHOUT_KEYWORDS])
    assert result["riskLevel"] == "HIGH"
    assert result["seekEmergencyCare"] is False


def test_one_sided_weakness_is_a_stroke_red_flag():
    for text in ("weakness of one body side", "sudden weakness on one side", "ضعف في جانب واحد"):
        result = triage("headache", notes=text)
        assert result["riskLevel"] == "CRITICAL"
        assert "Possible stroke" in result["redFlags"]


# --- risk floors (same rules as the NestJS engine) ----------------------------


def test_severe_is_at_least_high():
    assert at_least(triage(symptoms=[{"name": "headache", "severity": "severe"}]), "HIGH")


def test_vulnerable_age_is_at_least_moderate():
    assert at_least(triage("runny nose", age=70), "MODERATE")
    assert at_least(triage("runny nose", age=3), "MODERATE")


def test_chronic_disease_is_at_least_moderate():
    assert at_least(triage("runny nose", chronicDiseases="type 2 diabetes"), "MODERATE")


def test_three_symptoms_is_at_least_moderate():
    assert at_least(triage("runny nose", "sneezing", "itchy eyes"), "MODERATE")


# --- specialty routing ---------------------------------------------------------


@pytest.mark.parametrize(
    "names,specialty",
    [
        (["itchy red skin rash on my arms"], "dermatology"),
        (["pimples and blackheads on my face"], "dermatology"),
        (["burning sensation when I urinate", "frequent urge to urinate"], "urology"),
        (["heartburn and acid reflux after meals"], "gastroenterology"),
        (["throbbing headache with sensitivity to light"], "neurology"),
        (["wheezing and coughing at night"], "pulmonology"),
        (["joint pain and stiffness in my knees"], "rheumatology|orthopedics"),
        (["very thirsty", "frequent urination", "blurred vision", "weight loss"], "endocrinology"),
    ],
)
def test_specialty_routing(names, specialty):
    assert triage(*names)["suggestedSpecialty"] in specialty.split("|")


@pytest.mark.parametrize(
    "text,specialty",
    [
        ("طفح جلدي وحكة", "dermatology"),
        ("صداع شديد ودوخة", "neurology"),
        ("حرقان في البول", "urology"),
    ],
)
def test_arabic_specialty_routing(text, specialty):
    assert triage(text)["suggestedSpecialty"] == specialty


def test_low_confidence_falls_back_to_keyword_rules():
    # Ophthalmology and psychiatry are not in the training data.
    assert triage("eye")["suggestedSpecialty"] == "ophthalmology"
    assert triage("panic")["suggestedSpecialty"] == "psychiatry"


def test_short_app_style_inputs_stay_mostly_right():
    # One or two symptom names, EN + AR. Measured 88.9% when this was written;
    # a retrain that drops it below 80% has broken something.
    with SHORT_INPUTS.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    hits = sum(
        triage(row["text"])["suggestedSpecialty"] in row["acceptable"].split("|") for row in rows
    )
    assert hits / len(rows) >= 0.80


def test_short_inputs_are_never_urgent_without_a_rule():
    # One or two words cannot justify HIGH/CRITICAL from the model alone.
    with SHORT_INPUTS.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            assert triage(row["text"])["riskLevel"] in ("LOW", "MODERATE"), row["text"]
    # ...but the rules still raise a short input.
    assert at_least(triage(symptoms=[{"name": "acne", "severity": "severe"}]), "HIGH")
    assert triage("chest pain")["riskLevel"] == "CRITICAL"


def test_specialties_learned_from_ddxplus():
    specialties = client.get("/health").json()["specialties"]
    assert {"otolaryngology", "psychiatry", "hematology"} <= set(specialties)
    result = triage(
        "my heart suddenly starts beating very fast and irregularly, "
        "I feel dizzy and lightheaded and a bit short of breath"
    )
    assert result["suggestedSpecialty"] == "cardiology"


def test_unrecognizable_input_defaults_to_internal_medicine():
    result = triage("qwerty zxcv")
    assert result["suggestedSpecialty"] == "internal medicine"
    assert result["riskLevel"] == "LOW"


# --- helpers ---------------------------------------------------------------------


def test_arabic_dictionary_pass():
    assert "headache" in to_english("عندي صداع")
    assert to_english("ألم في الركبة") == "knee pain"
    assert to_english("chest pain") == "chest pain"
    assert "2 days" in to_english("منذ يومين")


def test_duration_and_severity_parsing():
    assert parse_duration_days("2 hours") == pytest.approx(2 / 24)
    assert parse_duration_days("3 days", "a week") == 7
    assert parse_duration_days("no idea") is None
    assert severity_level("mild", "severe") == 3
    assert severity_level(None) == 0


# --- the Python rules must stay a mirror of the NestJS rules ------------------------


def _ts_rules(constant: str, key: str) -> dict[str, list[str]]:
    source = RULES_PROVIDER_TS.read_text(encoding="utf-8")
    block = re.search(rf"const {constant}\b.*?=\s*\[(.*?)\n\];", source, re.S).group(1)
    entries = re.findall(rf"{key}: '([^']+)',\s*keywords: \[(.*?)\]", block, re.S)
    return {name: re.findall(r"""'([^']*)'|"([^"]*)\"""", body) for name, body in entries}


@pytest.mark.skipif(not RULES_PROVIDER_TS.exists(), reason="NestJS source not next to this service")
@pytest.mark.parametrize(
    "constant,key,path",
    [("RED_FLAGS", "label", RED_FLAGS), ("SPECIALTY_RULES", "specialty", SPECIALTY_KEYWORDS)],
)
def test_rules_mirror_the_nestjs_engine(constant, key, path: Path):
    ours = {r[key]: r["keywords"] for r in json.loads(path.read_text(encoding="utf-8"))}
    theirs = {
        name: [single or double for single, double in keywords]
        for name, keywords in _ts_rules(constant, key).items()
    }
    assert ours == theirs
