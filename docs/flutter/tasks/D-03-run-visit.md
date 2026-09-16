# D-03 · Run a visit (open, diagnose, close)

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | D-02 |
| **Blocks** | D-04, D-05 |

## Goal
The clinical encounter: open a visit from an appointment, record the complaint,
assessment and diagnosis, then close it. (BRD FR-009, FR-010, AC-004)

## API
```
POST  /visits                     {appointmentId, type?, mainComplaint?, notes?}  -> Visit
POST  /visits/{id}/diagnoses      {name, code?, description?, severity?, status?}
POST  /assessments                {patientId, visitId, type, symptoms?, observations?, riskLevel?, notes?}
PATCH /visits/{id}/close          {notes?, followUpRequired?}
PATCH /diagnoses/{id}/status      {status}
GET   /visits/{id}
```

**BR-004: a visit must come from an appointment.** There is no walk-in path. For
a walk-in, book an immediate appointment first (P-04 flow with `startTime = now`),
then open the visit on it. Creating the visit automatically marks the appointment
`COMPLETED`.

## Scope
- [ ] "Start visit" from the D-01 schedule, creating the visit and opening the workspace
- [ ] Walk-in helper: a "New walk-in" action that books an immediate appointment
      for a chosen patient and immediately opens a visit on it
- [ ] Visit workspace with the patient context panel always visible (allergies,
      chronic diseases, current medications, latest vitals, AI triage result)
- [ ] Main complaint and clinical notes, autosaving as a draft locally
- [ ] Add assessment: symptoms, observations, risk level
- [ ] Add diagnosis: name, ICD-10 code, description, severity, status
- [ ] Close visit, with a "follow-up required" toggle
- [ ] Editing is only allowed while the visit is `OPEN` — the backend rejects
      writes to a closed visit, so disable the controls too

## Acceptance criteria
- [ ] Starting a visit from a confirmed appointment marks that appointment `COMPLETED`
- [ ] Trying to start a second visit on the same appointment shows the backend's
      400 "a visit already exists" message
- [ ] Starting a visit on a cancelled appointment is blocked
- [ ] A diagnosis appears immediately in the visit record and in the patient timeline (D-02)
- [ ] Closing with follow-up sets `FOLLOW_UP_REQUIRED`, not `CLOSED`
- [ ] After closing, all editing controls are disabled
- [ ] The AI triage assessment made by the patient before the visit is visible in
      the context panel — this is the "AI helps the doctor" story

## Gotchas
- Only the appointment's own doctor may open or write to the visit; anyone else
  gets 403.
- `POST /assessments` as a doctor **requires** `patientId`, and if you pass
  `visitId` it must belong to that same patient.
