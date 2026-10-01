"""FastAPI app — the HTTP face of the triage engine.

    uvicorn src.service:app --host 127.0.0.1 --port 8000

Implements the contract the NestJS backend already speaks
(src/ai/providers/ml-http.provider.ts): POST /triage. Internal-only — bind
to localhost and never expose it through nginx.
"""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .engine import Symptom, TriageEngine

app = FastAPI(
    title="SmartCare ML",
    description="Assistive risk assessment and specialty suggestion. Not a diagnostic system.",
    version="1.0.0",
)
engine = TriageEngine.load()


class SymptomIn(BaseModel):
    name: str = Field(max_length=200)
    duration: str | None = Field(default=None, max_length=100)
    severity: str | None = Field(default=None, max_length=100)


class TriageInput(BaseModel):
    age: float | None = None
    gender: str | None = None
    chronicDiseases: str | None = None
    symptoms: list[SymptomIn] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(default=None, max_length=1000)


class TriageResult(BaseModel):
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    suggestedSpecialty: str
    seekEmergencyCare: bool
    redFlags: list[str]
    reasons: list[str]
    advice: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "specialties": engine.specialties}


@app.post("/triage", response_model=TriageResult)
def triage(req: TriageInput) -> dict:
    return engine.triage(
        symptoms=[Symptom(s.name, s.duration, s.severity) for s in req.symptoms],
        age=req.age,
        chronic_diseases=req.chronicDiseases,
        notes=req.notes,
    )
