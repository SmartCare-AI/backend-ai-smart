"""Project paths, resolved from this file so scripts work from any cwd."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA = ROOT / "data"
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"

SPECIALTY_MAP = DATA / "specialty_map.csv"
RED_FLAGS = DATA / "red_flags.json"
SPECIALTY_KEYWORDS = DATA / "specialty_keywords.json"
AR_EN_DICTIONARY = DATA / "ar_en_dictionary.json"
SHORT_INPUTS = DATA / "short_inputs.csv"

S2D_CSV = RAW / "s2d" / "Symptom2Disease.csv"
DSP_CSV = RAW / "dsp" / "dataset.csv"
DSP_SEVERITY_CSV = RAW / "dsp" / "Symptom-severity.csv"
DDX_EVIDENCES = RAW / "ddxplus" / "release_evidences.json"
DDX_PATIENTS = RAW / "ddxplus" / "release_validate_patients"
DDX_PHRASES = DATA / "ddxplus_phrases.json"

TRAIN_CSV = PROCESSED / "train.csv"
TEST_CSV = PROCESSED / "test.csv"
SYMPTOM_WEIGHTS = PROCESSED / "symptom_weights.json"

SPECIALTY_MODEL = MODELS / "specialty.joblib"
RISK_MODEL = MODELS / "risk.joblib"
