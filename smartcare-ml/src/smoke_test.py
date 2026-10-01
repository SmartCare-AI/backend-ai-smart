"""Check that the committed models load and answer, without starting a server.

    python -m src.smoke_test

Run by deploy.sh before the running process is touched: a broken install or
a model/library version mismatch stops the deploy instead of the service.
"""

import sys

from .engine import Symptom, TriageEngine


def main() -> None:
    engine = TriageEngine.load()

    emergency = engine.triage(
        [Symptom("chest pain", duration="2 hours", severity="severe")],
        age=61,
        chronic_diseases="type 2 diabetes, hypertension",
        notes="pain spreads to my left arm",
    )
    routine = engine.triage(
        [Symptom("itchy red skin rash on my arms and legs with dry scaly patches")], age=30
    )

    problems = []
    if (emergency["riskLevel"], emergency["suggestedSpecialty"]) != ("CRITICAL", "cardiology"):
        problems.append(f"chest pain case answered {emergency}")
    if routine["suggestedSpecialty"] != "dermatology" or routine["seekEmergencyCare"]:
        problems.append(f"skin rash case answered {routine}")
    if problems:
        sys.exit("smoke test FAILED:\n  " + "\n  ".join(problems))
    print(f"smoke test ok — {len(engine.specialties)} specialties loaded")


if __name__ == "__main__":
    main()
