# P-02 · AI symptom triage

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev B |
| **Depends on** | P-01 |
| **Blocks** | — |

> **This is the marquee feature of the defense demo.** It is the BRD's "AI Health
> Assistant" (stage 2 of the patient journey) and the thing examiners will ask
> about. Budget the full two days and make it look good.

## Goal
The patient describes what they feel, in Arabic or English, and gets a risk level,
a suggested specialty, red-flag warnings and the reasoning behind them — clearly
labelled as guidance, not a diagnosis.

## API
```
POST /ai/triage
{
  "symptoms": [ {"name": "headache", "duration": "3 days", "severity": "moderate"} ],
  "notes": "The pain gets worse with bright light."
}
```
Response:
```jsonc
{
  "assessmentId": 12,
  "riskLevel": "MODERATE",              // LOW | MODERATE | HIGH | CRITICAL
  "suggestedSpecialty": "neurology",
  "seekEmergencyCare": false,
  "redFlags": [],                        // e.g. ["Chest pain", "Difficulty breathing"]
  "reasons": ["2 symptoms reported at once.", "Chronic conditions on record."],
  "advice": "Your answers suggest the neurology department...",
  "engine": "rules",
  "disclaimer": "Assistive assessment only — not a medical diagnosis..."
}
```
Rate limited to 10 requests per minute. Max 20 symptoms.

## Scope
- [ ] Symptom entry: add symptom rows (name, optional duration, optional severity),
      with a chip list of common symptoms in both languages to speed entry
- [ ] Free-text notes field
- [ ] Submit with a loading state that reads like the assistant is thinking
- [ ] Result screen:
      - risk level as a large `SeverityChip` using the F-03 severity colours
      - **if `seekEmergencyCare` is true**: a full-width red card at the top with a
        direct SOS action (P-13) and the emergency number, before anything else
      - red flags listed as warnings
      - suggested specialty with a "Find a doctor" action deep-linking into P-03
        filtered by that specialty
      - `reasons` shown as a "Why did I get this result?" expandable list — this is
        the explainability story, do not hide it
      - the `disclaimer` always visible, never dismissible
- [ ] History: `GET /assessments/patients/{patientId}` showing previous triages
- [ ] The result is saved server-side as an `AI_INITIAL` assessment automatically;
      the doctor sees it at the next visit. Tell the user that.

## Acceptance criteria
- [ ] Submitting the Arabic phrase for chest pain returns `CRITICAL` with
      `seekEmergencyCare: true`, and the UI shows the emergency card first
- [ ] Submitting a mild single symptom returns `LOW` and shows a calm result
- [ ] "Find a doctor" carries `suggestedSpecialty` into the doctor list
- [ ] The disclaimer is visible on every result, in both languages
- [ ] Submitting with zero symptoms is blocked client-side
- [ ] A 429 shows "please wait a moment" rather than an error screen
- [ ] The full flow works end to end in Arabic

## Gotchas
- Never render the result as a diagnosis. Wording matters for the defense: use
  "suggested", "may indicate", "a doctor will evaluate you".
- `engine` is `"rules"` today and `"ml-service"` later. Do not display it to the
  patient, but keep it in the model — it is useful in the demo explanation.
